import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testEnv} from './d1.ts';
import {proofFixture} from './proof-fixture.ts';
import {submit,publishDue,eligibility,withdraw} from '../worker/src/submissions.ts';
import {buildEvidence,eventComparison} from '../worker/src/evidence.ts';
import {baseInterpretation} from '../worker/src/jev.ts';
import {decide,policy} from '../shared/policy.ts';
import {testimonyBatchMin} from '../worker/src/flags.ts';
import worker from '../worker/src/index.ts';
import inference from '../worker/inference.ts';
import {aggregateAnswers} from '../shared/survey.ts';
import {quarter} from '../shared/proof.ts';

const safe='My team discussed priorities openly. The workload was reasonable and our direct manager consistently explained changes to the plan.';
const signals={private_identity:0,contextual_identity:0,threat:0,doxxing:0,personal_attack:0,promotional:0,manipulation:0};
test('policy maps privacy uncertainty to repair, manipulation to jury, a clear personal attack to repair and anything less to publication, and does not gate on sentiment or allegations',()=>{
 assert.equal(decide(signals).action,'clear');assert.equal(decide({...signals,negative_sentiment:1,specific_allegation:1}).action,'clear');assert.equal(decide({...signals,private_identity:.55}).action,'repair');assert.equal(decide({...signals,manipulation:.7}).action,'jury');assert.equal(decide(null).action,'repair');
 // Policy 0.5.0: ABUSE-02 is repair-first at 0.85 and never goes to a jury; criticism of conduct below that publishes.
 assert.deepEqual([decide({...signals,personal_attack:.85}).action,decide({...signals,personal_attack:.85}).rules],['repair',['ABUSE-02']]);
 for(const p of [.5,.7,.84]) assert.equal(decide({...signals,personal_attack:p}).action,'clear',`personal_attack ${p} publishes`);
});
test('all randomized eligibility windows are 12–72h away and aligned to a six-hour batch',()=>{
 const now=new Date('2026-09-22T12:23:50Z');for(const random of [0,.1,.5,.99999]){const next=new Date(eligibility(now,random));const hours=(next.getTime()-now.getTime())/3600000;assert.ok(hours>=12&&hours<=72);assert.equal(next.getUTCHours()%6,0);}
});
test('credential consumption and intake insertion are one transaction; wrong employer does not burn a proof',async()=>{
 const {env,publicDb,intake}=testEnv();const f=await proofFixture();
 publicDb.prepare('INSERT INTO trusted_issuers(id,company_slug,epoch,expires_at,verification_class,public_key_json) VALUES(?,?,?,?,?,?)').bind(f.issuer.id,f.issuer.companySlug,f.issuer.epoch,f.issuer.expiresAt,'demo',JSON.stringify(f.issuer.publicKey)).raw();
 const input={companySlug:'northwind-labs',body:safe,layer:'claim',period:quarter(),proof:f.proof,publicationConsent:true,screeningConsent:true,adultConfirmed:true,juryReviewConsent:false,sensitiveConsent:false,structured:{}};
 await assert.rejects(submit(env,{...input,companySlug:'stripe'}),/employer_mismatch/);
 assert.equal((await intake.prepare('SELECT COUNT(*) AS n FROM spent_proofs').first() as {n:number}).n,0);
 const result=await submit(env,input);assert.equal(result.accepted,true);assert.equal(result.status,'approved');assert.equal('releaseAfter'in result,false);assert.equal('releaseWindowHours'in result,false);
 const replay=await submit(env,input);assert.equal(replay.accepted,false);assert.equal(replay.error,'credential_already_redeemed');
 assert.equal((await intake.prepare('SELECT COUNT(*) AS n FROM submissions').first() as {n:number}).n,1);
 if('capability'in result)assert.equal((await withdraw(env,result.capability!)).withdrawn,true);
});
test('privacy findings are rejected before inference or persistence',async()=>{
 const {env,intake}=testEnv();let calls=0;env.INFERENCE={fetch:async()=>{calls++;return Response.json({});}} as unknown as Fetcher;
 const f=await proofFixture();const result=await submit(env,{companySlug:'northwind-labs',body:`Contact Jane at jane@example.com. ${safe}`,layer:'experience',period:quarter(),proof:f.proof,publicationConsent:true,screeningConsent:true,adultConfirmed:true,juryReviewConsent:false,sensitiveConsent:false});
 assert.equal(result.accepted,false);assert.equal(calls,0);assert.equal((await intake.prepare('SELECT COUNT(*) AS n FROM submissions').first() as {n:number}).n,0);
});
test('publication requires the original time AND a full batch of 5 per employer across periods; no admin release path exists',async()=>{
 const {env,intake,publicDb}=testEnv();
 // Owner decision 3: written accounts publish in batches of TESTIMONY_BATCH_MIN (5, never below policy 0.8.0's minimum) per
 // employer and verification type, whatever reporting periods they name.
 assert.equal(policy.retention.minimumBatch,5);assert.equal(testimonyBatchMin(env),5);assert.equal(testimonyBatchMin({TESTIMONY_BATCH_MIN:'2'}),5,'never below the policy');assert.equal(testimonyBatchMin({TESTIMONY_BATCH_MIN:'8'}),8);
 for(let index=0;index<5;index++)intake.prepare('INSERT INTO submissions(id,company_id,company_slug,body,layer,period,answers_json,author_key_json,capability_hash,content_hash,verification_class,status,eligible_at,publication_period,revision,privacy_json,created_day) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(`receipt-${index}`,'co-northwind','northwind-labs',safe,'experience',index%2?'2026-Q2':'2026-Q3','{}','{}',`cap-${index}`,'hash','demo','approved',index===4?'2099-01-01T00:00:00Z':'2020-01-01T00:00:00Z','2026-Q3',0,'{}',new Date().toISOString().slice(0,10)).raw();
 assert.equal(await publishDue(env),0);
 const admin=await worker.fetch(new Request('http://localhost/api/admin/moderate',{method:'POST',body:JSON.stringify({action:'release'}),headers:{'content-type':'application/json','x-admin-token':'anything'}}),env);assert.equal(admin.status,410);
 intake.prepare("UPDATE submissions SET eligible_at='2020-01-01T00:00:00Z' WHERE id='receipt-4'").raw();assert.equal(await publishDue(env),5);
 assert.equal((await publicDb.prepare("SELECT COUNT(*) AS n FROM testimony WHERE company_id='co-northwind' AND release_batch=? AND withdrawn_at IS NULL").bind(quarter()).first() as {n:number}).n,5);
 assert.equal((await publicDb.prepare("SELECT COUNT(*) AS n FROM testimony WHERE id LIKE 'receipt-%'").first() as {n:number}).n,0,'public ids are never the private receipt ids');
 assert.equal(await publishDue(env),0);
});
test('suppression checks all siblings before selecting a cohort, and unknown cohorts never silently broaden',async()=>{
 const {env,publicDb}=testEnv();publicDb.prepare("UPDATE metric_releases SET n=3 WHERE id='r-030'").raw();
 const result=await buildEvidence(env,{slug:'northwind-labs',interpretation:baseInterpretation()});assert.ok(result);assert.ok(!result.metrics.find(m=>m.key==='return_intent')?.series.some(p=>p.period==='2026'));assert.ok(result.suppressed.some(n=>n.reason==='complementary_suppression'));
 const unknown=await buildEvidence(env,{slug:'northwind-labs',interpretation:baseInterpretation(),cohortLabelOverride:'Only engineer in Dallas'});assert.equal(unknown?.metrics.length,0);assert.equal(unknown?.testimony.length,0);
});
test('event comparisons exclude periods overlapping the event and select the actual event',async()=>{
 const {env}=testEnv();const e=await buildEvidence(env,{slug:'northwind-labs',interpretation:baseInterpretation()});assert.ok(e);const result=eventComparison(e.metrics,'2025-02-10');const r=result.find(m=>m.key==='return_intent');assert.equal(r?.before.period,'2024');assert.equal(r?.after.period,'2026');
});
test('aggregation counts explicit answers only, excludes missing, and suppresses small denominators',()=>{
 const small=aggregateAnswers(Array.from({length:24},()=>({return_intent:'Agree'})),25);assert.equal(small.length,0);
 const all=aggregateAnswers([...Array.from({length:25},()=>({return_intent:'Agree'})),{}],25);assert.equal(all[0]?.n,25);assert.equal(all[0]?.value,100);
});
test('inference boundary rejects credentials/identity fields and never resolves private submission IDs',async()=>{
 const {env}=testEnv();let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw new Error('unexpected inference');};
 try {
  const invalid=await inference.fetch(new Request('https://inference/rank',{method:'POST',body:JSON.stringify({query:'hello',ids:[],credential:'secret'})}),{DB:env.DB});assert.equal(invalid.status,503);
  const none=await inference.fetch(new Request('https://inference/rank',{method:'POST',body:JSON.stringify({query:'hello',ids:['private-submission']})}),{DB:env.DB});assert.equal(none.status,200);assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
test('financial and legal ledgers reject updates and deletion',()=>{
 const {publicDb}=testEnv();assert.throws(()=>publicDb.exec("DELETE FROM financial_entries"),/append_only/);assert.throws(()=>publicDb.exec("UPDATE financial_entries SET amount_cents=123"),/append_only/);
});
test('local workers get only their own secrets: one env file per worker, a plain wrangler dev never falls back to .env, and the verifier config requires only verifier secrets',async()=>{
 const issuerConfig=JSON.parse(readFileSync('issuer.wrangler.jsonc','utf8')) as {secrets?:{required?:string[]};d1_databases:{migrations_dir?:string}[]};
 // INTERNAL_TOKEN is the one secret the verifier shares with the main worker (community employer registration).
 assert.deepEqual(issuerConfig.secrets?.required?.sort(),['INTERNAL_TOKEN','ISSUER_MASTER_KEY','MAILBOX_PEPPER']);assert.equal(issuerConfig.d1_databases[0]?.migrations_dir,'db/verifier-migrations');
 type Vars=Record<string,string>;
 const dev=await import('../tools/dev.mjs' as string) as {WORKERS:{name:string;config:string;envFile:string;owns:string[]}[]};
 const prepare=await import('../tools/prepare-local.mjs' as string) as {localVars:(e:{main?:Vars;verifier?:Vars},env:Vars,g?:()=>string)=>Record<string,Vars>};
 assert.deepEqual(dev.WORKERS.map(w=>[w.config,w.envFile]).sort(),[['inference.wrangler.jsonc','.dev.vars.inference'],['issuer.wrangler.jsonc','.dev.vars.verifier'],['wrangler.jsonc','.dev.vars.main']]);
 const files=prepare.localVars({},{TYPESAFE_API_KEY:'provider-key',ADMIN_TOKEN:'admin-token'},()=>'generated');
 const secrets=dev.WORKERS.flatMap(w=>w.owns);
 for(const worker of dev.WORKERS)for(const key of Object.keys(files[worker.envFile]!))assert.ok(!secrets.includes(key)||worker.owns.includes(key),`${worker.envFile} holds ${key}, which ${worker.name} does not own`);
 // Wrangler loads .env only when no .dev.vars exists, so the legacy shared file must exist and hold no secret at all.
 assert.ok(files['.dev.vars']);for(const key of Object.keys(files['.dev.vars']!))assert.ok(!secrets.includes(key)&&!/TOKEN|KEY|SECRET|PEPPER/.test(key),key);
 assert.equal(JSON.stringify(files).includes('admin-token'),false);
 // The shared secret is the same local value in both files, and the local main worker shows the fictional employers.
 assert.equal(files['.dev.vars.main']!.INTERNAL_TOKEN,files['.dev.vars.verifier']!.INTERNAL_TOKEN);assert.equal(files['.dev.vars.main']!.SAMPLE_EMPLOYERS,'on');
 assert.equal('INTERNAL_TOKEN' in files['.dev.vars.inference']!,false);
});
