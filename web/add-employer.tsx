import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {z} from 'zod';
import {listingName,displayName,domainOf,accountsRule,isCommunity,withListing,COMMUNITY_LABEL,type DirectoryCompany,type PublicationRules} from './api.ts';
import {powSubject} from '../shared/pow.ts';
import {domainProblem as domainRule} from '../shared/domains.ts';
import {withPow,PowError,POW_NOTE} from './pow-client.ts';
import {EMPLOYER_NAME_MAX,listedName,domainFrom,domainProblem,nameProblem,namesakesOf,listingConflict,namedListing,addErrorMessage} from './listing.ts';

/*
 * "Add your employer" (owner decision 4). Anyone may list an employer by its name and the domain of its work email:
 * listing is separate from verifying and reveals nothing about who listed it or who works there. The name and domain
 * are checked on this device first, with the server's own fixed rules (worker/src/community.ts nameProblem and
 * shared/domains.ts: characters, identifiers and insults in the name; syntax, reserved names, public suffixes, free-mail
 * and disposable providers, and words that insult, accuse or identify someone, for the domain) and against the listings
 * already in the directory (a domain already listed; a name that means a listing that already has its own domain; a
 * domain named after another listing), so no proof of work is spent on a request those rules would refuse. The server
 * (POST /api/employers) checks them again, looks up the domain's mail servers, asks Jev, and either lists a new community
 * employer or attaches the domain to a curated listing that has none (only when it is confirmed as that employer's
 * corporate domain), then registers it with the verifier. A second listing under a name that already has a domain is
 * refused, by the server and here; no confirmation overrides that.
 */
class ListingError extends Error {
 code:string;detail:Record<string,unknown>;
 constructor(code:string,detail:Record<string,unknown>){super(code);this.code=code;this.detail=detail;}
}
const listingSchema=z.object({slug:z.string().min(1).max(90),name:z.string().min(1).max(200),origin:z.enum(['community','curated']).nullish(),domains:z.array(z.string().max(253)).max(20).nullish(),domain:z.string().max(253).nullish()});
const replySchema=z.object({listed:z.boolean().optional(),attached:z.boolean().optional(),company:listingSchema,verification:z.enum(['ready','pending']).optional()});
/** A listing a refusal links to: its address, and what names it. */
interface Linked {slug:string;name:string;origin?:string|null;domains?:readonly string[]|null;}
/**
 * How a refusal's link names its listing: as the directory shows it (a curated employer by its name, a community listing
 * with its domain), or, for a listing newer than the loaded directory, with the domain the refusal gives.
 */
const linkName=(listed:Linked,directory:ReadonlyArray<DirectoryCompany>)=>directory.some(c=>c.slug===listed.slug)?displayName(withListing(listed,directory)):listingName(listed);
async function postListing(body:unknown):Promise<unknown> {
 let response:Response;
 try {response=await fetch('/api/employers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
 catch {throw new ListingError('network_unavailable',{});}
 const data=await response.json().catch(()=>({})) as Record<string,unknown>;
 if(!response.ok)throw new ListingError(typeof data.error==='string'?data.error:response.status===404?'not_found':response.status===405?'method_not_allowed':'request_failed',data&&typeof data==='object'&&!Array.isArray(data)?data:{});
 return data;
}
export type ListingOutcome='created'|'attached';
interface Done {company:DirectoryCompany;outcome:ListingOutcome;ready:boolean;}

/**
 * The form, its preview of the listing, the proof of work and the result. `context` changes only what the result
 * offers next: on the contribution page the page itself chooses the new listing for the contribution, and on an
 * employer's own record (a curated listing without a verification domain) the record is already open.
 */
export function AddEmployer({directory,powBits,rules,initialName='',context,level=3,onListed,onClose}:{
 directory:ReadonlyArray<DirectoryCompany>;powBits:number|null;rules?:PublicationRules;initialName?:string;context:'home'|'unlisted'|'contribute'|'record';level?:2|3;
 onListed?:(company:DirectoryCompany,outcome:ListingOutcome)=>void;onClose?:()=>void;
}) {
 const [name,setName]=useState(initialName),[domain,setDomain]=useState(''),[working,setWorking]=useState(false),[busy,setBusy]=useState(false),[checked,setChecked]=useState(false);
 const [error,setError]=useState<{message:string;listed?:Linked|null}|null>(null),[done,setDone]=useState<Done|null>(null);
 const id=useId(),nameRef=useRef<HTMLInputElement>(null),resultRef=useRef<HTMLHeadingElement>(null),stop=useRef<AbortController|null>(null),mounted=useRef(true);
 useEffect(()=>{nameRef.current?.focus();},[]);
 useEffect(()=>{if(done)resultRef.current?.focus();},[done]);
 // Leaving the form (or the page) stops a calculation still running.
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;stop.current?.abort();};},[]);
 const shownName=listedName(name),shownDomain=domainFrom(domain);
 const problems=useMemo(()=>{
  const name=nameProblem(shownName,shownDomain),domain=domainProblem(shownDomain,directory);
  // The server's duplicate checks run only on a name and domain its rules accept, as on the server.
  return {name,domain,conflict:name||domain?null:listingConflict(shownName,shownDomain,directory)};
 },[shownName,shownDomain,directory]);
 // Real listings this name means, as the server decides it (worker/src/community.ts namesListing), curated ones first. A
 // curated one without a domain can receive this domain (attach); one that already has a domain refuses the name.
 const same=useMemo(()=>namesakesOf(shownName,directory),[shownName,directory]);
 const attachable=same.find(c=>!isCommunity(c)&&!domainOf(c))??null,taken=same.filter(c=>domainOf(c));
 const Heading=level===2?'h2':'h3';
 async function add() {
  setChecked(true);setError(null);
  if(problems.name||problems.domain){setError({message:problems.name??problems.domain!.message,listed:problems.domain?.listed??null});return;}
  if(problems.conflict){setError({message:problems.conflict.message,listed:problems.conflict.listed});return;}
  const controller=new AbortController();stop.current=controller;
  setBusy(true);
  try {
   // The stamp is bound to this site, the listing action and a digest of the domain as sent; nothing else.
   const reply=await withPow(async()=>({origin:location.origin,action:'add-employer' as const,keyId:'',subject:await powSubject.domain(shownDomain)}),pow=>postListing({name:shownName,domain:shownDomain,pow}),{bits:powBits,working:setWorking,signal:controller.signal});
   const parsed=replySchema.parse(reply),c=parsed.company;
   const domains=c.domains?.length?c.domains:[c.domain??shownDomain];
   // The domain came from this visitor, so it is a community domain wherever the listing shows it, attached or not.
   const company:DirectoryCompany={id:c.slug,slug:c.slug,name:c.name,kind:'real',...(c.origin==='community'?{origin:'community' as const}:{}),domains,communityDomains:[shownDomain]};
   const outcome:ListingOutcome=parsed.attached?'attached':'created';
   setDone({company,outcome,ready:parsed.verification!=='pending'});onListed?.(company,outcome);
  } catch(e) {
   // Cancel pressed while the calculation ran: nothing was sent, and the form closes.
   if(e instanceof PowError&&e.code==='pow_stopped'){if(mounted.current)onClose?.();return;}
   // domain_already_listed, name_already_listed and domain_belongs_to_listed name a listing, which the message links to.
   if(e instanceof ListingError)setError({message:addErrorMessage(e.code,e.detail),listed:namedListing(e.detail)});
   else if(e instanceof z.ZodError)setError({message:'The server’s answer was not in the expected form, so the listing may or may not have been added. Look for it in the directory before trying again.'});
   else setError({message:(e as Error).message});
  } finally {if(stop.current===controller)stop.current=null;setBusy(false);}
 }
 // Cancel stops a calculation that is still running (nothing has been sent yet); once the request is on its way it waits.
 const cancel=()=>{if(stop.current){stop.current.abort();return;}onClose?.();};
 if(done) {
  const c=done.company,at=domainOf(c);
  return <section className="add-employer is-done" aria-labelledby={`${id}-done`}>
   <Heading id={`${id}-done`} ref={resultRef} tabIndex={-1}>{done.outcome==='attached'?`${at} was added to ${c.name}`:`Listed: ${listingName(c)}`}</Heading>
   {done.outcome==='attached'
    ?<p>It was confirmed as {c.name}’s corporate email domain, so it was added to the existing listing instead of creating a second one.</p>
    :<p>{attachable&&attachable.slug!==c.slug?`${at??'The domain'} was not confirmed as ${attachable.name}’s corporate email domain, so it was listed separately. `:''}It is listed as {listingName(c)} and labeled “{COMMUNITY_LABEL.toLowerCase()}”. Listing it reveals nothing about who added it or who works there.</p>}
   <p className="note">{done.ready?`Coworkers with a work mailbox at ${at} can now verify and contribute.`:`The verifier has not confirmed ${at} yet, so verification for it is not ready. It is retried automatically; check back later.`} {rules?accountsRule(rules):''}</p>
   <div className="option-row">
    {context==='contribute'?<button type="button" className="primary-button" onClick={onClose}>Continue with {c.name}</button>
    :context==='record'?<><a className="primary-button" href={`/submit?employer=${encodeURIComponent(c.slug)}`}>Contribute about it</a>{onClose&&<button type="button" className="link-button" onClick={onClose}>Close</button>}</>
    :<><a className="primary-button" href={`/c/${encodeURIComponent(c.slug)}`}>Open its record</a><a className="secondary-button" href={`/submit?employer=${encodeURIComponent(c.slug)}`}>Contribute about it</a></>}
   </div>
  </section>;
 }
 const nameError=checked&&!!problems.name,domainError=checked&&!!problems.domain;
 const previewDomain=shownDomain&&!domainRule(shownDomain)?shownDomain:'domain';
 return <section className="add-employer" aria-labelledby={`${id}-title`}>
  <Heading id={`${id}-title`}>{context==='record'?'Add its work-email domain':'Add your employer'}</Heading>
  <p className="add-employer-lede">{context==='record'?'Anyone can give a listed employer the domain of its work email, so coworkers can verify with a mailbox there. ':'Anyone can add an employer with the domain of its work email. '}Listing is separate from verifying: it reveals nothing about who added it or who works there, and it publishes no evidence about the employer. Only its name and domain are listed.</p>
  <form noValidate onSubmit={event=>{event.preventDefault();if(!busy)void add();}}>
   <div className="add-employer-fields">
    <label className="add-employer-field" htmlFor={`${id}-name`}><span>Employer name</span>
     <input id={`${id}-name`} ref={nameRef} value={name} maxLength={EMPLOYER_NAME_MAX} autoComplete="organization" spellCheck={false} aria-invalid={nameError||undefined} aria-describedby={`${id}-name-hint`} onChange={e=>{setName(e.target.value);setError(null);}}/>
     <span className="add-employer-hint" id={`${id}-name-hint`}>{nameError?problems.name:`As people know it, up to ${EMPLOYER_NAME_MAX} characters.`}</span>
    </label>
    <label className="add-employer-field" htmlFor={`${id}-domain`}><span>Work-email domain</span>
     <input id={`${id}-domain`} value={domain} inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="acme.com" aria-invalid={domainError||undefined} aria-describedby={`${id}-domain-hint`} onChange={e=>{setDomain(e.target.value);setError(null);}}/>
     <span className="add-employer-hint" id={`${id}-domain-hint`}>{domainError?problems.domain!.message:domain.includes('@')?`Only the domain is used: ${shownDomain||'…'}. The rest of the address is not sent.`:'The part after @ in a work address. Free and disposable email providers can’t be listed, and the domain must receive email.'}</span>
    </label>
   </div>
   {taken.length?<div className="add-employer-namesake">
    <p className="note">{taken.map((c,index)=><span key={c.slug}>{index>0?' and ':''}<a href={`/c/${encodeURIComponent(c.slug)}`}>{listingName(c)}</a>{isCommunity(c)?`, ${COMMUNITY_LABEL.toLowerCase()},`:''}</span>)} {taken.length===1?'is':'are'} already listed under this name with {taken.length===1?'its':'their'} own domain. If you work there, open {taken.length===1?'its record':'their records'} instead. {attachable
     ?`${attachable.name} is also listed, without a work-email domain: ${shownDomain||'a domain'} is added to that listing only if it is confirmed as its corporate email domain. A second listing under the same name can’t be added.`
     :'A second listing under the same name can’t be added; if this is a different organization, use a name that tells the two apart.'}</p>
   </div>
   :attachable&&<p className="note">{attachable.name} is already listed, without a work-email domain. If {shownDomain||'the domain'} is confirmed as its corporate email domain, it is added to that listing; otherwise, if it passes the other checks, it is listed separately, with the domain beside the name and labeled “{COMMUNITY_LABEL.toLowerCase()}”.</p>}
   <div className="add-employer-preview">
    <p className="add-employer-preview-label">How the listing will appear</p>
    <div className="employer is-preview"><span className="monogram" aria-hidden="true">{(shownName||'?').slice(0,1).toUpperCase()}</span><span className="employer-name">{listingName({name:shownName||'Employer name',domains:[previewDomain]})}</span><span className="tag tag-community">{COMMUNITY_LABEL}</span></div>
   </div>
   {working&&<p className="add-employer-working" role="status"><i className="pow-dot" aria-hidden="true"/>{POW_NOTE}</p>}
   {error&&<p className="error" role="alert">{error.message}{error.listed&&<> <a href={`/c/${encodeURIComponent(error.listed.slug)}`}>Open {linkName(error.listed,directory)}</a></>}</p>}
   <div className="option-row">
    {/* Not disabled while busy (the form ignores it then), so focus stays on it and never falls to the page body. */}
    <button type="submit" className="primary-button" aria-disabled={busy||undefined}>{busy?(working?'Preparing the request…':'Adding…'):'Add to the directory'}</button>
    {/* Enabled while the calculation runs, which it stops; only the request itself, once sent, is waited for. */}
    {onClose&&<button type="button" className="link-button" disabled={busy&&!working} onClick={cancel}>Cancel</button>}
   </div>
  </form>
 </section>;
}
