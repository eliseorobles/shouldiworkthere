import {listingName,type DirectoryCompany} from './api.ts';
import {scanText} from '../shared/privacy.ts';
import {normalizeDomain,domainProblem as domainRule,sharesSignificantToken,type DomainProblem} from '../shared/domains.ts';
import {POW_ERRORS} from './pow-client.ts';
import {nameProblem as listingNameRule,namesListing,listingsNamedByDomain,domainAbuseProblem,type Listed} from '../worker/src/community.ts';

/*
 * The on-device checks and plain-language refusals of "Add your employer" (web/add-employer.tsx). The name and domain rules
 * are the server's own fixed rules (worker/src/community.ts nameProblem, domainAbuseProblem, namesListing,
 * listingsNamedByDomain; shared/domains.ts), applied to the directory this page loaded, so a request those rules would
 * refuse never spends a proof of work. What only the server can check (the domain's mail servers, Jev's reading of the
 * name and domain, the daily limits, and listings newer than the loaded directory) is checked after the proof of work.
 * Nothing here touches the network or storage.
 */
export const EMPLOYER_NAME_MAX=80;
/** The name as it will be listed: NFKC, runs of space collapsed, trimmed (as the server stores it). */
export const listedName=(name:string)=>name.normalize('NFKC').replace(/\s+/g,' ').trim();
/**
 * What was typed in the domain box, reduced to a domain: the part after @ of a pasted address, the host of a pasted
 * link; lowercase, without a trailing dot (shared/domains.ts normalizeDomain). Only the result leaves the device.
 */
export function domainFrom(input:string):string {
 let text=input.trim().toLowerCase();
 const at=text.lastIndexOf('@');if(at>=0)text=text.slice(at+1);
 return normalizeDomain(text.replace(/^[a-z][a-z0-9+.-]*:\/\//,'').replace(/[/?#].*$/,'').replace(/:\d+$/,''));
}
export const DOMAIN_MESSAGES:Record<DomainProblem|'domain_empty',string>={
 domain_empty:'Enter the domain of your work email, the part after @, such as acme.com.',
 domain_invalid:'That is not a domain name. Enter only the part after @ in your work email, such as acme.com.',
 domain_reserved:'That domain is reserved for examples or private networks, so it cannot be listed.',
 domain_public_suffix:'That is a top-level or shared domain ending, not one organization’s domain. Enter the full domain of your work email.',
 domain_free_mail:'That is a free email provider, not an employer’s domain, so it cannot be listed. Use the domain of your work email.',
 domain_disposable:'That is a disposable email provider, so it cannot be listed. Use the domain of your work email.',
};
/** The domain's own words are refused (worker/src/community.ts domainAbuseProblem), worded for the domain field. */
export const DOMAIN_ABUSIVE_MESSAGE='The domain’s words read as an insult, accusation or slur, or contain identifying details such as a person’s name, so it cannot be listed. Use the domain of your work email.';
/** Why a domain cannot be listed, checked on this device with the server's rules; null when it may be sent. */
export function domainProblem(domain:string,directory:ReadonlyArray<DirectoryCompany>=[]):{message:string;listed?:DirectoryCompany}|null {
 if(!domain)return {message:DOMAIN_MESSAGES.domain_empty};
 const rule=domainRule(domain);
 if(rule)return {message:DOMAIN_MESSAGES[rule]};
 if(domainAbuseProblem(domain))return {message:DOMAIN_ABUSIVE_MESSAGE};
 // The server also treats a subdomain of a listed domain (mail.acme.com under acme.com) as listed.
 const listed=directory.find(c=>(c.domains??[]).some(d=>{const own=d.toLowerCase();return domain===own||domain.endsWith(`.${own}`);}));
 if(listed)return {message:`${domain} is already listed, as ${listingName(listed)}. A domain can be listed only once.`,listed};
 return null;
}
/**
 * Why a name cannot be listed, checked on this device with the server's own name rules; null when it may be sent. With
 * the domain (once it passes the domain rules), a web address in the name must be that domain, as the server requires.
 * The server checks it again, and asks Jev whether it reads as an organization's name.
 */
export function nameProblem(name:string,domain?:string):string|null {
 if(!name)return 'Enter the employer’s name.';
 if(name.length<2||name.length>EMPLOYER_NAME_MAX)return `Use 2 to ${EMPLOYER_NAME_MAX} characters for the name.`;
 if(/@|:\/\/|\bwww\./i.test(name))return 'Use the employer’s name only, without an email address or link.';
 const found=scanText(name).find(f=>f.severity==='high');
 if(found)return `The name contains a detail the on-device checks mark as identifying (${found.what.toLowerCase()}). Use the employer’s name only.`;
 const rule=listingNameRule(name);
 if(rule==='name_identifying')return 'The name contains contact or identifying details, such as a person’s name or an address. Use the employer’s name only.';
 if(rule==='name_abusive')return 'The name reads as an insult or accusation rather than an employer’s name. Use the employer’s name only.';
 if(rule==='name_invalid')return `Use letters, digits and the punctuation names use (& . , ' - ( ) + ! / : #), at most 12 words, with no invisible characters, no mix of Latin, Cyrillic and Greek letters, and no long runs of one character.`;
 if(domain&&!domainRule(domain)&&listingNameRule(name,domain)==='name_identifying')return `The name contains a web address other than ${domain}, the domain it would be listed with. Use the employer’s name only.`;
 return null;
}
/** A directory employer as the server compares listings (worker/src/community.ts Listed): real employers only. */
const asListed=(c:DirectoryCompany):Listed=>({id:c.id,slug:c.slug,name:c.name,origin:c.origin==='community'?'community':'curated',aliases:(c.aliases??[]).map(a=>a.alias),domains:[...(c.domains??[])]});
/**
 * The real listings a typed name means, as the server decides it (namesListing: the same organization once legal-form
 * and generic words and look-alike letters are set aside, or one of its curated aliases). Curated listings first.
 */
export function namesakesOf(name:string,directory:ReadonlyArray<DirectoryCompany>):DirectoryCompany[] {
 if(!name)return [];
 const found=directory.filter(c=>c.kind==='real'&&namesListing(name,asListed(c)));
 return [...found.filter(c=>c.origin!=='community'),...found.filter(c=>c.origin==='community')];
}
/**
 * Whether the domain may attach to a curated listing this name means that has no domain yet (worker/src/community.ts
 * addEmployer: its registrable label is exactly the listing's name, a significant word of it or a curated alias; Jev
 * still decides on the server). Such a request goes to the server even when a same-name listing has a domain.
 */
export function mayAttach(name:string,domain:string,directory:ReadonlyArray<DirectoryCompany>):DirectoryCompany|null {
 const candidate=namesakesOf(name,directory).find(c=>c.origin!=='community'&&!(c.domains??[]).length)??null;
 return candidate&&sharesSignificantToken(domain,[candidate.name,...(candidate.aliases??[]).map(a=>a.alias)])?candidate:null;
}
/**
 * The server's duplicate checks that follow the domain check (worker/src/community.ts addEmployer), applied to the loaded
 * directory: a name that means a listing that already has a domain (409 name_already_listed; unless the domain may attach
 * to a curated listing of that name without a domain, which the server settles with Jev), then a domain named after
 * another listing that the typed name does not mean (409 domain_belongs_to_listed). Each names the listing, as the
 * server's refusal does. Null when neither applies; the server checks both again against the whole directory.
 */
export function listingConflict(name:string,domain:string,directory:ReadonlyArray<DirectoryCompany>):{code:'name_already_listed'|'domain_belongs_to_listed';message:string;listed:DirectoryCompany}|null {
 if(!name||!domain)return null;
 const taken=namesakesOf(name,directory).find(c=>(c.domains??[]).length);
 if(taken&&!mayAttach(name,domain,directory))return {code:'name_already_listed',message:addErrorMessage('name_already_listed',{company:taken}),listed:taken};
 const real=directory.filter(c=>c.kind==='real'),bySlug=new Map(real.map(c=>[c.slug,c]));
 const claimed=listingsNamedByDomain(domain,real.map(asListed));
 if(claimed.length&&!claimed.some(l=>namesListing(name,l))) {
  const listed=bySlug.get(claimed[0]!.slug)!;
  return {code:'domain_belongs_to_listed',message:addErrorMessage('domain_belongs_to_listed',{company:listed}),listed};
 }
 return null;
}
/** Refusals of POST /api/employers (worker/src/community.ts) in plain words; an unknown code is named, never guessed at. */
export const ADD_ERRORS:Record<string,string>={
 invalid_request:'The listing could not be read as sent, so nothing was added. Check the name and domain and try again.',
 name_invalid:`The name was not accepted: use 2 to ${EMPLOYER_NAME_MAX} characters of letters, digits and the punctuation names use. Nothing was added.`,
 name_identifying:'The name was not accepted because it contains contact or identifying details. Use the employer’s name only. Nothing was added.',
 name_abusive:'The name was not accepted because it reads as an insult or accusation rather than an employer’s name. Nothing was added.',
 name_not_organization:'The name was not accepted because it does not read as the name of an organization. Nothing was added.',
 ...DOMAIN_MESSAGES,
 domain_no_mx:'That domain has no mail servers, so no one could receive a verification code there. Nothing was added; check the spelling.',
 dns_unavailable:'The domain’s mail servers could not be checked right now, so nothing was added. Try again later.',
 checks_unavailable:'The listing checks are unavailable right now, so nothing was added. Try again later.',
 domain_already_listed:'That domain is already listed, so it cannot be listed again. Nothing was added.',
 // The two 409s below carry the listing they name ({company:{slug,name,domain?}}); addErrorMessage names it and the form links to it.
 name_already_listed:'An employer with this name is already listed with its own domain, so a second listing under the same name was not added. If you work there, open that listing; if this is a different organization, use a name that tells the two apart. Nothing was added.',
 domain_belongs_to_listed:'That domain carries the name of an employer already in the directory, so it cannot be listed under another name. Nothing was added.',
 domain_abusive:'The domain was not accepted because its words read as an insult, accusation or slur, or contain identifying details such as a person’s name. Use the domain of your work email. Nothing was added.',
 domain_name_mismatch:'That domain does not carry this organization’s name (a word of it, the whole name or its initials), and Jev did not confirm it as this organization’s email domain, so nothing was added. Use the domain of your work email, with the name of the organization it belongs to.',
 slug_unavailable:'An address for this listing could not be made from its name and domain, so nothing was added.',
 // POST /api/employers answers rate_limited two ways: this connection's daily listing attempts ({limit:'daily'}), or the
 // site's per-minute limit on requests from one connection (no limit field). addErrorMessage tells them apart.
 rate_limited:'Many requests arrived from this connection, so nothing was added. Wait a minute and try again.',
 rate_limited_daily:'This connection has used today’s listing attempts, so nothing was added. Try again tomorrow.',
 listing_daily_limit:'Today’s new listings for the whole site are used up, so nothing was added. Try again tomorrow.',
 listing_unavailable:'Adding employers is not open on this site right now, so nothing was added.',
 not_found:'Adding employers is not available on this site yet, so nothing was added.',
 method_not_allowed:'Adding employers is not available on this site yet, so nothing was added.',
 origin_not_allowed:'This request came from another site, so it was refused.',
 network_unavailable:'The connection failed before an answer came back, so the listing may or may not have been added. Look for it in the directory before trying again.',
 ...POW_ERRORS,
};
/**
 * The listing a refusal names (domain_already_listed, name_already_listed and domain_belongs_to_listed carry
 * {company:{slug,name,domain?}}; a directory entry with `domains` is read the same way), or null.
 */
export function namedListing(detail:Record<string,unknown>):{slug:string;name:string;domains:string[]}|null {
 const company=detail.company as {slug?:unknown;name?:unknown;domain?:unknown;domains?:unknown}|null|undefined;
 if(!company||typeof company!=='object'||typeof company.slug!=='string'||!company.slug||typeof company.name!=='string'||!company.name)return null;
 const domains=Array.isArray(company.domains)?company.domains.filter((d):d is string=>typeof d==='string'):typeof company.domain==='string'?[company.domain]:[];
 return {slug:company.slug,name:company.name,domains};
}
/** The plain words for a refusal of POST /api/employers, from its code and the rest of its body. */
export function addErrorMessage(code:string,detail:Record<string,unknown>={}):string {
 if(code==='rate_limited'&&detail.limit==='daily')return ADD_ERRORS.rate_limited_daily!;
 const named=namedListing(detail);
 if(named&&code==='name_already_listed')return `${listingName(named)} is already listed under this name${named.domains.length?', with its own domain':''}, so a second listing under the same name was not added. If you work there, open its record; if this is a different organization, use a name that tells the two apart. Nothing was added.`;
 if(named&&code==='domain_belongs_to_listed')return `That domain carries the name of ${listingName(named)}, an employer already in the directory, so it cannot be listed under another name. Nothing was added.`;
 return ADD_ERRORS[code]??`The listing was refused (${code}). Nothing was added.`;
}
