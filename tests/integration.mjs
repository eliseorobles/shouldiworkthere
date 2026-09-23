#!/usr/bin/env node
/**
 * Live-stack integration suite: drives the three running local workers over HTTP, the way the browser does.
 *
 *   node tools/dev.mjs            # main http://localhost:8788, inference :8789, verifier :8790
 *   node tests/integration.mjs    # or: SITE=… VERIFIER=… INFERENCE=… node tests/integration.mjs
 *
 * It refuses any non-local address: it submits a sandbox contribution, challenges a fictional sample account and draws
 * a practice juror token. Everything it creates is fictional-employer (sandbox) data, and the contribution is withdrawn
 * (erased) before it ends. It uses one random TEST-NET address per run (cf-connecting-ip, which only local workers
 * accept from a client; Cloudflare overwrites it in production), so repeated runs never share a daily budget.
 *
 * Covered: health of all three workers; security headers; the Evidence Canvas with fictional labels; screening consent
 * and the identifier gate; a sandbox credential blind-signed by the verifier; submit with every consent enforced; author
 * status; withdrawal (and 404 for an unknown capability); challenges (protection, practice case for a seeded account,
 * identifier gate that costs no budget, daily budget, one budget per IPv6 /64); the verifier's exact routes; the local
 * stack serving only local issuer keys; 404 and 405 answers (an unlisted employer, an unknown page, an unknown API
 * path, a wrong method); the 18+ confirmation on juror requests; the juror no-case path; the disabled trustee route; policy and release
 * endpoints; daily contribution and moderation counts; and that no response carries an identifier, a cookie or anything
 * tying the author to the contribution. Launch switches (owner decisions of 2026-09-23): the local stack shows the
 * fictional employers, written accounts batch by 5, the proof-of-work worker script is served, listing an employer needs
 * a proof of work and refuses a free-mail domain before any DNS lookup or model call (no listing is created), the review
 * fixes refuse a squatted domain, a name that means a listed employer and an accusing domain the same way, a listing
 * correction needs the operator token, /api/transparency lists the correction log and the verifier link, and the
 * verifier's juror tokens need a proof of work bound to the exact batch.
 * Prints PASS / FAIL / WARN per check (WARN: model-quality expectations, which a hosted model may miss) and exits 1 on
 * any FAIL.
 */
import {existsSync,readFileSync} from 'node:fs';
import {prepareProof,prepareJurorToken,authorMessage,digest,encode,quarter,publicAuthorSchema,keyPurpose,sameIssuerKey,JUROR_BATCH_MAX} from '../shared/proof.ts';
import {policy} from '../shared/policy.ts';
import {solvePow,powSubject} from '../shared/pow.ts';

const SITE=(process.env.SITE??process.env.KERNEL_BASE??'http://localhost:8788').replace(/\/+$/,'');
const VERIFIER=(process.env.VERIFIER??'http://localhost:8790').replace(/\/+$/,'');
const INFERENCE=(process.env.INFERENCE??'http://localhost:8789').replace(/\/+$/,'');
for(const url of [SITE,VERIFIER,INFERENCE]) if(!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)&&process.env.INTEGRATION_ALLOW_NONLOCAL!=='1') {
 console.error(`Refusing to run against ${url}: this suite submits, challenges and draws juror tokens, so it runs only against a local stack.`);process.exit(2);
}
const ROUTES=['metric_view','comparison','timeline','distribution','cohort','evidence','clusters','existing_faq','discovery','needs_generation','cannot_safely_answer','unlisted'];
const IP=`203.0.113.${1+Math.floor(Math.random()*254)}`;
// One random IPv6 /64 per run (documentation prefix 2001:db8::/32), for the per-network budget check.
const NET6=`2001:db8:${Math.floor(Math.random()*0xffff).toString(16)}:${Math.floor(Math.random()*0xffff).toString(16)}`;
const SAFE='My team discussed priorities openly each sprint. The workload was reasonable most weeks, and our direct manager consistently explained changes to the plan before they happened.';
const EMAIL='jane.doe@example.com';

let passed=0,failed=0,warned=0;
function check(name,condition,detail='') {if(condition){passed++;console.log(`PASS  ${name}`);}else{failed++;console.log(`FAIL  ${name}${detail?`  (${detail})`:''}`);}return !!condition;}
function soft(name,condition,detail='') {if(condition){passed++;console.log(`PASS  ${name}`);}else{warned++;console.log(`WARN  ${name}${detail?`  (${detail})`:''}`);}}
const seen=[];
/** Every response is kept (status, headers, text) so the privacy checks at the end can scan all of them. */
async function request(base,path,{method,body,headers={},redirect='follow'}={}) {
 const response=await fetch(base+path,{method:method??(body===undefined?'GET':'POST'),redirect,headers:{'cf-connecting-ip':IP,...(body===undefined?{}:{'content-type':'application/json',origin:SITE}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const text=await response.text();let json=null;try {json=JSON.parse(text);} catch {}
 const result={status:response.status,headers:response.headers,text,json:json??{}};seen.push({path,...result});return result;
}
const site=(path,options)=>request(SITE,path,options);
const verifier=(path,options)=>request(VERIFIER,path,options);
const short=value=>JSON.stringify(value).slice(0,300);
/** A proof of work (shared/pow.ts) bound to the site's origin, as the browser computes it in its Web Worker. */
const stampFor=(action,keyId,subject,bits)=>solvePow({origin:SITE,action,keyId,subject},{bits});

async function authorKeys() {
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
 return {privateKey:pair.privateKey,publicKey:publicAuthorSchema.parse({kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y})};
}
const sign=async(privateKey,capability,action,revision,payloadHash='')=>encode(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,authorMessage(await digest(capability),action,revision,payloadHash,action==='revise'))));

async function main() {
 console.log(`Live stack: site ${SITE}, verifier ${VERIFIER}, inference ${INFERENCE}; client address ${IP}\n`);
 // ---- Health ----
 const config=await site('/api/config');
 if(!check('health: the main worker serves /api/config',config.status===200&&config.json.policyVersion,`status ${config.status}; is node tools/dev.mjs running?`)) return;
 check('health: the main worker runs the current policy',config.json.policyVersion===policy.version&&config.json.moderation?.policyVersion===policy.version,`${config.json.policyVersion} / ${config.json.moderation?.policyVersion}`);
 const directory=await site('/api/directory'),companies=directory.json.companies??[];
 check('health: the directory lists employers',directory.status===200&&companies.length>0);
 const keys=await verifier('/keys'),verifierKeys=keys.json.keys??[];
 check('health: the verifier serves its public keys',keys.status===200&&verifierKeys.length>0,`status ${keys.status}`);
 const stats=await verifier('/stats');
 check('health: the verifier /stats is coarse (bands only, no timestamps)',stats.status===200&&!/\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}/.test(stats.text)&&(stats.json.employers??[]).every(e=>[e.contribution?.issued,e.juror?.issued].every(v=>v==null||stats.json.bands.includes(v))));
 let inferenceUp=false;try {inferenceUp=(await fetch(`${INFERENCE}/`)).status>0;} catch {}
 check('health: the inference worker answers',inferenceUp);
 const siteKeys=(await site('/api/proof/keys')).json.keys??[];
 const byId=new Map(verifierKeys.map(k=>[k.id,k]));
 check('health: the site and the verifier publish identical issuer keys',siteKeys.length===verifierKeys.length&&siteKeys.every(k=>byId.has(k.id)&&sameIssuerKey(k,byId.get(k.id))),`${siteKeys.length} vs ${verifierKeys.length}`);
 check('health: every key purpose matches its id',verifierKeys.every(k=>keyPurpose(k)!==null));
 // RT-KEY-02: the local verifier signs only with local keys, never with keys of a production registry in this checkout.
 const moduli=file=>{try {return new Set(JSON.parse(readFileSync(file,'utf8')).map(k=>k?.publicKey?.n).filter(Boolean));} catch {return new Set();}};
 const localKeys=moduli('.wrangler/provision/local-issuer-public-keys.json'),productionKeys=moduli('db/issuer-public-keys.json');
 // Community keys (source 'community') are created by the verifier on demand for a listed employer's domain, so no
 // provisioned registry holds them; every other served key must be a provisioned local key.
 const provisioned=verifierKeys.filter(k=>k.source!=='community'),community=verifierKeys.filter(k=>k.source==='community');
 check('keys: the local verifier serves exactly the local registry (.wrangler/provision/), besides community keys',provisioned.length>0&&provisioned.every(k=>localKeys.has(k.publicKey?.n)),`${provisioned.filter(k=>!localKeys.has(k.publicKey?.n)).length} served keys are not local`)
 check('keys: community keys are ids ending :community with source community, and the site copies them exactly',community.every(k=>k.id.endsWith(':community')&&k.verificationClass==='mailbox')&&siteKeys.filter(k=>k.source==='community').every(k=>{const v=byId.get(k.id);return !!v&&sameIssuerKey(k,v);}),`${community.length} community keys`);;
 check('keys: no served key is in a production registry of this checkout',verifierKeys.every(k=>!productionKeys.has(k.publicKey?.n)),existsSync('db/issuer-public-keys.json')?'db/issuer-public-keys.json holds a local key':'');
 const clientPins=/CLIENT_ISSUER_PINS = (\{[^;]*\});/.exec(existsSync('worker/generated/client-assets.ts')?readFileSync('worker/generated/client-assets.ts','utf8'):'')?.[1];
 soft('keys: the local client build pins the local registry (node tools/build.mjs --local)',clientPins&&JSON.parse(clientPins).registry==='local',clientPins?.slice(0,80));

 // ---- Launch switches (owner decisions of 2026-09-23) ----
 check('launch: the local stack shows the fictional employers (SAMPLE_EMPLOYERS=on) and the directory lists them',config.json.sampleEmployers===true&&companies.some(c=>c.kind==='sample'),`sampleEmployers ${config.json.sampleEmployers}`);
 check('launch: written accounts publish in batches of 5 per employer; questionnaire figures need 25',config.json.publication?.accountBatch===policy.retention.minimumBatch&&config.json.publication?.aggregateMinimum===25,short(config.json.publication));
 check('launch: curated verification domains are listed beside their employers',(companies.find(c=>c.slug==='stripe')?.domains??[]).includes('stripe.com'));
 const powScript=await site('/pow-worker.js');
 check('launch: the proof-of-work worker script is served from the site\'s own origin',powScript.status===200&&/javascript/.test(powScript.headers.get('content-type')??'')&&/searchPow/.test(powScript.text),`status ${powScript.status}`);
 const listing=config.json.employerListing;
 if(check('launch: listing an employer is open locally (VERIFIER binding and INTERNAL_TOKEN wired by tools/dev.mjs)',listing?.open===true,short(listing))) {
  // From another TEST-NET address, so these POSTs leave this run's per-minute POST budget (ABUSE, 40 a minute) to the rest.
  const lister={'cf-connecting-ip':`198.51.100.${1+Math.floor(Math.random()*254)}`};
  const unstamped=await site('/api/employers',{body:{name:'Integration Check Co',domain:'integration-check.example.net'},headers:lister});
  check('launch: a listing without a proof of work is refused and creates nothing',unstamped.status===400&&unstamped.json.error==='pow_missing',short(unstamped.json));
  // Bound to the origin the site reports (wrangler dev shows the worker the custom domain's host, not localhost).
  const pow=await solvePow({origin:listing.pow?.origin??SITE,action:'add-employer',keyId:'',subject:await powSubject.domain('gmail.com')},{bits:listing.pow?.bits??20});
  const freeMail=await site('/api/employers',{body:{name:'Integration Check Co',domain:'gmail.com',pow},headers:lister});
  check('launch: a free-mail domain is refused before any DNS lookup or model call',freeMail.status===422&&freeMail.json.error==='domain_free_mail',short(freeMail.json));
  const again=await site('/api/employers',{body:{name:'Integration Check Co',domain:'gmail.com',pow},headers:lister});
  check('launch: the same stamp for the same refused domain is refused the same way (no listing exists)',again.status===422&&!((await site('/api/directory')).json.companies??[]).some(c=>c.slug==='integration-check-co'));
  // Review fixes of 2026-09-23, all refused before any DNS lookup, model call or write: a domain named after a listed
  // employer under another name, a name that means a listed employer that has a domain, and a domain that accuses.
  const stamped=async domain=>solvePow({origin:listing.pow?.origin??SITE,action:'add-employer',keyId:'',subject:await powSubject.domain(domain)},{bits:listing.pow?.bits??20});
  const squat=await site('/api/employers',{body:{name:'Integration Holdings',domain:'wellsfargo.com',pow:await stamped('wellsfargo.com')},headers:lister});
  check('launch: a domain named after a listed employer cannot be listed under another name',squat.status===409&&squat.json.error==='domain_belongs_to_listed'&&squat.json.company?.slug==='wells-fargo',short(squat.json));
  const impersonation=await site('/api/employers',{body:{name:'Stripe',domain:'stripe-integration-check.io',pow:await stamped('stripe-integration-check.io')},headers:lister});
  check('launch: a name that means a listed employer with a domain is refused, naming that listing',impersonation.status===409&&impersonation.json.error==='name_already_listed'&&impersonation.json.company?.domain==='stripe.com',short(impersonation.json));
  const accusing=await site('/api/employers',{body:{name:'Integration Check Co',domain:'integration-check-is-a-scam.com',pow:await stamped('integration-check-is-a-scam.com')},headers:lister});
  check('launch: a domain whose words accuse is refused',accusing.status===422&&accusing.json.error==='domain_abusive',short(accusing.json));
  check('launch: none of those refusals created a listing',!((await site('/api/directory')).json.companies??[]).some(c=>/integration/.test(c.slug)));
 }
 // From its own TEST-NET address, so it leaves this run's per-minute POST budget (ABUSE) to the checks below.
 const correction=await site('/api/directory/correct',{body:{slug:'stripe',action:'detach',reason:'wrong_domain'},headers:{'cf-connecting-ip':`203.0.113.${1+Math.floor(Math.random()*254)}`}});
 check('launch: a listing correction needs the operator token (401 without it) and changes nothing',correction.status===401&&((await site('/api/directory')).json.companies??[]).find(c=>c.slug==='stripe')?.domains?.includes('stripe.com'),`status ${correction.status}`);
 const transparencyNow=await site('/api/transparency');
 check('launch: /api/transparency lists the listing correction log and the verifier link state',Array.isArray(transparencyNow.json.listingCorrections)&&'verifierLink' in (transparencyNow.json??{}),short({listingCorrections:transparencyNow.json.listingCorrections,verifierLink:transparencyNow.json.verifierLink}));

 // ---- The verifier's routes (WS-07) ----
 const stray=await verifier('/whatever',{body:{action:'issue',keyId:'x',blinded:'AA'}});
 check('verifier: a POST to any path but /start, /issue and /issue-juror is 404',stray.status===404&&stray.json.error==='not_found',`status ${stray.status}`);
 const crossed=await verifier('/start',{body:{action:'issue',keyId:'x',blinded:'AA'}});
 check('verifier: /start accepts only a start request',crossed.status===400&&crossed.json.error==='invalid_request',`status ${crossed.status}`);


 // ---- Security headers ----
 const home=await site('/');
 const csp=home.headers.get('content-security-policy')??'';
 check('headers: the home page is served',home.status===200&&/<html/i.test(home.text));
 check('headers: CSP allows only self (default-src none, no inline script)',/default-src 'none'/.test(csp)&&/script-src 'self'(;|$)/.test(csp)&&/frame-ancestors 'none'/.test(csp),csp);
 for(const [name,value] of [['x-content-type-options','nosniff'],['referrer-policy','no-referrer'],['x-frame-options','DENY'],['cross-origin-opener-policy','same-origin']]) check(`headers: ${name}: ${value}`,home.headers.get(name)===value,home.headers.get(name)??'missing');
 check('headers: permissions-policy denies geolocation, camera, microphone and payment',/geolocation=\(\)/.test(home.headers.get('permissions-policy')??'')&&/camera=\(\)/.test(home.headers.get('permissions-policy')??''));
 // Every response also carries no-transform (edgeHeaders), so the directive is checked within the list.
 const noStore=headers=>/(^|,)\s*no-store\s*(,|$)/.test(headers.get('cache-control')??'');
 check('headers: API replies are never cached',noStore(config.headers),config.headers.get('cache-control')??'');
 check('headers: the verifier sends no-referrer, nosniff and no-store',keys.headers.get('referrer-policy')==='no-referrer'&&keys.headers.get('x-content-type-options')==='nosniff'&&noStore(keys.headers),keys.headers.get('cache-control')??'');
 const foreign=await site('/api/withdraw',{body:{capability:'cap_x'},headers:{origin:'https://employer.example'}});
 check('headers: the site refuses a POST from another origin',foreign.status===403,`status ${foreign.status}`);
 const foreignVerifier=await verifier('/start',{body:{action:'start',keyId:'x',email:'a@b.c'},headers:{origin:'https://employer.example'}});
 check('headers: the verifier refuses a POST from another origin',foreignVerifier.status===403,`status ${foreignVerifier.status}`);
 // (Plain HTTP is redirected to HTTPS only outside development, so this local stack cannot show it; tests/api.test.ts,
 // tests/protocol.test.ts and tools/verify-deployment.mjs cover it.)

 // ---- Not found and wrong methods ----
 const html={accept:'text/html,application/xhtml+xml,*/*;q=0.8'};
 const unlistedPage=await site('/c/acmewidgets',{headers:html});
 check('404: an employer the directory does not list answers 404 with the app shell (its honest state renders)',unlistedPage.status===404&&unlistedPage.text.includes('app-root')&&/<title>Employer not found/.test(unlistedPage.text),`status ${unlistedPage.status}`);
 const typo=await site('/nope',{headers:html});
 check('404: an unknown page opened in a browser gets a small HTML page with a link home',typo.status===404&&/text\/html/.test(typo.headers.get('content-type')??'')&&typo.text.includes('<a href="/">Go to the home page</a>'),`status ${typo.status} ${typo.headers.get('content-type')}`);
 const unknownApi=await site('/api/nope',{headers:html});
 check('404: an unknown API path answers JSON whatever the Accept header',unknownApi.status===404&&unknownApi.json.error==='not_found',`status ${unknownApi.status}`);
 const wrongMethod=await site('/api/challenge');
 check('405: a moderation route called with the wrong method names its method in Allow',wrongMethod.status===405&&wrongMethod.headers.get('allow')==='POST',`status ${wrongMethod.status} allow ${wrongMethod.headers.get('allow')}`);

 // ---- Policy and release endpoints ----
 const current=await site('/moderation/current.json',{redirect:'manual'});
 check('policy: /moderation/current.json redirects to the current version',current.status===302&&current.headers.get('location')===`/moderation/v${policy.version}.json`);
 const document=await site(`/moderation/v${policy.version}.json`);
 check('policy: the served policy carries the digest /api/config reports',document.status===200&&document.headers.get('x-policy-digest')===config.json.moderation?.policyDigest);
 check('policy: ABUSE-02 is repair-first with no jury range, and every version stays retrievable',document.json.rules?.some(r=>r.id==='ABUSE-02'&&r.repairAt===.85&&!('juryRange' in r))&&(await site('/moderation/v0.4.0.json')).status===200);
 const manifest=await site('/.well-known/siwt-release.json');
 check('release: the manifest is served signed, or 404 no_release_manifest before the first release',manifest.status===200?!!manifest.json.signature:manifest.status===404&&manifest.json.error==='no_release_manifest',`status ${manifest.status}`);

 // ---- Evidence Canvas and fictional labels ----
 const samples=companies.filter(c=>c.kind==='sample');
 check('canvas: the directory labels fictional sample employers',samples.length>0&&samples.every(c=>c.kind==='sample'));
 const sample=samples.find(c=>c.slug==='northwind-labs')??samples[0];
 const view=await site('/api/canvas',{body:{q:'',slug:sample.slug,mode:'controls'}});
 const evidence=view.json.evidence;
 check('canvas: a fictional employer page renders from controls alone (no hosted call)',view.status===200&&evidence?.company?.slug===sample.slug,`status ${view.status}`);
 check('canvas: the fictional employer is labeled as a sample',evidence?.company?.kind==='sample');
 const fixtures=(evidence?.testimony??[]).filter(t=>t.provenance==='fixture');
 check('canvas: seeded accounts are labeled as illustrative fixtures',fixtures.length>0&&fixtures.every(t=>/illustrative/i.test(t.verificationClass??'')),`${fixtures.length} fixtures`);
 check('canvas: the route is from the published vocabulary',ROUTES.includes(view.json.interpretation?.route),view.json.interpretation?.route);
 const identifying=await site('/api/canvas',{body:{q:`What happened to ${EMAIL} at ${sample.name}?`,mode:'submit'}});
 check('canvas: a question with a direct identifier is refused before any hosted call',identifying.status===422,`status ${identifying.status}`);
 const asked=await site('/api/canvas',{body:{q:sample.name,mode:'submit'}});
 check('canvas: a hosted question answers with a typed interpretation',asked.status===200&&typeof asked.json.interpretation==='object'&&ROUTES.includes(asked.json.interpretation?.route),`status ${asked.status} route ${asked.json.interpretation?.route}`);
 const i=asked.json.interpretation??{};
 soft('canvas: an employer name alone navigates to that employer (Jev routing quality)',i.degraded||i.company?.value===sample.slug,`route ${i.route}, company ${i.company?.value}`);

 // ---- Round-3 verification: forks and answers (the model's reading varies; what code does with it must not) ----
 const forksOf=r=>r.json.interpretation?.forks??[];
 for(const slug of [null,'northwind-labs']) {
  const where=slug?`on ${slug}`:'on the home page';
  const political=await site('/api/canvas',{body:{q:'how political is engineering?',slug,mode:'submit'}}),forks=forksOf(political),meaning=forks.find(f=>f.kind==='meaning');
  soft(`canvas D8d: "how political is engineering?" ${where} offers its meanings (Jev routing quality)`,political.json.degraded||!!meaning,short(forks.map(f=>[f.kind??f.field,f.tier])));
  if(meaning) {
   check(`canvas D8d: ${where}, the meaning fork leads and no view is asked beside it`,forks[0]===meaning&&!forks.some(f=>f.field==='view'&&f.tier!=='fork'),short(forks.map(f=>[f.kind??f.field,f.tier])));
   check(`canvas D8d: ${where}, the meanings are visible: tentative with the canvas shown, or asked while the canvas is held`,political.json.keepCanvas?meaning.tier==='ask':meaning.tier==='fork',`tier ${meaning.tier}, keepCanvas ${political.json.keepCanvas}`);
   check(`canvas D8d: ${where}, every meaning carries Jev's probability`,meaning.options.length>=2&&meaning.options.every(o=>o.share>0),short(meaning.options));
  }
 }
 const restructuring=await site('/api/canvas',{body:{q:'what got worse after the 2025 restructuring at Northwind Labs?',slug:'northwind-labs',mode:'submit'}});
 const noisy=forksOf(restructuring).flatMap(f=>f.field==='company'?f.options.filter(o=>o.share<.12&&!(o.id==='none'&&f.tier==='ask')):[]);
 check('canvas fork noise: a company fork never lists an employer or "an employer we don\'t list" below 12%',noisy.length===0,short(noisy));
 soft('canvas fork noise: the question naming the page\'s employer needs no company fork (Jev routing quality)',!forksOf(restructuring).some(f=>f.field==='company'),short(forksOf(restructuring)));
 const workload=await site('/api/canvas',{body:{q:'compare Northwind Labs and Helios Semiconductor on workload',mode:'submit'}}),wi=workload.json.interpretation??{};
 if(workload.json.view==='compare'&&wi.topic?.value==='workload')check('canvas: a comparison on workload headlines the workload measure, or says none is comparable',/^Typical weekly hours|^No workload measure/.test(workload.json.answer?.headline??''),workload.json.answer?.headline);
 else soft('canvas: "compare … on workload" reads as a workload comparison (Jev routing quality)',false,`view ${workload.json.view}, topic ${wi.topic?.value}`);
 const empty=await site('/api/canvas',{body:{q:'',slug:'stripe',mode:'controls'}});
 if(empty.json.evidence?.company?.kind==='real'&&!(empty.json.evidence.metrics??[]).length)check('canvas: an empty real-employer record reads "No privacy-approved results are published for Stripe yet."',empty.json.answer?.headline==='No privacy-approved results are published for Stripe yet.',empty.json.answer?.headline);

 // ---- Screening consent ----
 const noConsent=await site('/api/screen',{body:{approvedText:SAFE}});
 check('screen: screening without explicit consent is refused',noConsent.status===400,`status ${noConsent.status}`);
 const falseConsent=await site('/api/screen',{body:{approvedText:SAFE,consent:false}});
 check('screen: consent:false is refused',falseConsent.status===400,`status ${falseConsent.status}`);
 const identifier=await site('/api/screen',{body:{approvedText:`${SAFE} Write to ${EMAIL} for details.`,consent:true}});
 check('screen: a draft with a direct identifier is refused before hosted screening',identifier.status===422&&identifier.json.error==='remove_identifying_details',short(identifier.json));
 const screened=await site('/api/screen',{body:{approvedText:SAFE,consent:true}});
 const decision=screened.json.decision??{};
 check('screen: approved words get a decision under the pinned policy',screened.status===200&&['clear','repair','jury'].includes(decision.action)&&decision.policyVersion===policy.version&&decision.policyDigest===config.json.moderation?.policyDigest,short(screened.json));
 check('screen: no risk signal or self-harm flag is returned',!('signals' in screened.json)&&!('selfHarmResources' in screened.json));
 soft('screen: hosted screening is available (not CHECKS-UNAVAILABLE)',decision.rules?.[0]!=='CHECKS-UNAVAILABLE',short(decision));

 // ---- A sandbox credential, blind-signed by the verifier ----
 const now=Date.now();
 const key=siteKeys.find(k=>k.companySlug===sample.slug&&keyPurpose(k)==='contribution'&&k.verificationClass==='demo'&&Date.parse(k.expiresAt)>now);
 if(!check('proof: the fictional employer has a live sandbox contribution key',key)) return report();
 const author=await authorKeys();
 const prepared=await prepareProof(key,author.publicKey);
 const issued=await verifier('/issue',{body:{action:'issue',keyId:key.id,blinded:prepared.blinded}});
 if(!check('proof: the verifier blind-signs a sandbox credential without a mailbox',issued.status===200&&typeof issued.json.blindSignature==='string',short(issued.json))) return report();
 let proof;try {proof=await prepared.finalize(issued.json.blindSignature);} catch(error) {proof=null;check('proof: the blind signature finalizes and verifies',false,String(error));return report();}
 check('proof: the blind signature finalizes into a credential the site can verify offline',proof&&proof.keyId===key.id);
 check('proof: no service reply contains the prepared message or the final signature (the verifier signed only the blinded message)',!seen.some(r=>r.text.includes(proof.prepared)||r.text.includes(proof.signature)));

 // ---- Submit: every consent is enforced by the server ----
 const input={companySlug:sample.slug,layer:'experience',body:SAFE,period:quarter(),proof,structured:{},publicationConsent:true,screeningConsent:true,adultConfirmed:true,juryReviewConsent:false,sensitiveConsent:false};
 const omit=field=>Object.fromEntries(Object.entries(input).filter(([k])=>k!==field));
 for(const [label,body] of [['without adultConfirmed',omit('adultConfirmed')],['with adultConfirmed:false',{...input,adultConfirmed:false}],['without a juror-review choice',omit('juryReviewConsent')],['without a sensitive-data choice',omit('sensitiveConsent')],['without publication consent',omit('publicationConsent')]]) {
  const refused=await site('/api/submit',{body});
  check(`submit: refused ${label}`,refused.status===400&&refused.json.error==='invalid_request',`status ${refused.status} ${short(refused.json)}`);
 }
 const submitted=await site('/api/submit',{body:input});
 const receipt=submitted.json;
 if(!check('submit: a consented sandbox contribution is accepted',submitted.status===200&&receipt.accepted===true&&/^cap_[A-Za-z0-9_-]{43}$/.test(receipt.capability??''),`status ${submitted.status} ${short(receipt)}`)) return report();
 check('submit: the receipt is the capability, the decision and the release policy, never a public or receipt id',!('receiptId' in receipt)&&!('publicId' in receipt)&&!('public_id' in receipt)&&typeof receipt.releasePolicy==='string'&&['approved','held'].includes(receipt.status));
 check('submit: a sandbox credential is labeled as not employment-verified',receipt.verificationClass==='Sandbox credential; employment not verified',receipt.verificationClass);
 check('submit: the stored decision pins the current policy',receipt.decision?.policyVersion===policy.version);
 const replay=await site('/api/submit',{body:input});
 check('submit: a credential is redeemed once',replay.status===422&&replay.json.error==='credential_already_redeemed',short(replay.json));
 const capability=receipt.capability;

 // ---- Author status ----
 const status=await site('/api/author/status',{body:{capability}});
 check('status: the capability reads its status, revision, repairability and jury state',status.status===200&&status.json.status===receipt.status&&status.json.revision===0&&typeof status.json.repairable==='boolean'&&status.json.juryOpen===false,short(status.json));
 check('status: receipts pin the policy and carry only a quarter, never a timestamp',Array.isArray(status.json.receipts)&&status.json.receipts.some(r=>r.kind==='screening'&&r.policyVersion===policy.version)&&status.json.receipts.every(r=>/^\d{4}-Q[1-4]$/.test(r.period)));
 check('status: the reply never names the employer',!new RegExp(`${sample.slug}|${sample.id}`,'i').test(status.text));
 const legacy=await site('/api/author',{body:{action:'status',capability}});
 check('status: the author route agrees',legacy.status===200&&legacy.json.ok===true&&legacy.json.status===receipt.status&&legacy.json.revision===0);
 const unknownStatus=await site('/api/author/status',{body:{capability:`cap_${encode(crypto.getRandomValues(new Uint8Array(32)))}`}});
 check('status: an unknown capability is 404',unknownStatus.status===404,`status ${unknownStatus.status}`);

 // ---- Withdrawal ----
 const unknown=await site('/api/withdraw',{body:{capability:`cap_${encode(crypto.getRandomValues(new Uint8Array(32)))}`}});
 check('withdraw: an unknown capability answers 404 and withdraws nothing',unknown.status===404&&unknown.json.withdrawn===false&&unknown.json.error==='not_found',`status ${unknown.status} ${short(unknown.json)}`);
 const forged=await site('/api/author',{body:{action:'withdraw',capability,revision:0,signature:await sign((await authorKeys()).privateKey,capability,'withdraw',0)}});
 check('withdraw: a signature by any other key is refused',forged.status===400&&forged.json.error==='invalid_author_signature',short(forged.json));
 const withdrawn=await site('/api/author',{body:{action:'withdraw',capability,revision:0,signature:await sign(author.privateKey,capability,'withdraw',0)}});
 check('withdraw: the author withdraws with the device key',withdrawn.status===200&&withdrawn.json.ok===true&&withdrawn.json.status==='withdrawn',short(withdrawn.json));
 const again=await site('/api/withdraw',{body:{capability}});
 check('withdraw: withdrawing again is idempotent',again.status===200&&again.json.withdrawn===true&&again.json.status==='withdrawn',short(again.json));
 const after=await site('/api/author/status',{body:{capability}});
 check('withdraw: status then reports the erasure',after.status===200&&after.json.status==='withdrawn',short(after.json));

 // ---- Challenges ----
 const fixture=fixtures[0]?.id;
 if(check('challenge: a seeded fictional account is available to challenge',fixture)) {
  const challenge=(ruleId,reason)=>site('/api/challenge',{body:{testimonyId:fixture,ruleId,reason}});
  const protectedRule=await challenge('CRIT-01','This account is unfair to our leadership team.');
  check('challenge: a protection is answered and never acted on',protectedRule.status===200&&protectedRule.json.outcome==='rejected'&&protectedRule.json.receipt?.path==='protected_rule',short(protectedRule.json));
  const practice=await challenge('SPAM-01','This is an advert for a coaching course.');
  check('challenge: a seeded fictional account is never withheld; the challenge is recorded as a practice case',practice.status===200&&practice.json.receipt?.path==='practice_fixture'&&/practice case/.test(practice.json.explanation??''),short(practice.json));
  check('challenge: the receipt pins the policy and a quarter only',practice.json.receipt?.policyVersion===policy.version&&/^\d{4}-Q[1-4]$/.test(practice.json.receipt?.period??''));
  const leaky=await challenge('PRIV-04',`It names ${EMAIL} as the manager.`);
  check('challenge: a reason with a direct identifier is refused before any hosted call',leaky.status===422&&leaky.json.error==='remove_identifying_details',short(leaky.json));
  // Policy 0.6.0: a challenge refused before it is considered costs no daily budget, so after the protection and the
  // practice case two of the 5 are used. Seven requests stay under the burst limiter (10 a minute); the 429 names the budget.
  // The 3rd is a reputational reason (production journey: "this makes us look bad" under ABUSE-02): its practice receipt
  // says why it would not count, in the policy's own words.
  const counted=[await challenge('ABUSE-02','This makes our company look bad and hurts our reputation.')];for(let n=4;n<=5;n++) counted.push(await challenge('SPAM-02','Looks like coordinated fake accounts wrote this.'));
  check('challenge: the refused reason cost nothing: the 3rd, 4th and 5th challenges of the day are still answered',counted.every(r=>r.status===200&&r.json.receipt?.path==='practice_fixture'),counted.map(r=>`${r.status} ${r.json.receipt?.path??r.json.error}`).join(', '));
  const why=counted[0].json.explanation??'';
  check('challenge: a practice receipt for a reputational reason explains that it is not a ground, quoting the policy and its protections',/would not count as relevant to ABUSE-02/.test(why)&&why.includes(policy.challenges.grounds)&&policy.protections.every(p=>why.includes(`${p.id} (${p.name}): ${p.text}`)),why.slice(0,200));
  const over=await challenge('SPAM-02','Looks like coordinated fake accounts wrote this.');
  check(`challenge: the ${policy.challenges.budget.perClientPerDay+1}th challenge of the UTC day is refused by the daily budget of ${policy.challenges.budget.perClientPerDay}`,policy.challenges.budget.perClientPerDay===5&&over.status===429&&over.json.error==='rate_limited'&&over.json.limit==='daily',`status ${over.status} ${short(over.json)}`);
  // RT-ABUSE-03: an IPv6 client is its /64. Five challenges from five addresses of one /64 use its whole day; the sixth
  // address in it is refused, and another /64 is another client.
  const from=(ip,ruleId='SPAM-01')=>site('/api/challenge',{body:{testimonyId:fixture,ruleId,reason:'This is an advert for a coaching course.'},headers:{'cf-connecting-ip':ip}});
  const rotating=[];for(let n=1;n<=5;n++) rotating.push(await from(`${NET6}::${n}`));
  const sixth=await from(`${NET6}:ffff:ffff:ffff:${(1+Math.floor(Math.random()*0xfffe)).toString(16)}`);
  check('challenge: addresses in one IPv6 /64 share one daily budget',rotating.every(r=>r.status===200)&&sixth.status===429&&sixth.json.limit==='daily',`${rotating.map(r=>r.status).join(',')} then ${sixth.status} ${short(sixth.json)}`);
  const still=await site('/api/canvas',{body:{q:'',slug:sample.slug,mode:'controls'}});
  check('challenge: the sample account is still published',(still.json.evidence?.testimony??[]).some(t=>t.id===fixture));
 }
 const moderation=await site('/api/moderation/stats');
 // RT-DIFF-03: counts that follow contributions are rounded like contribution counts; the others use '<5'.
 const rounded=v=>v==='<25'||(Number.isInteger(v)&&v%25===0),coarse=v=>v==='<5'||(Number.isInteger(v)&&v>=5);
 const {submitted:submittedCount,publishedAutomatically,repairs,jury:juries,...others}=moderation.json.counts??{};
 check('stats: contribution-derived moderation counts are rounded like contribution counts; the others are coarse',moderation.status===200&&[submittedCount,publishedAutomatically,repairs,juries,...Object.values(moderation.json.heldByReason??{}),...Object.values(moderation.json.juryOutcomes??{})].every(rounded)&&Object.values(others).every(coarse),short(moderation.json.counts));
 const transparencyA=await site('/api/transparency'),transparencyB=await site('/api/transparency');
 check('stats: /api/transparency contribution counts come from the day\'s snapshot (identical across requests, rounded)',transparencyA.status===200&&JSON.stringify(transparencyA.json.stats)===JSON.stringify(transparencyB.json.stats)&&Object.values(transparencyA.json.stats??{}).every(v=>v===0||rounded(v)),short(transparencyA.json.stats));

 // ---- Jurors: the no-case path ----
 const jurorKey=verifierKeys.find(k=>keyPurpose(k)==='juror'&&k.verificationClass==='demo'&&Date.parse(k.expiresAt)>now);
 if(check('jury: a fictional employer publishes a sandbox juror key',jurorKey)) {
  const blinding=await prepareJurorToken(jurorKey);
  // Jurors are 18 or older: both the verifier and the site refuse a juror request without adultConfirmed:true.
  const unconfirmed=await verifier('/issue-juror',{body:{keyId:jurorKey.id,blinded:[blinding.blinded]}});
  check('jury: the verifier issues no juror token without the 18+ confirmation',unconfirmed.status===400&&unconfirmed.json.error==='adult_confirmation_required',short(unconfirmed.json));
  const unstamped=await verifier('/issue-juror',{body:{keyId:jurorKey.id,blinded:[blinding.blinded],adultConfirmed:true}});
  check('jury: the verifier signs no juror batch without a proof of work',unstamped.status===400&&unstamped.json.error==='pow_required',short(unstamped.json));
  const pow=await stampFor('issue-juror',jurorKey.id,await powSubject.blinded([blinding.blinded]),keys.json.pow?.bits??20);
  const tokens=await verifier('/issue-juror',{body:{keyId:jurorKey.id,blinded:[blinding.blinded],adultConfirmed:true,pow}});
  if(check('jury: the verifier blind-signs a practice juror token without a mailbox',tokens.status===200&&tokens.json.blindSignatures?.length===1,short(tokens.json))) {
   const tooMany=await verifier('/issue-juror',{body:{keyId:jurorKey.id,blinded:Array.from({length:JUROR_BATCH_MAX+1},(_,i)=>`${blinding.blinded.slice(0,-2)}${String(i).padStart(2,'A')}`),adultConfirmed:true}});
   check(`jury: a batch asks for at most ${JUROR_BATCH_MAX} tokens, the quota a mailbox gets once a quarter`,tooMany.status===400,`status ${tooMany.status}`);
   const token=await blinding.finalize(tokens.json.blindSignatures[0]);
   // These two refusals come from another TEST-NET address, so they leave this run's per-minute POST budget (ABUSE, 40 a
   // minute) to the checks after them.
   const aside={'cf-connecting-ip':`198.51.100.${1+Math.floor(Math.random()*254)}`};
   const noAdult=await site('/api/jury/assign',{body:{token},headers:aside});
   check('jury: a case request without the 18+ confirmation is refused before the token is read',noAdult.status===400&&noAdult.json.error==='adult_confirmation_required',short(noAdult.json));
   const garbage=await site('/api/jury/assign',{body:{token:'garbage',adultConfirmed:true},headers:aside});
   check('jury: something that is not a token is invalid_token, never unknown_issuer_key',garbage.status===400&&garbage.json.error==='invalid_token',short(garbage.json));
   const first=await site('/api/jury/assign',{body:{token,adultConfirmed:true}});
   check('jury: with no case to staff, the token is not used',first.status===200&&first.json.available===false&&/not used/.test(first.json.reason??''),short(first.json));
   // While practice juries cannot reach a decision, the reason states the prerequisite instead of "try again later".
   const canForm=config.json.moderation?.sandboxJuryEnabled===true;
   check('jury: the reason is true of the staffing state',canForm?/try again later/.test(first.json.reason??''):/No practice jury can form yet: a case needs live juror keys of at least \d+ (?:other )?fictional employers?/.test(first.json.reason??'')&&!/try again later/.test(first.json.reason??''),short(first.json));
   // Policy 0.7.0 (RT-B1): a practice jury needs sandbox juror keys of just one fictional employer, the case's own
   // included, so the key this token came from is enough for practice juries to be reported as able to form.
   check('jury: a published sandbox juror key is enough for a practice jury (policy 0.7.0)',canForm===true,`sandboxJuryEnabled ${config.json.moderation?.sandboxJuryEnabled}`);
   const second=await site('/api/jury/assign',{body:{token,adultConfirmed:true}});
   check('jury: the same token is still unspent afterwards',second.status===200&&second.json.available===false,short(second.json));
   const vote=await site('/api/jury/vote',{body:{assignment:`asg_${'A'.repeat(43)}`,vote:'YES'}});
   check('jury: a vote needs a real assignment',vote.status===404,`status ${vote.status}`);
  }
 }
 // Practice juries: the policy's seat limit and own-employer rule decide how many fictional employers must publish keys.
 const sandboxEmployers=new Set(verifierKeys.filter(k=>keyPurpose(k)==='juror'&&k.verificationClass==='demo').map(k=>k.companySlug)).size;
 const sandboxCap=policy.jury.seatsPerEmployer.sandbox,sandboxOthers=policy.jury.ownEmployerExcluded?.sandbox??true;
 const sandboxNeed=sandboxCap===null?1:Math.ceil(Math.ceil(policy.jury.quorumShare*policy.jury.stages.initial.jurors-1e-9)/sandboxCap);
 check('jury: practice juries are reported only when enough fictional employers can reach a decision',config.json.moderation?.sandboxJuryEnabled===((sandboxOthers?sandboxEmployers-1:sandboxEmployers)>=sandboxNeed),`sandboxJuryEnabled ${config.json.moderation?.sandboxJuryEnabled}; ${sandboxEmployers} fictional employers publish juror keys`);
 // Policy 0.8.0: only our employers' juror keys make a real-employer jury formable; employers added by the community
 // never do (their tokens share one seat per case). A jury reported formable must be formable without them.
 const curatedJurors=new Set(verifierKeys.filter(k=>keyPurpose(k)==='juror'&&k.verificationClass==='mailbox'&&k.source!=='community').map(k=>k.companySlug)).size;
 const communityJurors=new Set(verifierKeys.filter(k=>keyPurpose(k)==='juror'&&k.source==='community').map(k=>k.companySlug)).size;
 const mailboxNeed=Math.ceil(Math.ceil(policy.jury.quorumShare*policy.jury.stages.initial.jurors-1e-9)/policy.jury.seatsPerEmployer.mailbox);
 check('jury: employers added by the community never make a real-employer jury formable (policy 0.8.0)',policy.jury.communitySeatsPerCase===1&&(config.json.moderation?.juryEnabled!==true||curatedJurors-1>=mailboxNeed),`juryEnabled ${config.json.moderation?.juryEnabled}; ${curatedJurors} of our employers and ${communityJurors} community employers publish juror keys; ${mailboxNeed} others needed`);
 // prepare-local writes SAMPLE_EMPLOYERS=on for the local verifier too: without it the verifier hides the sandbox keys.
 check('launch: the local verifier serves the fictional employers\' sandbox keys (its SAMPLE_EMPLOYERS=on)',verifierKeys.some(k=>k.verificationClass==='demo'),`${verifierKeys.filter(k=>k.verificationClass==='demo').length} sandbox keys served`);

 // ---- Break-glass stays off ----
 const exception=await site('/api/exception',{body:{}});
 check('exception: the trustee route answers 503 while no trustee keys are configured',exception.status===503&&exception.json.error==='exceptions_disabled',`status ${exception.status}`);
 const log=await site('/api/moderation/exceptions');
 check('exception: the public exception log is served and reports the mechanism off',log.status===200&&log.json.enabled===false&&Array.isArray(log.json.entries));
 check('exception: no moderator route exists',(await site('/api/admin/remove',{body:{}})).status===410);

 // Last among the requests: the verifier stops reading an oversized body mid-stream, which can drop the local dev proxy's
 // keep-alive connection for the next request.
 let oversized=null;try {oversized=await fetch(`${VERIFIER}/issue`,{method:'POST',headers:{origin:SITE,'content-type':'application/json','cf-connecting-ip':IP},body:new ReadableStream({start(c){for(let i=0;i<8;i++)c.enqueue(new TextEncoder().encode(' '.repeat(1000)));c.close();}}),duplex:'half'});} catch {}
 check('verifier: a chunked body over 4000 bytes is refused (413) without buffering it',oversized?.status===413,`status ${oversized?.status}`);

 // ---- Nothing identifying in any response ----
 const secrets=[IP,EMAIL,author.publicKey.x,author.publicKey.y,proof.prepared,proof.signature,prepared.state.inv];
 const leaks=seen.filter(r=>secrets.some(s=>r.text.includes(s))).map(r=>r.path);
 check('privacy: no response echoes the client address, an email, the author key or the credential',leaks.length===0,leaks.join(', '));
 const capabilityEchoes=seen.filter(r=>r.text.includes(capability)&&r!==seen.find(s=>s.text===submitted.text)).map(r=>r.path);
 check('privacy: the capability appears only in the one submit reply',capabilityEchoes.length===0,capabilityEchoes.join(', '));
 const cookies=seen.filter(r=>r.headers.get('set-cookie')).map(r=>r.path);
 check('privacy: no response sets a cookie',cookies.length===0,cookies.join(', '));
 // A signal payload is an object of probabilities (the policy document's "signals" text field is not one).
 const signalLeaks=seen.filter(r=>/"signals"\s*:\s*\{|"(private_identity|contextual_identity|threat|doxxing|personal_attack|promotional|manipulation)"\s*:\s*[\d.]/.test(r.text)).map(r=>r.path);
 check('privacy: no response carries raw risk signals',signalLeaks.length===0,signalLeaks.join(', '));
 return report();
}
function report() {
 console.log(`\n${passed} passed, ${failed} failed${warned?`, ${warned} warnings (model-quality expectations)`:''}.`);
 process.exitCode=failed?1:0;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
