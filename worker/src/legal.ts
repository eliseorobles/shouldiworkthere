/**
 * Privacy policy, terms of use and accessibility statement.
 *
 * One structured source renders both the live HTML fragments (trust-document style: h1, lede, h2/h3, p, ul, ledger
 * table) and the Markdown review copies in docs/legal/*.md, so the two cannot drift. Inline text uses two markers
 * only: [label](href) for links (site paths, #anchors, mailto: and https:// only) and **bold**.
 *
 * Every statement must be true of the running code and configuration:
 * - numbers that code controls come from shared/policy.ts, ./interpretation.ts (the circuit breaker) or CODE_FACTS
 *   (checked against source in tests);
 * - passages that depend on switches (real-employer publication, real-employer and practice juries, in-product
 *   challenges, trustees, the crisis card, the rate-limit key) are selected from LegalConfig, which legalConfig()
 *   derives from env and the same checks the moderation module uses (./credentials.ts, shared/trustees.ts), from
 *   CODE_FACTS and from shared/safety.ts;
 * - facts only the owner can supply (shared/brand.ts) are described as pending until supplied, and legalOpenItems()
 *   lists them, marking the few that must be resolved before this version of the routes is served (contact mail that
 *   does not arrive, and version 1.2.0's notice question until counsel signs off on it) and labelling the EU, EEA and UK
 *   duties; by the owner's decision of 2026-09-22 (D13) the model provider's facts, the
 *   DMCA registration and the EU, EEA and UK representatives and assessments are not launch blockers;
 * - the EU, EEA and UK sections (GDPR and UK GDPR, the Digital Services Act, the UK Online Safety Act) render while
 *   SERVES_EU_UK is true; representatives and assessments are named or dated only once brand.ts records them.
 * The legal operator is named here and nowhere in product branding.
 */
import {
 BRAND, CANONICAL_ORIGIN, OPERATOR_DESCRIPTION, GOVERNING_LAW, VENUE, CONTACT, MINIMUM_AGE,
 LEGAL_VERSION, LEGAL_EFFECTIVE, LEGAL_FIRST_SERVED, LEGAL_CHANGELOG, LEGAL_REVIEWED, CONTACT_MAIL, MODEL_PROVIDER, DMCA_AGENT, OPERATOR_POSTAL_ADDRESS,
 OPERATOR_PHONE, TELEPHONE_PROVIDER, SERVES_EU_UK, EU_REPRESENTATIVE, UK_REPRESENTATIVE, DSA_LEGAL_REPRESENTATIVE,
 COMPLIANCE_ASSESSMENTS, THIRD_PARTY_SENSITIVE_DATA_BASIS, SUPPORT_CHECKS_SENSITIVE_DATA_BASIS, REGISTERED_AGENT, type Representative,
} from '../../shared/brand.ts';
import {policy, CONTRIBUTION_DERIVED_STATS, ownEmployerExcluded} from '../../shared/policy.ts';
import {JUROR_QUOTA, COMMUNITY_KEY_LIMITS, COMMUNITY_EMAIL_LIMITS} from '../../shared/proof.ts';
import {parseTrustees} from '../../shared/trustees.ts';
import {CRISIS_CARD_ENABLED} from '../../shared/safety.ts';
// From interpretation.ts, not ai.ts: pages.ts imports this module, and the public worker must never import the provider client.
import {BREAKER} from './interpretation.ts';
import {jurorProtocolAvailable} from './credentials.ts';
// Launch switches, read exactly as the rest of the main worker reads them (a leaf module: it imports only the policy).
import {samplesEnabled, testimonyBatchMin, aggregateMinimum} from './flags.ts';
import {listingOpen, LISTINGS_PER_CLIENT_PER_DAY, LISTINGS_PER_NETWORK_PER_DAY, COMMUNITY_LISTINGS_PER_DAY, MATCH_AT} from './community.ts';
import {powBits as configuredPowBits, POW_WINDOW_MINUTES} from '../../shared/pow.ts';

/**
 * The legal operator for /api/config (config.legal.operator). The operator is named in legal text only; this is the one
 * value other modules may pass on, so no other code file needs the operator constants from shared/brand.ts.
 */
export const LEGAL_NOTICE: Readonly<{operator: string}> = {operator: OPERATOR_DESCRIPTION};

export interface LegalConfig {
 /** env.REAL_PUBLICATION_ENABLED==='true' */
 realPublicationEnabled: boolean;
 /**
  * Anonymous juries and appeals run for real employers: env.JURY_ENABLED==='true' and the juror token protocol exists
  * (juryActive(env,'mailbox') in ./moderation.ts).
  */
 juryEnabled: boolean;
 /**
  * Practice juries and appeals run for fictional sample employers whenever the juror token protocol exists
  * (juryActive(env,'sandbox') in ./moderation.ts). Defaults to false.
  */
 practiceJuriesEnabled?: boolean;
 /** Anyone can challenge a published account in the product (moderationStatus().challengesEnabled). Defaults to true. */
 challengesEnabled?: boolean;
 /** The trustee exception process is operational: TRUSTEE_KEYS holds valid trustee keys (parseTrustees). Defaults to false. */
 trusteesEnabled?: boolean;
 /** web/ renders the on-device crisis card (CRISIS_CARD_ENABLED). Defaults to false. */
 crisisCardEnabled?: boolean;
 /** The publisher's rate-limit key is an HMAC with RATE_LIMIT_SECRET rather than an unkeyed SHA-256. Defaults to false. */
 rateLimitKeyed?: boolean;
 /**
  * The publisher runs the crisis phrase list (shared/safety.ts) on text a person sends and adds support resources to that
  * reply (main env CRISIS_RESOURCES_ENABLED==='true'). Defaults to false.
  */
 serverCrisisResources?: boolean;
 /**
  * Screening asks Jev one optional question: whether the author describes their own thoughts of suicide or self-harm
  * (inference env SELF_HARM_SCREENING==='true'; the public worker cannot read that env, so CODE_FACTS mirrors
  * inference.wrangler.jsonc and tests check it). Defaults to false.
  */
 selfHarmScreening?: boolean;
 /**
  * Fictional sample employers are shown (main env SAMPLE_EMPLOYERS, sampleEmployersOn; production sets 'off', so the live
  * site has none and practice juries cannot run there). Defaults to true.
  */
 sampleEmployers?: boolean;
 /**
  * Real-employer juries are switched on (env.JURY_ENABLED==='true' and the juror token protocol exists), whether or not
  * one can form now. pages.ts narrows juryEnabled to "can form now"; this keeps the configured switch so the pages can
  * say a jury is switched on but cannot form yet. Defaults to juryEnabled.
  */
 juryConfigured?: boolean;
 /** Written accounts are published in batches of at least this many (main env TESTIMONY_BATCH_MIN). Defaults to policy.retention.minimumBatch. */
 testimonyBatch?: number;
 /**
  * Anyone can add an employer (POST /api/employers): the main worker has the VERIFIER and INFERENCE bindings, an
  * INTERNAL_TOKEN of full length and, outside local development, RATE_LIMIT_SECRET (communityListingsOpen). Defaults to true.
  */
 communityListings?: boolean;
 /** Proof-of-work difficulty in leading zero bits (shared/pow.ts powBits of the main env POW_BITS). Defaults to POW_BITS. */
 powBits?: number;
}
/** The env fields legalConfig reads. */
export interface LegalEnv {REAL_PUBLICATION_ENABLED?: string; RATE_LIMIT_SECRET?: string; JURY_ENABLED?: string; TRUSTEE_KEYS?: string; CRISIS_RESOURCES_ENABLED?: string; SAMPLE_EMPLOYERS?: string; TESTIMONY_BATCH_MIN?: string; POW_BITS?: string; INTERNAL_TOKEN?: string; VERIFIER?: unknown; INFERENCE?: unknown; ENVIRONMENT?: string;}
/** Fictional sample employers are shown only while the main env sets SAMPLE_EMPLOYERS to 'on' (flags.ts samplesEnabled; production sets 'off'). */
export const sampleEmployersOn = (env: {SAMPLE_EMPLOYERS?: string}) => samplesEnabled(env);
/** The written-account batch size (flags.ts testimonyBatchMin: TESTIMONY_BATCH_MIN, never below the policy's minimum batch). */
export const testimonyBatchSize = (env: {TESTIMONY_BATCH_MIN?: string}) => testimonyBatchMin(env);
/**
 * Anyone can list an employer (community.ts listingOpen): the VERIFIER binding, an INTERNAL_TOKEN of full length, the
 * INFERENCE binding and, outside local development, RATE_LIMIT_SECRET. Without any of them listing is closed.
 */
export const communityListingsOpen = (env: LegalEnv) => listingOpen(env as Parameters<typeof listingOpen>[0]);
/**
 * The configuration the running worker is in. Pass the worker env; switches come from env, the same checks the
 * moderation module applies, CODE_FACTS and safety.ts. pages.ts narrows real-employer juries, challenges and trustees with
 * moderationStatus(), which also requires live juror keys, so a page never says a real-employer jury decides when none can form.
 */
export function legalConfig(env: LegalEnv, overrides: Partial<LegalConfig> = {}): LegalConfig {
 const protocol = jurorProtocolAvailable(), keyed = typeof env.RATE_LIMIT_SECRET === 'string' && env.RATE_LIMIT_SECRET.length > 0;
 const samples = sampleEmployersOn(env), jury = protocol && env.JURY_ENABLED === 'true';
 return {
  realPublicationEnabled: env.REAL_PUBLICATION_ENABLED === 'true',
  juryEnabled: jury,
  juryConfigured: jury,
  // Practice juries need fictional employers: with SAMPLE_EMPLOYERS off there are none, so none can run.
  practiceJuriesEnabled: protocol && samples,
  sampleEmployers: samples,
  testimonyBatch: testimonyBatchSize(env),
  communityListings: communityListingsOpen(env),
  powBits: configuredPowBits(env.POW_BITS),
  // moderation.ts challengesOpen(): the daily challenge budget is stored under a keyed hash, so challenges are closed without the secret.
  challengesEnabled: CODE_FACTS.challengesEnabled && keyed,
  trusteesEnabled: parseTrustees(env.TRUSTEE_KEYS) !== null,
  crisisCardEnabled: CRISIS_CARD_ENABLED,
  rateLimitKeyed: keyed,
  serverCrisisResources: env.CRISIS_RESOURCES_ENABLED === 'true',
  selfHarmScreening: CODE_FACTS.selfHarmScreening,
  ...overrides,
 };
}
/**
 * The worker environment docs/legal/*.md is rendered for: the vars in wrangler.jsonc as they stand for production
 * (real-employer publication and juries on, no fictional employers, written accounts in batches of TESTIMONY_BATCH_MIN).
 * tests/safety.test.ts checks every value against wrangler.jsonc. Secrets and bindings are added by reviewConfig().
 */
export const REVIEW_ENV: Readonly<LegalEnv> = {REAL_PUBLICATION_ENABLED: 'true', JURY_ENABLED: 'true', CRISIS_RESOURCES_ENABLED: 'true', SAMPLE_EMPLOYERS: 'off', TESTIMONY_BATCH_MIN: '5'};
/**
 * The main worker's secrets the review copy assumes are set: exactly those docs/operations.md marks as required in
 * production (and wrangler.jsonc secrets.required, where it lists any), checked by tests/safety.test.ts. The values are
 * placeholders; only their presence matters. TRUSTEE_KEYS is never assumed.
 */
export const REVIEW_SECRETS: Readonly<Pick<LegalEnv, 'RATE_LIMIT_SECRET' | 'INTERNAL_TOKEN'>> = {RATE_LIMIT_SECRET: 'required-in-production', INTERNAL_TOKEN: 'required-in-production-on-both-workers'};
/** The review configuration: REVIEW_ENV, REVIEW_SECRETS and the service bindings wrangler.jsonc declares (INFERENCE, VERIFIER). */
export const reviewConfig = (): LegalConfig => legalConfig({...REVIEW_ENV, ...REVIEW_SECRETS, INFERENCE: 'service binding', VERIFIER: 'service binding'});

/**
 * Values fixed in code outside shared/policy.ts. tests/safety.test.ts checks each one against its source, so a code
 * change that would make the legal text false fails the tests.
 */
export const CODE_FACTS = {
 /** worker/issuer.ts: challenge expiry 15*60000 ms. */
 codeMinutes: 15,
 /** worker/issuer.ts: no email once 3 unexpired challenges exist for the mailbox. */
 codeEmailsPerWindow: 3,
 /** worker/src/submissions.ts eligibility(): 12–66 hours, rounded up to the next 6-hour boundary. */
 publicationDelayHours: {min: 12, max: 72},
 /** worker/inference.ts /rank: ids max(12). */
 rankLimit: 12,
 /** wrangler.jsonc and issuer.wrangler.jsonc rate limits: period 60. */
 limiterWindowSeconds: 60,
 /** wrangler.jsonc cron "0 *\/6 * * *". */
 publisherJobHours: 6,
 /** issuer.wrangler.jsonc cron "*\/15 * * * *". */
 verifierJobMinutes: 15,
 /** Cloudflare Email Service activity log, per Cloudflare's documentation: filterable up to 30 days. */
 emailRecordDays: 30,
 /** Cloudflare D1 point-in-time recovery window. */
 recoveryDays: 30,
 /** Location of the three production D1 databases (Cloudflare region WNAM), as configured on 2026-09-22. */
 databaseRegion: 'western North America',
 /** worker/src/moderation.ts: the challenge route exists; it is open only while RATE_LIMIT_SECRET is set (challengesOpen). */
 challengesEnabled: true,
 /**
  * web/submit.tsx asks for explicit consent to special category data about the author (a statement containing
  * "sensitive information about me"), sent as sensitiveConsent and stored only as a yes/no on the intake row. Until it
  * does, the privacy policy does not claim that consent.
  */
 specialCategoryConsent: true,
 /** worker/src/submissions.ts submitSchema requires adultConfirmed:true, so a submission without the 18+ confirmation is refused. */
 adultConfirmationEnforced: true,
 /** inference.wrangler.jsonc vars SELF_HARM_SCREENING==='true': screening asks Jev the optional self-harm question. */
 selfHarmScreening: true,
 /** worker/inference-core.ts BUDGETS: model calls per UTC day and purpose (live: Live understanding; relevance: challenge reasons). */
 dailyModelCalls: {search: 45000, live: 45000, screen: 5000, analysis: 4000, relevance: 1000},
 /**
  * worker/src/submissions.ts publishDue groups approved contributions by company_id and verification_class (policy 0.8.0
  * retention.batches): a batch is formed within one employer and verification type, across reporting quarters.
  */
 publicationGroup: 'employer and verification type',
 /**
  * Employers added by the community (worker/src/app.ts POST /api/employers, shared/domains.ts): the longest name accepted,
  * the Jev probability needed to attach a domain to an existing listing that has none, and the DNS-over-HTTPS resolver
  * that looks up the domain's mail (MX) records.
  */
 employerNameMaxChars: 80,
 domainPlausibility: 0.85,
 dnsResolver: 'cloudflare-dns.com',
 /**
  * shared/pow.ts: the proof of work the browser computes (in a Web Worker) before /start and /issue-juror at the verifier
  * and POST /api/employers at the publisher: SHA-256 hashcash with about this many leading zero bits, bound to the site,
  * the action, the key, a digest of what the request concerns and the UTC minute, accepted within this many minutes.
  */
 powBits: 20,
 powMinutes: 2,
 /** worker/inference-core.ts BACKFILL_LIMIT, run by the hourly inference cron. */
 backfillPerRun: 10,
 /** inference.wrangler.jsonc binds no VECTORIZE index, so the retrieval step answers without a model call. */
 semanticIndex: false,
 /**
  * worker/issuer.ts sends the same email, with a code, whether or not a credential (or the juror token limit) was already
  * issued this quarter, and applies that limit only when the code is used. false: a notice replaces the code.
  */
 identicalVerifierEmails: true,
 /**
  * Daily network records, kept only while RATE_LIMIT_SECRET is set: HMAC(secret, UTC day, purpose, SHA-256 of the IP
  * address), in the public database (interest_seen: FAQ interest counted once per question and day, worker/src/app.ts
  * firstToday) and the intake database (daily_budgets: the daily challenge budget, worker/src/moderation.ts), deleted
  * after the day by the scheduled jobs. Without the secret nothing derived from an IP address is stored: interest is
  * not counted and challenges are closed.
  */
 dailyNetworkDigests: true,
 /**
  * worker/src/network.ts and shared/proof.ts networkKey: every per-client key (publisher and verifier rate limits, daily
  * network records) uses an IPv4 address as is and an IPv6 address cut to its /64 prefix.
  */
 ipv6PrefixBits: 64,
} as const;
const RETENTION = policy.retention;
/** Months after withdrawal or expiry at which the minimal record loses its capability hash, employer and periods (policy.retention.erasedRecordsMonths; submissions.ts scrubErased). */
const erasedRecordsMonths = (): number | null => (RETENTION as {erasedRecordsMonths?: number}).erasedRecordsMonths ?? null;
/** The daily challenge budget per network (policy.challenges.budget; moderation.ts spendDaily), or null. */
const challengeBudget = () => (policy.challenges as {budget?: {perClientPerDay: number; notRelevantExtra: number}}).budget ?? null;
/** Seeded fictional fixtures cannot be withheld by a challenge or a jury (policy.challenges.fixtures; moderation.ts 'practice_fixture'). */
const fixturesProtected = () => typeof (policy.challenges as {fixtures?: unknown}).fixtures === 'string';
/** A relevant challenge whose re-check cannot run at once is queued with a receipt, never refused (policy.challenges.queue; moderation.ts challenge_queue). */
const challengesQueued = () => typeof (policy.challenges as {queue?: unknown}).queue === 'string';
/** Daily re-checks reserved for the privacy and safety rules, and those rules (policy.challenges.hostedChecksPerDay.urgentRecheck, urgentRules), or null. */
const urgentRechecks = (): {perDay: number; rules: readonly string[]} | null => {
 const perDay = (policy.challenges.hostedChecksPerDay as {urgentRecheck?: number}).urgentRecheck, rules = (policy.challenges as {urgentRules?: readonly string[]}).urgentRules;
 return typeof perDay === 'number' && rules?.length ? {perDay, rules} : null;
};
/** Juror tokens reach a mailbox once per employer and quarter, as one set (policy.jury.tokens; issuer.ts /issue-juror). */
const jurorTokenSet = () => typeof (policy.jury as {tokens?: unknown}).tokens === 'string';
/** '3 juror tokens' or 'one set of up to 3 juror tokens', as the policy issues them. */
const jurorAllowance = (noun = 'juror tokens') => jurorTokenSet() ? `one set of up to ${JUROR_QUOTA} ${noun}` : `up to ${JUROR_QUOTA} ${noun}`;
/** Moderation counts that follow contributions are rounded like contribution counts and refreshed daily (shared/policy.ts CONTRIBUTION_DERIVED_STATS; moderation.ts storedCount). */
const roundedModerationCounts = () => CONTRIBUTION_DERIVED_STATS.length > 0;
/** The IPv6 sentence for per-network keys. */
const ipv6Note = `For an IPv6 address, these keys use only its /${CODE_FACTS.ipv6PrefixBits} network prefix, which one household, line or server usually holds.`;
const REVISE_REPLAY_DAYS = RETENTION.approvedUnbatchedDays + 1;
const BREAKER_MINUTES = BREAKER.windowMs / 60000;

export type LegalBlock =
 | {p: string}
 | {note: string}
 | {h3: string}
 | {ul: string[]}
 | {table: {caption: string; head: string[]; rows: string[][]}};
export interface LegalSection {id: string; heading: string; blocks: LegalBlock[];}
export type LegalSlug = 'privacy' | 'terms' | 'accessibility';
export interface LegalDocument {slug: LegalSlug; title: string; lede: string; sections: LegalSection[];}

/** Route metadata for wiring the pages (round 3): path, <title> text and meta description. */
export const LEGAL_PAGES: Readonly<Record<LegalSlug, {path: string; title: string; description: string; markdown: string}>> = {
 privacy: {path: '/privacy', title: 'Privacy policy', description: `What ${BRAND} collects, where it goes, how long it stays and what you can do about it.`, markdown: 'docs/legal/privacy-policy.md'},
 terms: {path: '/terms', title: 'Terms of use', description: `The rules for using and contributing to ${BRAND}.`, markdown: 'docs/legal/terms.md'},
 accessibility: {path: '/accessibility', title: 'Accessibility statement', description: `How accessible ${BRAND} is today, the known gaps and how to report a problem.`, markdown: 'docs/legal/accessibility.md'},
};

/**
 * blocksLaunch: must be resolved before this version of /privacy and /terms is served, because the pages would otherwise
 * point people at contact addresses that do not receive mail, or (change-notice) because serving this version would
 * break a promise the previous version made. euUk: a duty under the GDPR, UK GDPR, Digital Services Act or UK
 * Online Safety Act. It is a label only, not a launch gate: the owner decided on 2026-09-22 (D13) that the EU, EEA and UK
 * representatives and assessments, the model provider's facts and the DMCA registration do not block launch. Every open
 * item stays disclosed on the pages as pending or not yet confirmed until brand.ts records it.
 */
export interface LegalOpenItem {id: string; blocksLaunch: boolean; euUk?: true; detail: string;}
/**
 * Owner-supplied facts that are still missing. Items with blocksLaunch must be resolved before /privacy and /terms
 * are served. The others, including every item labelled euUk, are owner and counsel follow-ups; the pages say each
 * one is pending until it is resolved.
 */
export function legalOpenItems(config: LegalConfig = reviewConfig()): LegalOpenItem[] {
 const items: LegalOpenItem[] = [];
 const addresses = `${CONTACT.privacy}, ${CONTACT.legal} and ${CONTACT.dmca}`;
 if (!CONTACT_MAIL.routingEnabled) items.push({id: 'email-routing', blocksLaunch: true, detail: `Cloudflare Email Routing is not enabled for shouldiworkthere.com (no MX records), so ${addresses} do not receive mail.`});
 else if (!CONTACT_MAIL.forwardingVerified) items.push({id: 'email-routing', blocksLaunch: true, detail: `Cloudflare Email Routing MX and SPF records exist for shouldiworkthere.com, but delivery has not been tested. Send a test message to each of ${addresses} and set CONTACT_MAIL.forwardingVerified once all three arrive.`});
 if (!CONTACT_MAIL.mailboxProvider) items.push({id: 'mailbox-provider', blocksLaunch: true, detail: 'The provider that stores mail forwarded from the contact addresses is not named.'});
 else if (SERVES_EU_UK && !CONTACT_MAIL.mailboxTransfer) items.push({id: 'mailbox-transfer', blocksLaunch: false, detail: `The safeguard for EU, EEA and UK personal data stored by ${CONTACT_MAIL.mailboxProvider} is not stated.`});
 if (!modelProviderComplete()) {
  const facts = ['legal entity', 'processing location', 'retention of inputs', 'training use', 'data processing agreement', ...(SERVES_EU_UK ? ['safeguard for transfers of EU, EEA and UK personal data'] : [])];
  items.push({id: 'model-provider', blocksLaunch: false, detail: `${MODEL_PROVIDER.name}'s ${list(facts)} are not confirmed. The privacy policy says so.`});
 }
 if (!TELEPHONE_PROVIDER.name || (SERVES_EU_UK && !TELEPHONE_PROVIDER.transfer)) items.push({id: 'telephone-provider', blocksLaunch: false, detail: `The company that carries calls to ${OPERATOR_PHONE} (and stores any voicemail) is not named${SERVES_EU_UK ? ', and the safeguard for EU, EEA and UK personal data it handles is not stated' : ''}. The privacy policy lists it by category until it is.`});
 if (!dmcaAgentComplete()) items.push({id: 'dmca-agent', blocksLaunch: false, detail: 'The DMCA designated agent is not registered with the US Copyright Office, and its name, postal address and telephone number are not published.'});
 if (!LEGAL_REVIEWED) items.push({id: 'counsel-review', blocksLaunch: false, detail: `Counsel has not reviewed version ${LEGAL_VERSION} (LEGAL_REVIEWED_VERSION in shared/brand.ts is not ${LEGAL_VERSION}), so every live legal page shows a draft notice. Commitments that need approval include: acknowledging notices and challenges normally within 5 business days, the US$100 liability cap, having no arbitration clause, Texas state and federal courts as the venue (no county is named), 30 days’ notice of material changes, and the correction process for employer listings added by the community.`});
 // Version 1.2.0 takes effect the day after 1.1.0 was first served, and 1.1.0 promised 30 days' notice of material changes
 // and a batch of at least 25 for every contribution it accepted. The publication code keeps that batch for contributions
 // submitted before LEGAL_EFFECTIVE (submissions.ts publishDue and legacyBatchMin, policy retention.legacyBatch), so the
 // notice question is for counsel while this version is not recorded as reviewed, and it blocks launch only if the code
 // stops keeping the 1.1.0 batch. Recording counsel's approval of this exact version (LEGAL_REVIEWED_VERSION) closes it.
 const legacy = legacyBatch();
 if (!LEGAL_REVIEWED && LEGAL_VERSION === '1.2.0') items.push({id: 'change-notice', blocksLaunch: legacy === null, detail: `Version 1.2.0 takes effect on ${longDate(LEGAL_EFFECTIVE)}, one day after version 1.1.0 was first served (${longDate(LEGAL_FIRST_SERVED)}), although 1.1.0 promised to post material changes 30 days before they take effect. Counsel decides whether 1.2.0’s changes (publication of written accounts in batches of at least five instead of 25, employer listings by anyone, proof of work) are material; if they are, 1.2.0 cannot take effect on ${longDate(LEGAL_EFFECTIVE)}. ${legacy
  ? `Contributions accepted under 1.1.0 keep the batch it promised: the publication code publishes an account submitted before ${longDate(legacy.submittedBefore)} only in a batch of at least ${legacy.minimumBatch} such accounts for the same employer, reporting quarter and verification type, as the privacy policy and the terms now say.`
  : `The privacy policy also says a change that allows new uses of data already held applies only to data collected after it takes effect, and every contribution accepted under 1.1.0 was promised a batch of at least 25, while the publication code applies the new batch size to every approved contribution. So the release must not be deployed before ${longDate(LEGAL_EFFECTIVE)} (UTC) or while any real (not sandbox) contribution submitted before that day remains in the intake database, unless counsel decides how it is handled; docs/operations.md gives the check.`} Recording counsel’s approval of this exact version (LEGAL_REVIEWED_VERSION) closes this item.`});
 if (!REGISTERED_AGENT.name || !REGISTERED_AGENT.address) items.push({id: 'registered-agent', blocksLaunch: false, detail: 'The pages give only a private mailbox (PMB) as the postal address for legal notices; no registered agent or street address for service of process is named. Decide with counsel whether to name one (REGISTERED_AGENT).'});
 if (SERVES_EU_UK) {
  const eu = {blocksLaunch: false, euUk: true} as const;
  if (!representativeNamed(EU_REPRESENTATIVE)) items.push({id: 'eu-representative', ...eu, detail: 'No representative in the EU under GDPR Article 27 is appointed. The privacy policy says the appointment is pending. The Article 27(2) exception is unlikely to cover continuous processing that can include special category data.'});
  if (!representativeNamed(UK_REPRESENTATIVE)) items.push({id: 'uk-representative', ...eu, detail: 'No representative in the UK under UK GDPR Article 27 is appointed. The privacy policy says the appointment is pending.'});
  if (!representativeNamed(DSA_LEGAL_REPRESENTATIVE)) items.push({id: 'dsa-legal-representative', ...eu, detail: 'No legal representative in the EU under Digital Services Act Article 13 is appointed; the Act has no size exemption for it. The terms say the appointment is pending. Once one is, add an official language of its member state to the languages we use with authorities (Article 11).'});
  if (!COMPLIANCE_ASSESSMENTS.dpia) items.push({id: 'dpia', ...eu, detail: 'The data protection impact assessment (GDPR Article 35) is being prepared and is not complete. Article 35(1) requires it before the processing starts. The privacy policy says it is in preparation.'});
  const osa = osaPending();
  if (osa.length) items.push({id: 'uk-online-safety-assessments', ...eu, detail: `The UK Online Safety Act ${list(osa)} ${osa.length > 1 ? 'are' : 'is'} not complete. A new user-to-user service completes ${osa.length > 1 ? 'them' : 'it'} before UK users can access it. The terms say ${osa.length > 1 ? 'they are' : 'it is'} not yet complete.`});
  if (!CODE_FACTS.specialCategoryConsent) items.push({id: 'special-category-consent', ...eu, detail: 'The submission form does not ask for explicit consent to sensitive information about the author (GDPR Article 9(2)(a)), which covers screening, storage and any hold before publication. Add a statement to web/submit.tsx that contains "sensitive information about me", then set CODE_FACTS.specialCategoryConsent. The privacy policy says the statement is not in the form yet.'});
  if (!THIRD_PARTY_SENSITIVE_DATA_BASIS) items.push({id: 'third-party-sensitive-data-basis', ...eu, detail: 'Counsel has not chosen the Article 9 condition, or the national freedom-of-expression exemption (GDPR Article 85; UK Data Protection Act 2018), for sensitive information about other people that is published despite the content rules. Set THIRD_PARTY_SENSITIVE_DATA_BASIS. The privacy policy says it is not yet confirmed.'});
  if (supportChecks(config).length && !SUPPORT_CHECKS_SENSITIVE_DATA_BASIS) items.push({id: 'support-checks-sensitive-data-basis', ...eu, detail: `Counsel has not confirmed the Article 9 condition for the server’s support-resources checks (${list(supportChecks(config))}), which handle text that may reveal the author’s health only to offer support resources and store nothing. Set SUPPORT_CHECKS_SENSITIVE_DATA_BASIS. The privacy policy says it is not yet confirmed.`});
 }
 return items;
}
/** The open items that stop the legal pages being served (blocksLaunch only; EU, EEA and UK items are not launch gates, D13). */
export const legalLaunchBlockers = (config: LegalConfig = reviewConfig()): LegalOpenItem[] => legalOpenItems(config).filter(item => item.blocksLaunch);
/** The server-side support-resources checks that are on, named for the pages. */
const supportChecks = (config: LegalConfig) => [config.serverCrisisResources && 'the publisher’s crisis phrase check', config.selfHarmScreening && 'Jev’s optional self-harm question during screening'].filter((x): x is string => !!x);
const dmcaAgentComplete = () => DMCA_AGENT.registered && !!DMCA_AGENT.name && !!DMCA_AGENT.postalAddress && !!DMCA_AGENT.phone;
const modelProviderComplete = () => !!MODEL_PROVIDER.legalName && !!MODEL_PROVIDER.location && !!MODEL_PROVIDER.handling && (!SERVES_EU_UK || !!MODEL_PROVIDER.transfer);
/** A representative is named on the pages only once it is appointed and has a name and an address. */
const representativeNamed = (rep: Representative) => rep.appointed && !!rep.name && !!rep.address;
/** UK Online Safety Act assessments that are not complete. */
const osaPending = () => [!COMPLIANCE_ASSESSMENTS.ukIllegalContentRisk && 'illegal content risk assessment', !COMPLIANCE_ASSESSMENTS.ukChildrenAccess && 'children’s access assessment'].filter((x): x is string => !!x);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** '2026-09-22' → 'September 22, 2026' (fixed, locale-independent). */
export function longDate(iso: string) {
 const [y, m, d] = iso.split('-').map(Number);
 return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const words = (n: number) => WORDS[n] ?? String(n);
const mail = (address: string) => `[${address}](mailto:${address})`;
const P = (p: string): LegalBlock => ({p});
const H3 = (h3: string): LegalBlock => ({h3});
const UL = (...ul: string[]): LegalBlock => ({ul});
const TABLE = (caption: string, head: string[], rows: string[][]): LegalBlock => ({table: {caption, head, rows}});
const list = (items: string[], and = 'and') => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${and} ${items.at(-1)}`;
/** Published versions only; review drafts that were never served are listed in the Markdown review header instead. */
const changelog = () => TABLE('Version history', ['Version', 'Effective', 'What changed'], LEGAL_CHANGELOG.filter(c => !c.draft).map(c => [c.version, longDate(c.effective), c.summary]));
const contacts = () => UL(`Privacy questions and requests: ${mail(CONTACT.privacy)}`, `Legal notices: ${mail(CONTACT.legal)}`, `Copyright notices: ${mail(CONTACT.dmca)}`, `Postal mail: ${OPERATOR_POSTAL_ADDRESS}`, `Telephone: ${OPERATOR_PHONE}`);
/** Where legal notices go. The terms (Legal notices and court orders) and the /legal-requests page use this one sentence. */
const sendLegalNotices = () => `Send legal notices, including court orders and subpoenas, to ${mail(CONTACT.legal)} or by post to ${OPERATOR_DESCRIPTION}, ${OPERATOR_POSTAL_ADDRESS}.`;
/** “Representative in the EU (GDPR Article 27): …”, naming it only once it is appointed. */
const representativeItem = (label: string, article: string, rep: Representative) => representativeNamed(rep)
 ? `**${label}** (${article}): ${rep.name ?? ''}, ${rep.address ?? ''}${rep.email ? `, ${mail(rep.email)}` : ''}.`
 : `**${label}** (${article}): pending. We have not appointed one yet. Until we name one here, contact us directly.`;
const trusteeRule = () => `${words(policy.exceptions.requiredSignatures)}-of-${words(policy.exceptions.trustees)}`;
const modelProviderName = () => MODEL_PROVIDER.legalName ?? MODEL_PROVIDER.name;
/**
 * The switches every document reads, with their defaults applied. jury: a real-employer jury runs (can form);
 * juryPending: real-employer juries are switched on but none can form yet; samples: fictional employers exist; sandbox:
 * practice juries for them run; practice: some kind of jury (and so juror tokens) is described.
 */
const switches = (config: LegalConfig) => {
 const samples = config.sampleEmployers !== false, sandbox = samples && config.practiceJuriesEnabled === true;
 return {
  jury: config.juryEnabled,
  juryPending: !config.juryEnabled && config.juryConfigured === true,
  samples,
  sandbox,
  practice: config.juryEnabled || sandbox,
  challenges: config.challengesEnabled !== false,
  trustees: config.trusteesEnabled === true,
  serverCrisis: config.serverCrisisResources === true,
  selfHarm: config.selfHarmScreening === true,
  batch: config.testimonyBatch ?? RETENTION.minimumBatch,
  // Listing needs the rate-limit secret for its daily network record (community.ts listingOpen).
  community: config.communityListings !== false && config.rateLimitKeyed === true,
 };
};
/** Questionnaire figures need groups and answers of at least this many (flags.ts aggregateMinimum; policy 0.8.0 retention.aggregateMinimum). */
const AGGREGATE_MIN = (RETENTION as {aggregateMinimum?: number}).aggregateMinimum ?? RETENTION.minimumBatch;
/**
 * The batch contributions accepted under legal 1.1.0 keep (policy 0.8.0 retention.legacyBatch: submitted before
 * submittedBefore, which equals LEGAL_EFFECTIVE; worker/src/submissions.ts publishDue batches them only with each other, per
 * employer, reporting period and verification type, at legacyBatchMin), or null under a policy without the rule.
 */
const legacyBatch = (): {submittedBefore: string; minimumBatch: number} | null => (RETENTION as {legacyBatch?: {submittedBefore: string; minimumBatch: number}}).legacyBatch ?? null;
/** ' An account submitted before September 23, 2026, under the previous version …', or ''. Never below the configured batch (legacyBatchMin). */
const legacyBatchSentence = (config: LegalConfig) => {
 const legacy = legacyBatch();
 return legacy ? ` An account submitted before ${longDate(legacy.submittedBefore)}, under the previous version of these documents, keeps the rule it was accepted under: it is published only in a batch of at least ${Math.max(legacy.minimumBatch, switches(config).batch)} accounts submitted before that day, for the same employer, reporting quarter and verification type, and never together with later accounts.` : '';
};
/** 'a batch of at least 5 accepted contributions for the same employer, reporting quarter and verification type'. */
const batchRule = (config: LegalConfig, noun = 'accepted contributions') => `a batch of at least ${switches(config).batch} ${noun} for the same ${CODE_FACTS.publicationGroup}`;
const MODERATION_RECORDS = `${words(RETENTION.moderationRecordsQuarters)} quarters`;
const telephoneProvider = () => TELEPHONE_PROVIDER.name ?? 'Our telephone provider (not yet named)';
/** The keyed-hash wording for values keyed with RATE_LIMIT_SECRET (publisher limiter keys, jury seat groups, daily network hashes). */
const publisherHash = (config: LegalConfig) => config.rateLimitKeyed ? 'a keyed hash (HMAC-SHA-256 with a secret key)' : 'a SHA-256 hash';
/** Seats a single token employer may fill on one case, per jury class, from the policy (null: no cap). */
const seatCap = (juryClass: 'mailbox' | 'sandbox'): number | null => (policy.jury.seatsPerEmployer as Record<string, number | null>)[juryClass] ?? null;
/**
 * Seats all juror tokens of community-created keys fill together on one case (policy 0.8.0 jury.communitySeatsPerCase;
 * moderation.ts seatGroup), whichever listing they name, or null under a policy without the rule. Those employers never
 * count toward whether a jury can form (moderation.ts jurorEmployers counts curated juror keys only).
 */
const communitySeats = (): number | null => {const seats = (policy.jury as {communitySeatsPerCase?: number}).communitySeatsPerCase; return typeof seats === 'number' ? seats : null;};
/** The sentence about community jurors on real-employer juries, or '' under a policy without the rule. */
const communityJurors = () => {
 const seats = communitySeats();
 return seats === null ? '' : ` Anyone who controls a domain can add it to the directory and obtain juror tokens for it, so the juror tokens of employers added by the community, including tokens for a domain someone added to one of our listings, count as one group whichever listing they name: together they fill at most ${words(seats)} seat${seats === 1 ? '' : 's'} on a case, and those employers never count toward whether a jury can form.`;
};
/**
 * 'enough jurors of other fictional employers can serve on an appeal': who must be able to serve before a jury or appeal
 * can form, as moderation.ts staffable() counts them. Only jurors of other employers count where the policy keeps jurors
 * off their own employer's cases (ownEmployerExcluded: real employers always, fictional employers before policy 0.7.0);
 * any juror of the class counts otherwise. scope 'all' covers real and practice juries together.
 */
function enoughJurors(scope: 'practice' | 'real' | 'all', on = ''): string {
 const real = ownEmployerExcluded('mailbox'), fictional = ownEmployerExcluded('sandbox'), where = on ? ` ${on}` : '';
 if (scope === 'practice') return `enough jurors${fictional ? ' of other fictional employers' : ''} can serve${where}`;
 if (scope === 'real') return `enough jurors${real ? ' of other employers' : ''} can serve${where}`;
 if (real === fictional) return `enough jurors${real ? ' of other employers' : ''} can serve${where}`;
 return `enough jurors can serve${where} (for a case about a ${real ? 'real' : 'fictional'} employer, jurors of other ${real ? '' : 'fictional '}employers)`;
}
/** The enoughJurors scope for the juries that run: real employers alone when no practice juries run. */
const juryScope = (config: LegalConfig): 'real' | 'all' => switches(config).sandbox ? 'all' : 'real';
/**
 * Real-employer juries switched on (JURY_ENABLED) while none can form, because too few other employers publish juror
 * keys (moderation.ts juryCanForm). Held cases then stay held, as when juries are off.
 */
const pendingJuries = () => `Anonymous juries of ${policy.jury.initial} randomly selected people for real employers, with appeals to ${policy.jury.appeal} different people, are switched on, but one forms only when ${enoughJurors('real')}, and none can yet`;
/**
 * Whether a seat can be on a case about the employer the token names, for the juries that run (moderation.ts assign:
 * a juror of a class with ownEmployerExcluded is never drawn for a case about their token's employer).
 */
function ownEmployerSentence(config: LegalConfig): string {
 const {jury, sandbox} = switches(config);
 const classes = ([jury && 'mailbox', sandbox && 'sandbox'] as const).filter((c): c is 'mailbox' | 'sandbox' => !!c);
 const excluded = classes.filter(c => ownEmployerExcluded(c)), allowed = classes.filter(c => !ownEmployerExcluded(c));
 const token = {mailbox: 'a work-mailbox token', sandbox: 'a practice token'}, named = {mailbox: 'the employer it names', sandbox: 'the fictional employer it names'};
 if (!classes.length || !allowed.length) return ' It is never a case about your token’s employer.';
 if (!excluded.length) return classes.length === 1 && classes[0] === 'sandbox' ? ' A practice token can be drawn for a case about the fictional employer it names.' : ' It can be a case about the employer your token names.';
 return ` ${upperFirst(token[excluded[0]!])} is never drawn for a case about its own employer; ${token[allowed[0]!]} can be drawn for a case about ${named[allowed[0]!]}.`;
}
const {dailyModelCalls} = CODE_FACTS;
/**
 * The daily email limits for employers added by the community (shared/proof.ts COMMUNITY_EMAIL_LIMITS; worker/issuer.ts
 * communityEmailAllowed at /start): over either, /start answers as usual and sends nothing.
 */
const communityEmailLimit = () => `For an employer added by the community, or a domain someone added to one of our listings, the verifier also sends at most ${n(COMMUNITY_EMAIL_LIMITS.perEmployerPerDay)} verification emails per UTC day for that employer, and ${n(COMMUNITY_EMAIL_LIMITS.allCommunityPerDay)} per UTC day for all such employers together; over either limit, a request is answered in the same way and no email is sent, so anyone can use up an employer’s emails for the day, and a code requested after that may not arrive until the next UTC day.`;
/**
 * The seat-group sentence for the juries that run and whose policy caps seats per token employer: the seat records a
 * hash of the case and the token's employer, keyed with RATE_LIMIT_SECRET when it is set.
 */
function seatGroupSentence(config: LegalConfig): string {
 const on = switches(config), mailbox = on.jury ? seatCap('mailbox') : null, sandbox = on.sandbox ? seatCap('sandbox') : null;
 if (mailbox === null && sandbox === null) return '';
 const where = mailbox !== null && sandbox !== null ? (mailbox === sandbox ? 'On every case' : 'On a real employer’s case, and on a practice case,') : mailbox !== null ? 'On a real employer’s case' : 'On a practice case';
 const cap = mailbox !== null && sandbox !== null && mailbox !== sandbox ? `${words(mailbox)} and ${words(sandbox)} seats respectively` : `${words((mailbox ?? sandbox)!)} seats`;
 const reveal = config.rateLimitKeyed ? 'We hold the key, so we could work out that employer while the seat exists.' : 'Anyone with our records could work out that employer while the seat exists.';
 const seats = mailbox !== null ? communitySeats() : null;
 const community = seats === null ? '' : ` For a token of an employer added by the community, the hash is of the case and one group shared by all such tokens instead, so that together they fill at most ${words(seats)} seat${seats === 1 ? '' : 's'} on a case; the seat then shows only that the token was of that group.`;
 return ` ${where}, the seat also records ${publisherHash(config)} of the case and your token’s employer, so that no employer fills more than ${cap} on a case. ${reveal}${community}`;
}
/**
 * What each kind of risk leads to under the current policy, derived from its rules: a category whose rules have a jury
 * range goes to a jury; the others ask for repair. Personal attacks are described by their own rule.
 */
function screeningOutcomes(): string {
 const rules = policy.rules as readonly {id: string; category: string; repairAt?: number; juryRange?: readonly number[]}[];
 const juryIn = (category: string) => rules.some(r => r.category === category && r.juryRange);
 const has = (category: string) => rules.some(r => r.category === category);
 const repair = [has('privacy') && !juryIn('privacy') && 'possible identification of a person', ...(has('safety') && !juryIn('safety') ? ['threats', 'exposed private contact or location details'] : [])].filter((x): x is string => !!x);
 const jury = [juryIn('abuse') && 'a possible personal attack', juryIn('spam') && 'possible promotion', juryIn('manipulation') && 'possible coordinated manipulation'].filter((x): x is string => !!x);
 const abuse = rules.find(r => r.category === 'abuse');
 const parts = [
  repair.length ? `${list(repair)} ${repair.length > 1 ? 'ask' : 'asks'} you to repair` : '',
  abuse && !abuse.juryRange && abuse.repairAt !== undefined ? 'a clear personal attack is returned to you for repair, and anything less clear is published as criticism of conduct' : '',
  jury.length ? `${list(jury)} ${jury.length > 1 ? 'go' : 'goes'} to an anonymous jury` : '',
 ].filter(Boolean);
 return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join('; ')}; and ${parts.at(-1)}`;
}
/** ', and the tokens of one employer fill at most two seats on any case' (per-class caps from the policy), or ''. */
function seatLimits(): string {
 const mailbox = seatCap('mailbox'), sandbox = seatCap('sandbox');
 if (mailbox !== null && sandbox !== null) return mailbox === sandbox ? `, and the tokens of one employer fill at most ${words(mailbox)} seats on any case` : `, and the tokens of one employer fill at most ${words(mailbox)} seats on a real employer’s case and ${words(sandbox)} on a practice case`;
 if (mailbox !== null) return `, and the tokens of one employer fill at most ${words(mailbox)} seats on a real employer’s case`;
 if (sandbox !== null) return `, and the tokens of one employer fill at most ${words(sandbox)} seats on a practice case`;
 return '';
}
const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** 1500 → '1,500' (fixed, locale-independent). */
const n = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function privacyPolicy(config: LegalConfig): LegalDocument {
 const {jury, juryPending, samples, sandbox, practice, challenges, trustees, serverCrisis, selfHarm, community} = switches(config);
 const inactive = [!jury && !juryPending && (practice ? 'anonymous juries and appeals for real employers' : 'anonymous juries with appeals'), !challenges && 'the in-product challenge process', !trustees && `the ${trusteeRule()} trustee process for legal orders and safety issues`].filter((x): x is string => !!x);
 const pending = juryPending ? ` ${pendingJuries()}; the [moderation page](/moderation#juries) says whether one can form now.` : '';
 const {employerNameMaxChars, dnsResolver} = CODE_FACTS, powBits = config.powBits ?? configuredPowBits(undefined), powMinutes = POW_WINDOW_MINUTES;
 const {codeMinutes, codeEmailsPerWindow, emailRecordDays, recoveryDays, identicalVerifierEmails: sameEmail} = CODE_FACTS;
 const minimalRecordMonths = erasedRecordsMonths(), dailyNetworkDigests = CODE_FACTS.dailyNetworkDigests && config.rateLimitKeyed === true, challengesPerDay = challengeBudget()?.perClientPerDay ?? null;
 const {initial, appeal} = policy.jury;
 const tokens = practice ? ' or juror tokens' : '';
 const support = supportChecks(config);
 return {
  slug: 'privacy',
  title: 'Privacy policy',
  lede: `What ${BRAND} collects, where it goes, how long it stays and what you can do about it. This policy describes the running system, including its limits.`,
  sections: [
   {id: 'who-we-are', heading: 'Who we are', blocks: [
    P(`${BRAND}, at shouldiworkthere.com and verify.shouldiworkthere.com, is operated by ${OPERATOR_DESCRIPTION} (“we”, “us”). We decide how the personal data described here is used and are responsible for it.`),
    contacts(),
    P(inactive.length ? `${BRAND} is a preview. Some protections described in our [constitution](/constitution) are not active yet: ${list(inactive)}. This policy says what happens until they are.${pending}` : `${BRAND} is a preview. This policy describes the system as it runs today.${pending}`),
   ]},
   {id: 'short-version', heading: 'The short version', blocks: [UL(
    'We have no accounts and never ask for your name.',
    sameEmail
     ? `The separate verifier uses your work email address only to send a one-time code. We do not store the address; we keep keyed hashes of it until the quarter ends. Cloudflare, which delivers the email, keeps a delivery record that our account can see for up to ${emailRecordDays} days.`
     : `The separate verifier uses your work email address only to send a one-time code, or a notice that ${practice ? 'no new code was sent because a credential, or the most juror tokens allowed, was' : 'a credential was'} already issued this quarter. We do not store the address; we keep keyed hashes of it until the quarter ends. Cloudflare, which delivers the email, keeps a delivery record that our account can see for up to ${emailRecordDays} days.`,
    'Anyone can ask the verifier to email any address at a listed employer’s email domain, and anyone who can read that mailbox, including your employer, can see these emails.',
    ...(community ? ['Anyone can add an employer to the directory with its name and work-email domain. The listing shows the domain and says it was added by the community; nothing about who added it is kept with it.'] : []),
    `Before the verifier sends a code, before juror tokens are issued${community ? ' and before a new employer is listed' : ''}, your browser solves a short proof-of-work puzzle. It is computed on your device and adds nothing about you to the request.`,
    'Drafts stay in your browser. A draft is sent for automated screening only after you approve it and consent.',
    'We do not sell or share personal data, and we use no advertising, analytics, cookies, tracking pixels or session replay.',
    'You can withdraw a contribution at any time with the withdrawal capability shown once when you submit.',
    'Local checks and delayed, batched release reduce the risk that you are identified. They cannot guarantee anonymity.',
   )]},
   {id: 'architecture', heading: 'How the system is divided', blocks: [
    P(`${BRAND} runs as three separate services on Cloudflare Workers:`),
    UL(
     '**The verifier** (verify.shouldiworkthere.com) checks that you control a mailbox at an employer’s listed email domain and then blindly signs a credential that your browser prepared, using RFC 9474 blind RSA signatures. It keeps the list of employer email domains and the signing keys for each employer. It never receives testimony and cannot call the model.',
     `**The publisher** (shouldiworkthere.com) checks a credential’s signature itself and handles contributions, withdrawals, the employer directory and the public record. It has no access to the verifier’s database or signing keys.${community ? ' When someone adds an employer, the publisher registers the employer’s domain with the verifier over a private connection between the two services, authenticated with a secret they share, and copies that employer’s public keys back; a scheduled job does the same for keys the verifier creates later. When a listing is corrected, the publisher asks the verifier over the same connection to take its domain down. That connection carries directory information about employers and their public keys only, never a contribution, a question, an email address or anything about a person.' : ''} The publisher never contacts the verifier to check a credential: it checks the signature against the copy of the key it already holds, and it accepts a key created for a domain added by the community only while that employer still has a domain added by the community in the directory. A key the verifier creates for an employer added by the community becomes usable only once the publisher has copied it, when the listing is added or by a job that runs every ${CODE_FACTS.publisherJobHours} hours; until then your browser does not use that key, because it uses a key only when both services publish it identically.`,
     '**The inference service** runs Jev for search, screening and analysis. It has no public address; only the publisher is connected to it, and it is the only service that holds model credentials.',
    ),
    P('Because the signature is blind, the verifier cannot link the credential it signed to the contribution that later uses it. This is separation between services, not independent custody: all three run in the same Cloudflare account under the same operator. Whoever controls that account, including us, could change the code to collect more. We publish the [source code](/source) so changes are visible, but publishing it is not an independent audit.'),
    P(`**What the verified label means.** “Work mailbox verified” means someone controlled a mailbox at an email domain listed for that employer at the time of verification. Beside such an account, readers see the domains listed for the employer when they read it, which are not necessarily the domain the author used: we do not record which domain that was, and the list can change after publication. It does not prove legal identity, job title, current employment, or that each contribution comes from a different person. For an employer added by the community, or a domain someone added to one of our own listings, the domain was supplied by whoever added it and checked only automatically (see [When you add an employer](#adding-employers)), so the label shows control of a mailbox at that domain, not that the domain belongs to the employer named. Former-worker attestation is not supported yet.${samples ? ' Sandbox credentials work only for fictional sample employers and prove nothing about employment.' : ''}`),
   ]},
   {id: 'what-we-collect', heading: 'What we collect, part by part', blocks: [
    H3('In your browser'),
    UL(
     'Your draft, your edits and the results of the local privacy check stay in the page’s memory. Our code does not save them to browser storage, and they are gone when you close or reload the page. Your browser’s own features, such as session restore or form autofill, may still keep what you type; on a shared or employer-managed device, use a private window. Your draft leaves your device only when you choose to screen or submit it.',
     'On the draft, the repair editors and the reason for a challenge, we turn off the browser’s spell check and ask writing-assistant extensions, such as Grammarly and LanguageTool, not to run. Extensions that ignore these requests can still read the page.',
     'Employer names, published group labels, documented events and topics are recognized on your device as you type. A submitted question that is only the name of a listed employer opens that employer without being sent anywhere.',
     'The last question you submitted and the view you are on are kept in the tab’s session history, so Back and Forward work. Browsers may save session history to disk to restore tabs. Page addresses and share links carry only public identifiers, such as an employer, a view, a published group or a documented event, never your question; a group or sector that nothing publishes is dropped from a link.',
     'If you choose a light or dark theme, your browser stores that choice (local storage, “siwt-theme”); it is removed when you return to your system’s theme.',
     'If you switch Live understanding on or off, your browser stores that choice (local storage, “siwt-live”, the value on or off only) so it is remembered on this device. Nothing about what you type is stored.',
     ...(config.crisisCardEnabled ? ['A local check may show crisis support resources if what you type suggests that you or someone else may be at risk of harm. It runs only on your device; nothing about it is stored, sent or reported.'] : []),
     `Before your browser asks the verifier to email a code${practice ? ' or to issue juror tokens' : ''}${community ? ', and before it adds an employer to the directory' : ''}, it solves a proof-of-work puzzle in a background thread (a Web Worker): it searches for a number whose SHA-256 hash, together with the request, starts with about ${powBits} zero bits, which usually takes about a second. The puzzle is tied to this site, the action, the signing key it concerns (if any), a digest of what the request is about (the email address you entered, the blinded request${community ? ' or the domain' : ''}) and the current minute, and is accepted for about ${powMinutes} minutes either side, so an answer cannot be reused for a different request. It is computed only on your device, and the answer adds nothing about you to the request it goes with: the server checks only that it fits that request. It makes sending many requests costly; it does not identify anyone.`,
     'If you choose, your browser keeps the signing key for a contribution in its local database (IndexedDB), filed under a value derived from your withdrawal capability. The key cannot be exported. It stays until you withdraw from that browser or clear the site’s data.',
     'If you choose, your browser keeps a finished credential proof so you can submit later. It stays until you use it, discard it or it expires; expired proofs are deleted the next time the contribution page lists them.',
     `If you choose, while a work-mailbox verification is unfinished, your browser keeps the blinded request it sent to the verifier and the values that finish it (never your email address or the code), so a reload or a lost reply cannot lose the credential${practice ? ' or tokens' : ''}. Because it links the verifier’s request to the finished credential${practice ? ' or tokens' : ''}, it never leaves the device, and it is deleted once they are finished, when you give up, or when it has expired and the page next lists it.`,
     ...(practice ? ['If you choose, your browser keeps unused juror tokens so you can serve later. They stay until you use or discard them, or they expire; expired tokens are deleted the next time the jury page lists them.'] : []),
     'This local database exists only while it holds something you chose to keep. While it does, the contribution page says what it holds and offers to delete all of it. Anyone who can open your browser profile, including an employer that manages the device, could find these saved items. Keep them only on a personal device you control.',
     'We set no cookies. The site registers a minimal service worker that caches nothing.',
    ),
    H3('At the verifier'),
    UL(
     `**Your work email address.** Used in memory to check that it belongs to an employer’s listed email domain and to send an email through Cloudflare’s email sending service. We do not store it in our databases. Cloudflare keeps a delivery record of each message, with the recipient address, subject line, time and delivery status, which our Cloudflare account can view for up to ${emailRecordDays} days. We do not copy these records into our databases.`,
     sameEmail
      ? `**What the email reveals.** The verifier cannot tell who is asking, so anyone can ask it to email any address at a listed employer’s email domain.${community ? ' Because anyone can add an employer with its domain, that can be almost any organization’s mail domain that is not a free or disposable email provider.' : ''} Each request needs a proof-of-work answer from the requester’s browser. Every email it sends has the same sender, subject line and wording, which name ${BRAND}, and contains a new code, whether or not the mailbox already received a credential${practice ? ' or its juror tokens' : ''} this quarter. The limit of one credential per employer and quarter${practice ? `, and of ${jurorAllowance()},` : ''} is applied only when the code is used. Anyone who can read the mailbox, including an employer that monitors it, can therefore learn that a code was requested for it, and whoever uses the code learns whether the mailbox can still obtain a credential${tokens} this quarter. No more than ${words(codeEmailsPerWindow)} emails are sent to the same mailbox in any ${codeMinutes} minutes${practice ? ', counting credentials and juror tokens together' : ''}; after that, requests for it send nothing until the window has passed, whoever makes them. ${communityEmailLimit()} The verifier’s response to a request is the same either way.`
      : `**What the email reveals.** The verifier cannot tell who is asking, so anyone can ask it to email any address at a listed employer’s email domain.${community ? ' Because anyone can add an employer with its domain, that can be almost any organization’s mail domain that is not a free or disposable email provider.' : ''} Each request needs a proof-of-work answer from the requester’s browser. Every email has the same sender and subject line, which names ${BRAND}. If a credential was already issued for that mailbox and employer this quarter, the email says so instead of containing a code${practice ? `; for juror tokens, it says so once the mailbox has received the most it can (${JUROR_QUOTA} per employer per quarter)` : ''}. Anyone who can read the mailbox, including an employer that monitors it, can therefore learn that a code was requested for it and whether a credential was issued for it this quarter${practice ? ', or whether it has used up its juror tokens' : ''}. Cloudflare’s delivery record, and a mail system that sees only message headers, cannot tell a code from a notice, because the subject line is the same. No more than ${words(codeEmailsPerWindow)} emails are sent to the same mailbox in any ${codeMinutes} minutes${practice ? ', counting credentials and juror tokens together' : ''}; after that, requests for it send nothing until the window has passed, whoever makes them. ${communityEmailLimit()}`,
     `**A keyed hash of your mailbox** (lowercased, with any “+tag” removed), combined with the employer and the calendar quarter. It limits each mailbox to one credential per employer per quarter.${practice ? (jurorTokenSet() ? ` A separate keyed hash, stored with the number of tokens issued, lets each mailbox receive juror tokens once per employer and quarter, as one set of up to ${JUROR_QUOTA}.` : ` A separate keyed hash, stored with a count of tokens issued, limits juror tokens to ${JUROR_QUOTA} per mailbox, employer and quarter.`) : ''} ${practice ? 'Neither can' : 'It cannot'} be reversed without our secret key. We hold that key, so given a specific address we could check whether that mailbox obtained a credential${tokens} this quarter.`,
     `**For each code request:** the keyed mailbox hash above, a keyed hash of the mailbox alone (used only to limit the emails sent to it), a keyed hash of the code, an attempt counter, an expiry time ${codeMinutes} minutes later and, once a credential${practice ? ' or a batch of juror tokens' : ''} is signed, a hash of the blinded message${practice ? ' or batch' : ''}. The blinded message cannot be linked to your finished credential${practice ? ' or tokens' : ''}.`,
     `**Counts per employer, with no mailbox.** For real employers, the verifier counts credentials${practice ? ' and juror tokens' : ''} issued per employer and quarter, and per hour, to enforce the published caps, and records a pause when a sudden burst of requests trips the limit (see the [transparency page](/transparency)). Employers added by the community start with conservative caps: ${n(COMMUNITY_KEY_LIMITS.contribution.cap)} credentials and ${n(COMMUNITY_KEY_LIMITS.juror.cap)} juror tokens a quarter. For those employers the verifier also counts the verification emails it sends each UTC day, per employer and for all of them together, to apply the email limits described above; these counts name the employer, never a mailbox.${samples ? ' Fictional sample employers have no counts or pauses.' : ''}`,
     `**Employer domains and keys, with no mailbox.** The verifier keeps each listed employer’s email domain, including domains registered by the publisher when someone adds an employer (see [When you add an employer](#adding-employers)), with the quarter it was registered. When such a domain is registered, and again for each new quarter, the verifier creates that employer’s contribution and juror signing keys, stores the private halves encrypted, and publishes the public halves at verify.shouldiworkthere.com/keys, marked as community keys. If we take a listing’s domain down after a correction request (see the terms), the verifier deletes that domain and its keys at once and keeps a record of the listing’s page identifier, the domain and the quarter, so that neither can be registered again unless we re-admit it.`,
     '**Your IP address,** used in memory as a rate-limit key (see “On the network” below).',
    ),
    H3('At the publisher'),
    P('When you submit, the publisher’s private intake database receives:'),
    UL(
     'The approved text, the contribution type (experience, claim or opinion), the broad reporting quarter you chose, the employer and the verification type.',
     'Your optional questionnaire answers.',
     'The public half of a signing key your browser created for this contribution only, so you can sign later changes.',
     'A hash of your withdrawal capability. We never store the capability itself.',
     'Whether you allowed anonymous jurors to read these words, with detected identifiers masked, if screening holds them for a jury (yes or no; no unless you choose it).',
     ...(CODE_FACTS.specialCategoryConsent ? ['Whether you checked the statement that your account may reveal sensitive information about you and that you choose to publish it (yes or no; unchecked unless you check it).'] : []),
     'A nullifier (a hash of the credential) so the same credential cannot be used twice.',
     'A hash of the text, the calendar day of submission and, if the case is held, the day it was held and why, such as for a jury or by the privacy re-check. These time the retention limits and are erased at publication, withdrawal or expiry.',
     ...(challenges || practice || trustees ? ['If a published account is withheld for repair, its original public fields (never anything about its author), so that it can be restored under the same public identifier. They are erased with the rest of the record.'] : []),
     `For each signed change you make, a hash of part of its signature, kept ${REVISE_REPLAY_DAYS} days so the same request cannot be replayed.`,
     `A decision record for each step (submit, revise, hold, ${challenges || practice || trustees ? 'withhold, restore, ' : ''}publish, withdraw or expire${practice ? ', and jury and appeal outcomes' : ''}): the rules that applied, the quarter, the policy version and digest, and the model, provider and prompt version used for screening. It contains no text and cannot be edited or deleted.`,
    ),
    P(`**Publication.** A contribution is published only after screening, a random delay of ${CODE_FACTS.publicationDelayHours.min} to ${CODE_FACTS.publicationDelayHours.max} hours, and only in ${batchRule(config)}.${switches(config).batch < AGGREGATE_MIN ? ` A batch that small hides less than a large one: someone who knows who contributed about an employer around the same time can tell who wrote which account more easily among ${words(switches(config).batch)} accounts than among many, so leave out details that only you would know.` : ''}${legacyBatchSentence(config)} Its text is then copied to the public database under a new random identifier, with the employer, contribution type, reporting quarter, verification label and release quarter, and the intake copy of the text is erased. Beside a work-mailbox verified account, readers also see the email domains listed for the employer when they read it. The intake record keeps a link to the public identifier so a withdrawal can remove the public copy, and it keeps your answers so aggregates can be recomputed. Individual answers are never copied to the public database.${config.realPublicationEnabled ? '' : ` Publication for real employers is paused: contributions about real employers are accepted and held privately, and are erased if they are not published within ${RETENTION.approvedUnbatchedDays} days of submission.`}`),
    P(`**Aggregates.** Questionnaire results are published only as percentages and answer bands, computed by a scheduled job, for groups with at least ${AGGREGATE_MIN} published contributions, and each figure needs at least ${AGGREGATE_MIN} answers, so a group’s first batches of written accounts can be published before any of its figures are. A withdrawal removes the affected group’s published figures at once. They are published again only after at least ${RETENTION.aggregateRereleaseChanges} further publications or withdrawals, and only while at least ${AGGREGATE_MIN} contributions remain.`),
    P('**Readings of published text.** After publication, Jev reads each published account and records structured readings, such as whether it describes a layoff or how it describes workload, and compares it with other published accounts for the same employer. These readings are stored with the public record and deleted with it. Risk signals, such as whether text might identify someone, are computed only for your unpublished draft and are not stored.'),
    P(`**Search.** When you submit a question, or while Live understanding is on (it is on by default and starts off when your browser sends a Global Privacy Control signal; if you switch it on or off yourself, that choice is remembered on your device and takes precedence), what you typed is sent to the inference service to interpret it. When a submitted question is understood with confidence, it also goes to the inference service’s retrieval step${CODE_FACTS.semanticIndex ? ', where it is turned into a vector with Workers AI and matched against an index (Cloudflare Vectorize) of published, non-identifying account text; the vector is not stored' : ', which does nothing while the optional semantic index is not set up'}, and to Jev to rank up to ${CODE_FACTS.rankLimit} published accounts by relevance. Questions containing direct identifiers, such as email addresses or phone numbers, are refused before they reach Jev. We do not store your question. ${dailyNetworkDigests ? 'If you choose to share the topic, we add one to a count kept for a standard question identifier, the employer and the quarter, at most once per question, network and day; your wording is not kept. Counting once a day needs a daily network record that names the employer and the standard question; see “On the network” below.' : 'You can choose to share the topic of a question, but this deployment counts nothing, because counting once per day needs a keyed daily record it cannot make without its secret key.'}`),
    H3('At the inference service'),
    UL(
     'Search text, when you submit a question, and as you type while Live understanding is on.',
     `Your approved draft, after you consent to screening. The inference service returns risk probabilities and does not store the text; what ${MODEL_PROVIDER.name} does with it is described under “Jev and automated decisions”.${selfHarm ? ` Screening also asks one optional question about your own safety; see [Support resources](#support-resources).` : ''}`,
     `Published accounts, for relevance ranking and structured readings. An hourly job reads up to ${words(CODE_FACTS.backfillPerRun)} published accounts whose readings are missing or out of date.`,
     ...(challenges ? ['The reason given in a challenge, with detected identifying details masked, and the rule it cites, and the challenged account’s published text, as described under “When you challenge an account or serve as a juror”.'] : []),
     ...(community ? ['The name and domain of each employer someone adds, as described under [When you add an employer](#adding-employers).'] : []),
     `Daily counts of model calls, failures and fallbacks by purpose and provider, used to enforce daily budgets (${n(dailyModelCalls.search)} calls for submitted searches${community ? ' and checks of new listings' : ''}, ${n(dailyModelCalls.live)} for Live understanding, ${n(dailyModelCalls.screen)} for screening, ${n(dailyModelCalls.analysis)} for reading published accounts and ${n(dailyModelCalls.relevance)} for challenge reasons). Separate short-term failure counts, used to switch providers, are removed once they are more than a day old, the next time a failure is recorded. No text.`,
    ),
    H3('On the network'),
    P('Cloudflare receives your IP address and standard request details, such as your browser type, each time you connect, in order to deliver and protect traffic. Cloudflare keeps its own operational records under its privacy policy.'),
    P(config.rateLimitKeyed
     ? `Our code reads your IP address only in memory, to rate-limit requests. The publisher uses a daily keyed hash of it (HMAC-SHA-256 with a secret key) and the verifier an hourly keyed hash; each is handed to Cloudflare’s rate limiter for a ${CODE_FACTS.limiterWindowSeconds}-second window. ${ipv6Note} We do not write IP addresses${dailyNetworkDigests ? '' : ' or these hashes'} to our databases, and application logging is turned off for all three services. The hashes are not anonymous to us: we hold the keys, so we could test a guessed address against them.`
     : `Our code reads your IP address only in memory, to rate-limit requests. The publisher uses a daily SHA-256 hash of it and the verifier an hourly keyed hash (HMAC-SHA-256 with a secret key); each is handed to Cloudflare’s rate limiter for a ${CODE_FACTS.limiterWindowSeconds}-second window. ${ipv6Note} We do not write IP addresses${dailyNetworkDigests ? '' : ' or these hashes'} to our databases, and application logging is turned off for all three services. The hashes are not anonymous: anyone who knows the date could test a guessed address against the publisher’s hash, and we hold the verifier’s key.`),
    ...(dailyNetworkDigests ? [P(`**Daily network records.** Some limits need to remember a network for the rest of a UTC day: counting interest in a standard question at most once per question and day${challenges && challengesPerDay !== null ? `, allowing each network at most ${challengesPerDay} challenges a day` : ''}${community ? `, and allowing each network at most ${words(LISTINGS_PER_CLIENT_PER_DAY)} attempts a day to add an employer, and each wider network at most ${words(LISTINGS_PER_NETWORK_PER_DAY)}` : ''}. For these, the publisher stores a keyed hash (HMAC-SHA-256 with a secret key) of the day, the purpose and a hash of your IP address (for IPv6, of its /${CODE_FACTS.ipv6PrefixBits} prefix), never the address itself: in the public database for question interest${challenges || community ? `, and in the private intake database, with a count, for ${list([challenges && 'the challenge limit', community && 'the listing limit'].filter((x): x is string => !!x))}` : ''}. For question interest, the purpose names the employer and the standard question, and the record is made only when you choose to share the topic.${challenges ? ' For the challenge limit, the purpose is only “challenge”: it names no account, rule or employer.' : ''}${community ? ' For the listing limit, the purpose is only “employers”: it names no employer or domain, and a second record for it uses a hash of your wider network (the IPv4 /24 or IPv6 /48 that contains your address) instead of your address.' : ''} Each record is deleted once its day has ended, by a job that runs every ${CODE_FACTS.publisherJobHours} hours. These records are not anonymous to us: we hold the key, so given a guessed address we could test whether a record matches it, and for question interest, whether that network shared interest in a given standard question about a given employer that day. After a record is deleted, it can remain in the databases’ recovery history for up to ${recoveryDays} days, where a court order could require us to recover it.`)] : []),
    ...(challenges || practice ? [H3('When you challenge an account or serve as a juror'), UL(
     ...(challenges ? [
      `**Challenging an account.** A challenge sends the account’s public identifier, the rule you cite and your reason, up to ${policy.challenges.reasonMaxChars} characters. Your reason is checked for identifying details on your device and again by the publisher, which refuses it if it finds a direct identifier. The publisher then masks any other identifying details it detects and sends only the masked reason and the public text of the rule to the inference service, so that Jev can check whether the reason fits the rule. If Jev is unavailable, has failed in the last ${policy.challenges.relevance.retryAfterMinutes} minutes, or has already made ${n(policy.challenges.hostedChecksPerDay.relevance)} such checks that day, our code instead looks for the rule’s published ground terms in your reason. We do not store your reason.`,
      '**Challenge receipts.** We store a receipt for each challenge: the account, the rule, the policy version and digest, how the challenge was decided, the outcome, whether Jev or the ground terms judged the reason, any jury case it joined, and the quarter. It names no one and holds no reason. You see the receipt once, when you send the challenge; if it leads to the account being withheld, you are told only that it was withheld under the published rules. The account’s author sees each receipt on the status page, with the rule and the model that re-checked the words.',
      `**Re-checks.** If your reason fits the rule, the published account is checked again under the current policy: first by our local identifier check and then, unless that finds a direct identifier, by Jev. An account is re-checked at most once under each policy version, and at most ${policy.challenges.hostedChecksPerDay.recheck} re-checks by Jev run each day${urgentRechecks() ? `, plus ${urgentRechecks()!.perDay} reserved for challenges under the privacy and safety rules (${list([...urgentRechecks()!.rules])}), which are re-checked first` : ''}. ${challengesQueued()
       ? 'If a re-check cannot run when your challenge arrives, because the day’s re-checks are used up or Jev is unavailable, your challenge is not refused: it is queued with a receipt, and a scheduled job re-checks queued challenges as capacity returns, the privacy and safety ones first. The account stays published meanwhile. A queued challenge stores the account, the rule, the policy version and digest, how its reason was judged and the quarter, never the reason, and is deleted once it has been re-checked.'
       : 'When they are used up, the challenge is answered “try again later” and nothing changes.'} We keep the decision, the rules that applied and the model and provider used, not the risk probabilities, while that policy version is current. If the account is withheld for repair, its text is removed from the public database and copied back to the private intake database as a held case, where its author can repair or withdraw it; it is then erased like any other held case.${samples && fixturesProtected() ? ' Accounts written as demonstration data for the fictional sample employers cannot be withheld by a challenge or a jury; a challenge to one is recorded as a practice case, and its receipt says so.' : ''}`,
      `**Challenge limits.** ${challengesPerDay !== null && dailyNetworkDigests ? `Each network can send at most ${challengesPerDay} challenges a day, counted under the daily network record described under “On the network”, and a challenge whose reason does not fit the cited rule uses ${words(challengeBudget()!.notRelevantExtra)} more. A challenge refused before it is considered, because its reason contains an identifying detail or the account is not published now, uses none of that daily budget. Cloudflare’s rate limiter also limits challenges per minute, under the hash of your IP address described there.` : 'Cloudflare’s rate limiter limits challenges from each network under the hash of your IP address described under “On the network”, and a challenge that is not accepted uses more of the limit.'}`,
     ] : []),
     ...(practice ? [
      `**Juror tokens.** To serve as a juror you get anonymous juror tokens from the verifier: ${jurorTokenSet() ? `one set of up to ${JUROR_QUOTA}` : `up to ${JUROR_QUOTA}`} per work mailbox, employer and quarter. They are signed blindly, like credentials, so a token cannot be linked to the request that obtained it. The verifier still sees when tokens are requested and the publisher sees when each one is used, so someone holding both services’ records could try to match those times.${sandbox ? ' Tokens for fictional sample employers need no email address; the verifier limits them per network with an hourly keyed hash of your IP address, which it does not store.' : ''} Tokens for a real employer need the same emailed code as a credential and a proof-of-work answer, and the verifier keeps the keyed mailbox hash described under “At the verifier” until the quarter ends.`,
      `**Serving.** Using a token gives you one seat on one randomly drawn case.${ownEmployerSentence(config)}${sandbox && seatCap('sandbox') === null ? ' Practice tokens have no seat limit, so one person holding several can fill several seats on a practice case.' : ''} The publisher records that the token was spent (a hash of it, kept until the token’s key expires, so it cannot be used twice) and stores the seat under a hash of a secret that only your browser holds, with the seat’s expiry and your vote. It does not store the token, your mailbox or your IP address with the seat.${seatGroupSentence(config)} You see only the rule, the question and the passage, with detected identifiers masked. Words that are not yet published reach jurors only if their author allowed juror review. Seats and votes are deleted when the case closes, and an unused seat when it expires after ${policy.jury.assignmentHours} hours. The case keeps only the vote totals and the outcome; its passage is erased when it closes.`,
     ] : []),
    )] : []),
    H3('When you contact us'),
    P(`Messages to our contact addresses are forwarded by Cloudflare Email Routing to a mailbox we control${CONTACT_MAIL.mailboxProvider ? `, provided by ${CONTACT_MAIL.mailboxProvider}` : ''}. Cloudflare keeps a record of each forwarded message (sender, recipient, subject line, time and status) that our account can view for up to ${emailRecordDays} days. Messages include your email address and whatever you write, so emailing us is not anonymous. If you call us, we see your phone number unless you withhold it, and ${TELEPHONE_PROVIDER.name ?? 'our telephone provider'} carries the call and stores any voicemail you leave. Do not include a draft, a withdrawal capability or identifying details unless you need us to act on them. We keep correspondence, and any notes of calls, only as long as needed to deal with them and any related legal obligation.`),
   ]},
   {id: 'adding-employers', heading: 'When you add an employer', blocks: [
    P(`${community ? 'Anyone can add an employer that is not in the directory, without an account.' : 'Adding employers is closed on this deployment right now; listings added by the community before it closed are kept as described here.'} Listing an employer is separate from verifying: it lets people find the employer and request codes for its domain, and it reveals nothing about anyone who later contributes about it.`),
    UL(
     `**What you send.** The employer’s name (up to ${employerNameMaxChars} characters), a work-email domain it uses for its staff, and a proof-of-work answer computed by your browser (see “In your browser” above). No email address and no contribution.`,
     `**Checks.** The publisher refuses a name that contains identifying details about a person, such as a name, an email address, a phone number, a street address or a link, or an insult, profanity, accusation or slur; a name with invisible characters or that mixes Latin, Cyrillic and Greek letters; and a name that contains a web address other than the domain it is listed with. It refuses a domain whose words contain an insult, profanity, accusation, slur or identifying details, since the domain is shown beside the name. It checks that the domain is a valid host name, is not a free, disposable or reserved email domain on our list, and has mail (MX) records, which it looks up through Cloudflare’s public DNS resolver (${dnsResolver}); the lookup sends the domain name, not anything about you. A domain that is already listed, or whose parent domain is, cannot be listed again, and the verifier also refuses a domain that is a parent or a subdomain of one it already holds, and a listing, a domain or a subdomain of a domain that was taken down after a correction. A name that means an employer already listed with a domain, including the same name with words such as “Inc.” or “Staff” or spelled with look-alike letters, is refused, unless the domain is added to one of our listings of that name that has no domain yet, as described below; and a domain whose own name is a listed employer’s name or one of its known alternative names can be listed only under that employer’s name. The domain’s own name (the part before the public suffix, such as “acme” in mail.acme.com, without hyphens) is expected to carry the employer’s name: one of its words, the whole name run together or its initials, ignoring generic words such as “careers” or “hq”. Jev is then asked whether the name is an organization’s name, whether the name or the domain is abusive and, when the domain does not carry the name, whether it is plausibly that organization’s email domain. A name Jev judges unlikely to be an organization, a name or domain it judges likely to be abusive, and a domain that does not carry the name and that Jev judges less than ${Math.round(MATCH_AT * 100)}% likely to be the organization’s email domain are refused.`,
     `**Adding a domain to an existing listing.** If the name matches a listing we made that has no domain yet, Jev is also asked whether the domain is that employer’s corporate email domain. The domain is added to that listing only if Jev judges it at least ${Math.round(CODE_FACTS.domainPlausibility * 100)}% likely and the domain’s own name is exactly a significant word of the employer’s name or of one of our known alternative names for it, or one of those names written as one word or with hyphens between its words: schwab.com and charles-schwab.com can be added to Charles Schwab, but schwabmail.net, notschwab.net, schwab-careers.com, schwab.attacker.com or charles-schwab-corporate-email.com cannot. Otherwise the employer is listed separately, with the domain beside its name. A listing of ours that receives a domain this way keeps its name; the domain appears beside each work-mailbox verified account under it and on the employer’s page, marked as added by the community, because whoever added it, not we, supplied it.`,
     '**Registration.** The publisher then registers the domain with the verifier (see “How the system is divided”). If the verifier already holds the domain for another employer, the new listing is withdrawn at once.',
     '**What is kept.** In the public directory: the name, the domain, an identifier for the page address, a note that the listing was added by the community, and when it was added. The verifier keeps the domain with the employer and the quarter it was registered, and creates the employer’s signing keys (see “At the verifier” above). If the domain is later taken down after a correction, the verifier keeps a record of the listing’s page identifier, the domain and the quarter so that they cannot be registered again, and the public log of listing corrections records the correction (see the terms). Nothing about who added the listing is kept with it, and the log names no one who asked for a correction.',
     `**Limits.** Each network can make at most ${words(LISTINGS_PER_CLIENT_PER_DAY)} attempts a day that pass the name and domain rules, and each wider network (an IPv4 /24 or IPv6 /48) at most ${words(LISTINGS_PER_NETWORK_PER_DAY)}, counted under daily network records whose purpose is only “employers” (see “On the network”), and at most ${n(COMMUNITY_LISTINGS_PER_DAY)} employers are added a day in total. Without the secret key for these records, no employer can be added.`,
    ),
    P(`A listing shows the domain beside the name, for example “Acme (acme.com)”, and says it was added by the community. The name and domain come from whoever added it, not from us or the employer. See [Employers added by the community](/terms#community-listings) in the terms for what a listing does and does not mean, and how to have a wrong one corrected.`),
   ]},
   {id: 'retention', heading: 'How long we keep it', blocks: [
    TABLE('Retention by data type', ['What', 'Where', 'How long'], [
     ['Draft, edits and local check results', 'Your browser, in memory', 'Until you close or reload the page (your browser’s own session restore or autofill may keep it longer)'],
     ['Signing key (optional)', 'Your browser (IndexedDB)', 'Until you withdraw from that browser or clear the site’s data'],
     ['Finished credential proof (optional)', 'Your browser (IndexedDB)', 'Until you use or discard it, or it expires'],
     ['Unfinished work-mailbox verification (optional): blinded request and finishing values', 'Your browser (IndexedDB)', 'Until finished or discarded, or once expired, when the page next lists it'],
     ...(practice ? [['Unused juror tokens (optional)', 'Your browser (IndexedDB)', 'Until you use or discard them, or they expire']] : []),
     ['Theme choice (optional)', 'Your browser (local storage)', 'Until you return to your system’s theme or clear the site’s data'],
     ['Your last submitted question and the view path', 'Your browser (the tab’s session history)', 'Until the tab’s history is gone; browsers may save it to restore tabs'],
     ['Work email address', 'Verifier memory; Cloudflare email delivery records', `Not stored in our databases. Cloudflare’s delivery record (recipient, subject line, time and status): up to ${emailRecordDays} days`],
     ['Code request records: keyed mailbox hashes, code hash, attempts, blinded-message hash', 'Verifier database', `The code is valid for ${codeMinutes} minutes; the record is deleted by a job that runs every ${CODE_FACTS.verifierJobMinutes} minutes after that`],
     ['One-credential-per-quarter record: keyed mailbox hash and blinded-message hash', 'Verifier database', 'Until the end of the calendar quarter in which the credential was issued, then deleted by the same job'],
     ...(practice ? [['Juror token count for a mailbox: keyed mailbox hash and number of tokens', 'Verifier database', 'Until the end of the calendar quarter, then deleted by the same job']] : []),
     [`Issuance counts per employer${practice ? ', purpose' : ''} and quarter (no mailbox; real employers only)`, 'Verifier database', 'Until the end of the calendar quarter, then deleted by the same job'],
     [`Hourly issuance counts per employer${practice ? ' and purpose' : ''} (no mailbox; real employers only)`, 'Verifier database', 'About 48 hours, then deleted by the same job'],
     [`Issuance pauses per employer${practice ? ' and purpose' : ''} (real employers only)`, 'Verifier database', 'Until the pause ends, then deleted by the same job'],
     [`Held contribution${challenges ? ', including a published account withheld for repair' : ''}: text, answers, public signing key, hashes, dates and kind of hold`, 'Publisher intake database', `Erased about ${RETENTION.heldDays} days after it was held, unless repaired or withdrawn sooner${practice ? '. While a jury case about it is open, erasure waits for the case to close; if the jury reaches no decision, it is erased within about a day' : ''}`],
     ['Accepted contribution waiting for a batch: the same data', 'Publisher intake database', `Erased about ${RETENTION.approvedUnbatchedDays} days after submission if not published`],
     ['Published text', 'Public database', 'Until you withdraw it'],
     ['Answers and public signing key of a published contribution', 'Publisher intake database', 'Until you withdraw it'],
     ['Readings and comparisons of published text', 'Public database', 'Deleted with the published text'],
     ['Aggregate figures', 'Public database', 'Replaced when recomputed; removed at once when a withdrawal affects them'],
     ['Credential nullifier', 'Publisher intake database', 'Until the credential’s signing key expires'],
     ['Replay guard for each signed change: a hash of part of the signature', 'Publisher intake database', `${REVISE_REPLAY_DAYS} days`],
     minimalRecordMonths !== null
      ? ['Minimal record after withdrawal or expiry: status, employer, reporting and submission quarters, contribution and verification type, revision count and capability hash', 'Publisher intake database', `${upperFirst(words(minimalRecordMonths))} months after the start of the month in which it was withdrawn or expired, the scheduled job replaces the capability hash with a random value and removes the employer and the quarters; only the status, the contribution and verification type and the revision count remain, with no fixed limit. It holds no text or answers; it lets a repeated withdrawal work and keeps public counts accurate. See “Withdraw” under your rights for what it can reveal`]
      : ['Minimal record after withdrawal or expiry: status, employer, reporting and submission quarters, contribution and verification type, revision count and capability hash', 'Publisher intake database', 'No fixed limit. It holds no text or answers; it lets a repeated withdrawal work and keeps public counts accurate. See “Withdraw” under your rights for what it can reveal'],
     ['Decision records (no text)', 'Publisher intake database', 'No fixed limit; append-only'],
     ...(challenges ? [
      ['Challenge receipts (no reasons, no text)', 'Publisher intake database', `Deleted by the scheduled job once they are more than ${MODERATION_RECORDS} old`],
      ...(challengesQueued() ? [['Queued challenges: the account, the rule, the policy version and digest, how the reason was judged and the quarter (no reasons, no text)', 'Publisher intake database', `Until re-checked, when the result is kept as a challenge receipt; deleted by the scheduled job once more than ${MODERATION_RECORDS} old`]] : []),
      ['Re-check decisions: the decision, the rules and the model (no text)', 'Publisher intake database', 'While the policy version they were made under is current'],
     ] : []),
     ...(practice ? [
      ['Jury cases: rule, masked passage, vote totals and outcome', 'Publisher intake database', `The passage is erased when the case closes; the rest is deleted by the scheduled job once it is more than ${MODERATION_RECORDS} old, except a decision about published words, which is kept while its policy version is current so that it stays final`],
      ['Jury seats and votes', 'Publisher intake database', `Deleted when the case closes; an unused seat when it expires after ${policy.jury.assignmentHours} hours`],
      ['Spent juror token record (a hash of the token)', 'Publisher intake database', 'Until the token’s key expires'],
     ] : []),
     ...(trustees ? [
      ['Trustee exception records (the account, the kind and the expiry)', 'Publisher intake database', `Until the exception lapses, then deleted by the scheduled job once it is more than ${MODERATION_RECORDS} old`],
      ['Public exception log: kind, scope, a digest of the account, expiry day and signing trustees', 'Public database', 'Kept as a permanent public record'],
     ] : []),
     ['Shared-topic counts (opt-in)', 'Public database', 'No fixed limit; counts only'],
     ['Employer listings added by the community: name, domain, page identifier, the community label and when it was added (nothing about who added it)', 'Public database; the domain and the employer’s signing keys also in the verifier database', 'Kept as part of the public directory; a listing is changed only if it is corrected, as described in the terms'],
     [`Daily counts of verification emails sent for employers added by the community, per employer and in total (no mailbox or address)`, 'Verifier database', `Kept for the current and the previous UTC day, then deleted by the job that runs every ${CODE_FACTS.verifierJobMinutes} minutes`],
     ['Record of a listing whose domain was taken down after a correction: its page identifier, the domain and the quarter (nothing about any person)', 'Verifier database', 'No fixed limit, so that the listing and the domain cannot be registered again; deleted only if we re-admit them'],
     ['Public log of listing corrections: the kind of correction, the reason, the quarter and a digest of the listing’s page identifier (no name, requester or text)', 'Public database', 'Kept as a permanent public record; entries cannot be changed or deleted'],
     ['Proof-of-work answers', 'Checked in memory by the verifier or the publisher', 'Not stored'],
     ['Model-call counts (no text)', 'Public database', 'Daily totals: no fixed limit. Short-term failure counts for switching providers: removed once more than a day old, when the next failure is recorded'],
     ['IP address hashes for rate limits', 'Cloudflare rate limiter', `${CODE_FACTS.limiterWindowSeconds}-second windows; never written to our databases`],
     ...(dailyNetworkDigests ? [[`Daily network records: a keyed hash of the day, the purpose (for question interest, the employer and the standard question) and a hash of your IP address (for IPv6, of its /${CODE_FACTS.ipv6PrefixBits} prefix)${community ? ', or, for the second listing record, of your wider network (IPv4 /24 or IPv6 /48)' : ''}`, `Public database (question interest)${challenges || community ? `; publisher intake database, with a count (${list([challenges && 'challenges', community && 'employer listings'].filter((x): x is string => !!x))})` : ''}`, `Deleted once the UTC day has ended, by a job that runs every ${CODE_FACTS.publisherJobHours} hours; then up to ${recoveryDays} days in the recovery history`]] : []),
     ['Transparency archives: rounded counts, ledgers and digests', 'Cloudflare R2', 'Kept as a permanent public record'],
     ['Recovery history of all three databases', 'Cloudflare D1 point-in-time recovery', `Up to ${recoveryDays} days after any change, including erasure`],
     ['Email you send us, and notes of calls', `Our mailbox; Cloudflare routing records`, `As long as needed to deal with it; Cloudflare’s routing record: up to ${emailRecordDays} days`],
     ['Call records (your phone number, time and length) and any voicemail, when you call us', TELEPHONE_PROVIDER.name ?? 'Our telephone provider', `Under the provider’s own retention terms${TELEPHONE_PROVIDER.name ? '' : ', which we have not yet confirmed'}`],
    ]),
    P(`Retention limits are applied by scheduled jobs that run every ${CODE_FACTS.publisherJobHours} hours at the publisher and every ${CODE_FACTS.verifierJobMinutes} minutes at the verifier. Limits counted in days are checked against calendar dates, so erasure happens within about a day of the limit. Withdrawal takes effect immediately, including over a publication batch that is in progress.`),
    P(`Cloudflare D1, which holds our three databases, keeps a point-in-time recovery history. Data we erase, or that you withdraw, can remain recoverable from that history for up to ${recoveryDays} days. We would restore a database only to recover from data loss or corruption, or where the law requires it. During those ${recoveryDays} days, a court order could require us to recover erased data from this history, including withdrawn text and answers.`),
   ]},
   {id: 'purposes', heading: 'Why we use data, and our legal bases', blocks: [
    P('Some laws, such as the EU and UK GDPR, require a legal basis for each use of personal data. Ours are:'),
    TABLE('Purposes and legal bases', ['Purpose', 'Data', 'Legal basis'], [
     ['Verify control of a work mailbox and allow one credential per mailbox, employer and quarter', 'Email address in memory, keyed mailbox hash, code request records', 'Taking the steps you ask for, and our legitimate interest in preventing duplicate credentials'],
     ['Screen an approved draft with Jev', 'Approved draft', 'Your consent, given with the screening checkbox. Without it, nothing is sent'],
     ['Publish your contribution and compute aggregates', 'Approved text, optional answers, reporting quarter, employer', `Your consent when you submit${CODE_FACTS.specialCategoryConsent ? ', and your explicit consent if you check the statement about sensitive information about you' : ''}. You can withdraw at any time`],
     ...(practice ? [['Let anonymous jurors read held words', 'Held words, with detected identifiers masked', 'Your consent, given with the juror-review checkbox (off unless you choose it). Without it, no juror sees unpublished words'] as string[]] : []),
     ['Record structured readings of published text and compare accounts', 'Published text', 'Our legitimate interest in making the public record searchable and comparable. The text is already public at that point'],
     ['Publish what contributors say about other people', 'Whatever an account says about managers, coworkers or others, within the content rules', 'Our legitimate interest, and the public’s, in freedom of expression and in information about workplaces, limited by content rules that protect private individuals'],
     ['Interpret and rank searches', 'Search text', 'Your request when you submit a question, or when you type while Live understanding is on (it is on by default, starts off under Global Privacy Control, and you can switch it off)'],
     ['Count interest in standard questions', `Question identifier, employer, quarter${dailyNetworkDigests ? ', and the day’s network record for that question and employer' : ''}`, 'Your consent (off by default)'],
     ['Keep records after withdrawal or expiry, and decision records', 'Minimal records and decision records described above; no text', 'Our legitimate interests in accountability for automated decisions, accurate public counts and making a repeated withdrawal work'],
     ...(challenges ? [['Handle challenges to published accounts and re-check them', 'The challenged account, the cited rule and your reason (sent to Jev, not stored), challenge receipts, re-check decisions, and the rate-limit hash of your IP address', 'Our legitimate interests in applying the published rules fairly and in preventing abuse of challenges'] as string[]] : []),
     ...(practice ? [['Issue juror tokens and run juries', `Your email address in memory and a keyed mailbox hash (real-employer tokens)${sandbox ? ', a keyed hash of your IP address (practice tokens)' : ''}, spent-token hashes, seats and votes`, 'Taking the steps you ask for when you request tokens or serve, and our legitimate interest in limiting each token to one seat and each mailbox to a set number of tokens'] as string[]] : []),
     ...(support.length ? [['Offer support resources when text you send suggests someone may be at risk of harm', 'The text you send, in memory only; nothing is stored', `Our legitimate interest, and yours, in making help easy to find${SERVES_EU_UK ? '. For sensitive information, see [If you are in the EU, EEA or UK](#eu-uk)' : ''}`] as string[]] : []),
     ...(community ? [['Let anyone add an employer to the directory and set up its verification', 'The name and domain you enter, which describe an organization rather than you, and the checks of them described under [When you add an employer](#adding-employers)', 'Our legitimate interest, and the public’s, in a directory that anyone can extend without an account']] : []),
     ['Keep the service secure and available', `IP address in memory, rate-limit hashes${dailyNetworkDigests ? ', daily network records' : ''}, proof-of-work answers (checked, not stored), model-call counts`, 'Our legitimate interests in security and availability'],
     ['Reply when you email or call us', 'Your email address or phone number, and what you tell us', 'Our legitimate interest in answering you, and legal obligation where the request concerns your legal rights'],
     ['Respond to legal requests and meet legal obligations', 'Only what a valid request covers', 'Legal obligation'],
     ['Publish transparency archives', 'Rounded counts, ledgers and digests', 'Our legitimate interest in public accountability'],
    ]),
    P(`If your account includes sensitive information about yourself, such as your health or union membership, it is screened and published because you chose to include it and submit it.${CODE_FACTS.specialCategoryConsent ? ' The contribution form has a separate statement for this, unchecked unless you check it, that your account may reveal sensitive information about you and that you choose to publish it.' : ''} Do not include sensitive information about other people.${SERVES_EU_UK ? ' For what this means under the GDPR and UK GDPR, see “Sensitive information” under [If you are in the EU, EEA or UK](#eu-uk).' : ''}`),
   ]},
   {id: 'jev', heading: 'Jev and automated decisions', blocks: [
    P(`Jev is a classification model made by ${MODEL_PROVIDER.name}. It answers narrow questions with probabilities: yes or no, a choice between set options, or a score. It does not write answers, summaries or opinions for this site. Every number you see is computed by our code from released data.`),
    P(`**How we reach Jev.** Normally the inference service calls Jev through Cloudflare Workers AI and AI Gateway, using our ${MODEL_PROVIDER.name} key stored in AI Gateway. Every request turns gateway logging off and skips the gateway cache. If that path fails, or has failed at least ${words(BREAKER.failures)} times in the last ${BREAKER_MINUTES} to ${BREAKER_MINUTES * 2} minutes, the inference service calls ${MODEL_PROVIDER.name}’s own API directly. Each result records which path served it. On either path, ${MODEL_PROVIDER.name} processes the input on its systems to produce the answers.`),
    P(MODEL_PROVIDER.handling
     ? `**What ${MODEL_PROVIDER.name} keeps.** ${MODEL_PROVIDER.handling}`
     : `**What ${MODEL_PROVIDER.name} keeps.** We have not yet confirmed ${MODEL_PROVIDER.name}’s legal entity, where it processes data, how long it keeps the inputs it receives, whether it uses them to train or improve its models, or the terms of a data processing agreement with it. Until we have confirmed these and stated them here, assume that ${MODEL_PROVIDER.name} may keep what it receives. This is one reason drafts are sent only after you approve them and consent, and questions containing direct identifiers are refused before they reach Jev.`),
    P('**What Jev receives:**'),
    UL(
     'Your question, with the public employer names and sectors, documented events, group labels and questionnaire topics it may choose from.',
     `Your question and up to ${CODE_FACTS.rankLimit} published accounts, to rank them by relevance.`,
     `Your approved draft, after you consent, to check ${words(policy.rules.length)} policy conditions: identifying a private person, identifying the author from context, threats, exposing private contact or location details, personal attacks, promotion, and coordinated manipulation.${selfHarm ? ' It is also asked the one optional question described under [Support resources](#support-resources).' : ''}`,
     'Published accounts, for structured readings and comparisons.',
     ...(community ? ['The name and domain of each employer someone adds, to ask whether the name is an organization’s, whether the name or the domain is abusive and, when the name matches one of our listings that has no domain or the domain does not carry the name, whether the domain is that employer’s corporate email domain.'] : []),
     ...(challenges ? [
      'The reason given in a challenge, after the identifier checks and with any other detected identifying details masked, with the public text of the rule it cites, to check whether the reason fits the rule.',
      'The published text of a challenged account, to re-check it under the current policy, unless our local identifier check has already found a direct identifier in it.',
     ] : []),
    ),
    P(`**What Jev never receives:** your email address, verification data, credentials, ${practice ? 'juror tokens or votes, ' : ''}withdrawal capability, IP address, or any draft you have not approved.`),
    P(`**Automated screening.** Our published, versioned [moderation policy](/moderation/current.json) turns Jev’s probabilities into one of three outcomes: clear, which makes a contribution eligible for release; repair, which asks you to change the words and stores nothing; or jury, which holds the case privately. Under the current policy, ${screeningOutcomes()}. If screening is unavailable, the outcome is repair and nothing is stored. When a batch is published, our local identifier check runs again on each contribution and can hold one privately for repair; it is then treated like any other held case.${challenges ? ' When a challenge’s reason fits the rule it cites, the published account is checked again, by the local identifier check and then by Jev under the current policy; if it contains a direct identifier or meets a repair threshold, it is withheld from publication and held privately for its author to repair. If it falls in the cited rule’s jury range, a jury decides where one can be formed, and the account stays published meanwhile.' : ''} Criticism and negative opinions are not violations. Each decision records the policy version and digest, the rules that applied and the model used.`),
    P(jury
     ? `**Human review.** A case held for a jury is decided by ${initial} randomly selected anonymous jurors, each answering one question about one rule, if you allowed anonymous jurors to read your words when you submitted or revised them and ${enoughJurors(juryScope(config), 'on that case')}; otherwise it stays held privately and is erased about ${RETENTION.heldDays} days after it was held unless you repair or withdraw it. You can appeal a decision against you once, when ${enoughJurors(juryScope(config), 'on an appeal')}, and a new jury of ${appeal} decides without seeing the first result; the appeal is final for those words. The [status page](/status) says whether an appeal is available. You can also repair or withdraw the case at any time.${communityJurors()} By design, no one at the operator can approve, edit or release an individual contribution through the application.`
     : `**Human review.** ${juryPending ? `${pendingJuries()}.` : `${sandbox ? 'For real employers, anonymous' : 'Anonymous'} juries of ${initial} randomly selected people, with appeals to ${appeal} different people, are planned but not active.`} Until ${juryPending ? 'one can' : 'they are'}, a case ${sandbox || juryPending ? 'about a real employer ' : ''}held for a jury, or by the privacy re-check, is not published as written and is erased about ${RETENTION.heldDays} days after it was held, unless you repair it with new words, which are screened again, or withdraw it.${juryPending ? communityJurors() : ''}${sandbox ? ` A case about a fictional sample employer can be decided by a practice jury of ${initial}, with one appeal to ${appeal} others, under the same rules, but only if its author allowed anonymous jurors to read the words and ${enoughJurors('practice', 'on that jury or appeal')}; the [moderation page](/moderation#juries) says whether one can form now.` : ''} By design, no one at the operator can approve, edit or release an individual contribution through the application, so there is no staff review of individual cases.`),
    P(`**Your rights about automated decisions.** Where the GDPR applies, Article 22 gives you rights about decisions based solely on automated processing that have legal or similarly significant effects on you. Our screening decides only whether a text is published in its current wording; it decides nothing about you as a person, and we do not know who you are. You can always change the words or withdraw. If you think a rule was applied wrongly, write to ${mail(CONTACT.privacy)} with the rule and the wording, but not your capability. We will check whether the published rule was applied as written. If our code or policy is wrong, we will fix it for everyone, publish the change and tell you. We cannot approve or release an individual case.`),
   ]},
   ...(config.crisisCardEnabled || serverCrisis || selfHarm ? [{id: 'support-resources', heading: 'Support resources', blocks: [
    P('Workplace accounts sometimes describe crisis. These checks only offer help to the person writing: they never block, edit, report or score the text, and they are not moderation signals.'),
    UL(
     ...(config.crisisCardEnabled ? ['**On your device.** The search box and the contribution editor run a fixed list of crisis phrases as you type. If what you type suggests that you or someone else may be at risk of harm, a card offers crisis lines (988 in the United States, findahelpline.com elsewhere) and emergency numbers. Nothing about it is stored, sent or reported.'] : []),
     ...(serverCrisis ? ['**On our server.** When you send a search, a draft for screening, a contribution or a revision, the publisher runs the same phrase list on that text in memory. If it matches, the reply to you includes the same resources. Nothing about the match is stored, logged or forwarded, and it does not affect screening, publication or search results.'] : []),
     ...(selfHarm ? [`**During screening.** When you screen a draft, Jev is asked one more question: whether you describe your own thoughts of suicide or of harming yourself. ${serverCrisis ? 'If Jev answers yes, the reply to you includes the same resources.' : 'Its answer is discarded, because support resources from our server are switched off.'} The answer is never stored, logged or used for moderation, and it never changes the outcome; if Jev gives no answer, screening continues as usual.`] : []),
    ),
    ...(SERVES_EU_UK && support.length ? [P('For what this means under the GDPR and UK GDPR, see “Sensitive information” under [If you are in the EU, EEA or UK](#eu-uk).')] : []),
   ]} as LegalSection] : []),
   {id: 'providers', heading: 'Service providers', blocks: [
    P('These providers process personal data for us:'),
    TABLE('Service providers', ['Provider', 'What they do for us', 'Data they process'], [
     ['Cloudflare, Inc. (United States)', `Hosting and network delivery (Workers), databases (D1), archive storage (R2), background queues (Queues), rate limiting, verification email delivery (Email Sending), forwarding of mail to our contact addresses (Email Routing), ${community ? 'a public DNS resolver that looks up the mail records of domains added to the directory, ' : ''}and model routing (Workers AI and AI Gateway)${CODE_FACTS.semanticIndex ? ', and a search index of published text (Vectorize)' : ''}`, 'Everything described in this policy that passes through or is stored by our services, including IP addresses, request details and email delivery records'],
     [MODEL_PROVIDER.legalName ? `${MODEL_PROVIDER.legalName}${MODEL_PROVIDER.location ? ` (${MODEL_PROVIDER.location})` : ''}` : `${MODEL_PROVIDER.name} (legal entity and location not yet confirmed)`, 'Runs the Jev model', `Search text, approved drafts after consent, ${challenges ? 'the reasons given in challenges, ' : ''}published accounts${community ? ', and the names and domains of employers added to the directory' : ''}`],
     ...(CONTACT_MAIL.mailboxProvider ? [[CONTACT_MAIL.mailboxProvider, 'Stores mail sent to our contact addresses', 'Your email address and what you write to us']] : []),
     [telephoneProvider(), `Carries calls to ${OPERATOR_PHONE} and stores any voicemail`, 'Your phone number, the time and length of the call, and any voicemail you leave'],
    ]),
    P(`${CONTACT_MAIL.mailboxProvider ? '' : 'Mail forwarded from our contact addresses is stored in a mailbox we control; we will name its provider here. '}${TELEPHONE_PROVIDER.name ? '' : 'We will name our telephone provider here once it is confirmed. '}We will update this list before a new provider receives personal data.`),
   ]},
   {id: 'what-we-do-not-do', heading: 'What we do not do', blocks: [
    UL(
     'We do not sell personal data or share it for targeted advertising, and we do not sell aggregated review data.',
     'We use no advertising, analytics, tracking pixels, session replay or third-party scripts. Every script on the site is served from our own domain.',
     'We set no cookies. Cloudflare may set a strictly necessary security cookie if it needs to check suspicious traffic.',
     'We take no payments. There are no subscriptions or trials, and donations are not enabled.',
     'Employers get no access beyond the public record, and no one can pay to influence it.',
    ),
    P('**Global Privacy Control.** We do not sell or share personal data or use it for targeted advertising, so there is no sale or sharing for the signal to opt you out of. We still act on it: when your browser sends it, Live understanding starts off, so what you type is sent only when you submit a question (see “Search” above). If you switch Live understanding on or off yourself, that choice is remembered on your device and takes precedence. The page reads the signal only in your browser.'),
   ]},
   {id: 'your-rights', heading: 'Your choices and rights', blocks: [
    P('Depending on where you live, you may have rights to access, correct, delete or export personal data, to object to or restrict its use, to withdraw consent, and to appeal if we refuse a request. Because we do not know who you are, the design limits what we can do, and some rights work through the product instead:'),
    UL(
     `**Withdraw.** Enter your withdrawal capability on the [status page](/status) at any time. This erases the private text, answers and signing key, removes the public text and the readings derived from it, and withdraws affected aggregate figures. No signature is needed, so keep the capability private. A minimal record that the contribution existed and was withdrawn stays. It holds no text or answers, but ${minimalRecordMonths !== null ? `for about ${words(minimalRecordMonths)} months it records the employer and quarters and is linked to a hash of your capability; after that, only its status, contribution and verification type and revision count remain, and your capability no longer finds it` : 'it records the employer and quarters and is linked to a hash of your capability, with no fixed time limit'}. Anyone who obtains both your capability and our records${minimalRecordMonths !== null ? ' within that time' : ''}, for example through a court order, could use it to show that the capability was used for a contribution about that employer.`,
     '**Check or correct.** With the capability, the [status page](/status) shows a contribution’s status and a receipt for each moderation decision about it. While it is held or waiting, you can replace the text with a revised version signed by the key from your browser; the new text is screened again. A published contribution cannot be edited: withdraw it and submit again.',
     '**Access and export.** We can find what we hold about a contribution only through its capability. We have no account, name or stored email address to search.',
     `**Verifier records.** The verifier holds only keyed hashes, until the quarter ends. To learn whether a credential was issued for a mailbox this quarter, ${sameEmail ? 'request a code for it and use it on the contribution page: if one was, the verifier refuses to issue another and the page says so' : 'request a code for it: if one was, the email to that mailbox says so'}. If you ask us instead, we will answer only by email to that address, and only after you reply from it to a message we send there. We never tell anyone else. Deleting a record early would let the mailbox obtain another credential in the same quarter, so we keep it until the quarter ends unless the law requires otherwise.`,
     '**Copies made by others.** Withdrawal cannot recall copies of published text that other people made.',
    ),
    P(`To make a request, or to appeal our answer to one, email ${mail(CONTACT.privacy)}. Emailing a capability links your email address to that contribution in our mailbox, so use the site instead whenever you can. You may also complain to your data protection authority or, in the United States, to your state attorney general.${SERVES_EU_UK ? ' If you are in the EU, the EEA or the UK, see also [If you are in the EU, EEA or UK](#eu-uk).' : ''}`),
   ]},
   {id: 'described', heading: 'If you are described in a contribution', blocks: [
    P('Accounts describe workplaces, so they can mention managers, coworkers and other people who did not write them. Our content rules forbid identifying private individuals, directly or from context, exposing private contact or location details, and personal attacks. Automated screening checks every draft for these before it can be published, but it can miss things.'),
    P(`If you believe a published contribution identifies you or contains personal data about you, including sensitive information such as your health, email ${mail(CONTACT.privacy)} with a link to the contribution, what in it concerns you, and the rule or right you rely on. Where the GDPR applies, you can object to the processing; we will weigh your interests against the author’s freedom of expression and the public interest. We cannot tell you who wrote a contribution, because we do not know.`),
    P(`**What a person decides.** We handle these reports as legal notices: a person reviews each one against the law, not against our content rules. Where the law requires removal, for example under a valid court order, or because the law obliges us to grant your objection or erasure request, we remove the contribution${trustees ? ` through the ${trusteeRule()} trustee process` : ' through direct administrative access, limited to that contribution'}, and record the removal in the [legal requests ledger](/legal-requests) when the law allows.`),
    P(challenges
     ? '**What the rules decide.** No one at the operator removes a contribution because they judge that it breaks a content rule. A report that it breaks a rule in our moderation policy, such as the rule against identifying a private person, is decided by the published challenge process: it checks whether the reason fits the rule, re-checks the published words under the current policy and can withhold them for their author to repair. Every challenge produces a receipt, which the challenger sees when it is sent and the author sees on the status page. You can challenge the contribution yourself from the account or, if you prefer, ask us and we will file the challenge for you through the same public process, with no priority, and send you its receipt; see [Challenging a contribution](/terms#challenges).'
     : '**What the rules decide.** No one at the operator removes a contribution because they judge that it breaks a content rule. The in-product challenge process that decides such reports under the published rules is not open yet; until it is, a report that a contribution breaks a content rule, and not the law, is recorded and decided under the published rules when the process opens. See [Challenging a contribution](/terms#challenges).'),
   ]},
   {id: 'legal-requests', heading: 'Legal requests and disclosure', blocks: [
    P('Apart from the service providers above, we disclose personal data only when the law requires it, such as under a valid court order. We record requests in the public [legal requests ledger](/legal-requests) when the law allows. Consistent with our [constitution](/constitution), we protect anonymous speech to the maximum extent permitted by law.'),
    P(`We can disclose only what we hold, including, for up to ${recoveryDays} days after erasure, what remains in our databases’ recovery history, which a court order could require us to recover. We hold no names, accounts or stored email addresses, and no stored link between the verifier’s records and any contribution. Given a specific email address, the verifier’s records can show whether that mailbox obtained a credential for an employer in the current quarter, and for up to ${emailRecordDays} days Cloudflare’s delivery records can show when ${sameEmail ? 'codes were' : 'codes or notices were'} sent to it. None of these show whether that person wrote anything, or what. Given a withdrawal capability, our records can show the employer and quarters of the contribution it controlled, even after withdrawal${minimalRecordMonths !== null ? ` or expiry, for about ${words(minimalRecordMonths)} months` : ''}.`),
    P(`An employer does not need us to learn whether one of its mailboxes asked for verification. As described under “At the verifier”, anyone can request a code for a work address, and anyone who can read that mailbox can see the ${sameEmail ? 'codes' : 'codes and notices'} sent to it.`),
    P(trustees
     ? `Valid legal orders and credible imminent-safety issues are handled through the ${trusteeRule()} trustee process: at least ${words(policy.exceptions.requiredSignatures)} of ${words(policy.exceptions.trustees)} independent trustees must sign a limited, time-bound action, and each action gets a transparency entry.`
     : `A ${trusteeRule()} trustee process for valid legal orders and credible imminent-safety issues is planned but not active. Until it is, we act on valid legal orders through direct administrative access to our infrastructure, limit the action to what the order requires, and record it in the ledger when the law allows.`),
   ]},
   {id: 'children', heading: 'Children', blocks: [
    P(`You must be ${MINIMUM_AGE} or older to use ${BRAND}. It is not directed to children, and we do not knowingly collect personal data from anyone under ${MINIMUM_AGE}. We cannot check contributors’ ages because we do not know who they are. If you believe someone under ${MINIMUM_AGE} has contributed, email ${mail(CONTACT.privacy)} with a link to the published text. We will review it as a legal notice and remove the contribution where the law requires.`),
   ]},
   {id: 'where', heading: 'Where data is processed', blocks: [
    P(`We are based in the United States. Cloudflare handles each request in a data center near you; our three databases are stored in its ${CODE_FACTS.databaseRegion} region, and our archives in its storage. ${MODEL_PROVIDER.name} processes model inputs on its systems${MODEL_PROVIDER.location ? ` in ${MODEL_PROVIDER.location}` : ', in locations we have not yet confirmed'}. If you use ${BRAND} from outside the United States, your data is processed in the United States and possibly other countries, whose data protection laws may differ from yours.${SERVES_EU_UK ? ' The safeguards for data from the EU, the EEA and the UK are described in the next section.' : ''}`),
   ]},
   ...(SERVES_EU_UK ? [euUkPrivacy(config)] : []),
   {id: 'security', heading: 'Security', blocks: [
    UL(
     'Encrypted connections (HTTPS with HSTS) and a strict content security policy that allows scripts only from our own domain.',
     'Separate services and databases for verification, publication and inference, each holding only its own credentials.',
     'Credential signing keys encrypted at rest with AES-256-GCM in the verifier’s database; the operator also keeps an unencrypted copy of them in a file on the computer that creates them. Mailbox and code records hashed with a secret key.',
     'Application logging turned off; append-only decision, finance and legal ledgers; published source code.',
     'A signed release manifest and hash-chained transparency archives that anyone can check with our open verification tool; see the [transparency page](/transparency).',
    ),
    P('No system is perfectly secure, and these measures have not been independently audited.'),
   ]},
   {id: 'incidents', heading: 'If something goes wrong', blocks: [
    P('If we learn of a security incident that affects personal data, we will contain and investigate it and notify affected people and authorities as the law requires. Because we have no contact details for most people, we will also post a notice on this site and on the [transparency page](/transparency).'),
   ]},
   {id: 'changes', heading: 'Changes to this policy', blocks: [
    P('Each version has a number and an effective date. We will post material changes on this page at least 30 days before they take effect, unless a change is required by law or urgently needed for security. A change that allows new uses of data we already hold will apply only to data collected after it takes effect.'),
    changelog(),
   ]},
   {id: 'contact', heading: 'Contact', blocks: [P(`${OPERATOR_DESCRIPTION}.`), contacts()]},
  ],
 };
}

/** Privacy policy section for people in the EU, the EEA and the UK (GDPR and UK GDPR). Rendered while SERVES_EU_UK. */
function euUkPrivacy(config: LegalConfig): LegalSection {
 const {jury, juryPending, sandbox, practice, challenges} = switches(config), {dpia} = COMPLIANCE_ASSESSMENTS, {initial, appeal} = policy.jury, support = supportChecks(config);
 const phone = TELEPHONE_PROVIDER.name ?? 'Our telephone provider';
 return {id: 'eu-uk', heading: 'If you are in the EU, EEA or UK', blocks: [
  P(`${BRAND} is offered to people in the European Union, the European Economic Area and the United Kingdom. This section adds what the GDPR and the UK GDPR require us to tell you. The rest of this policy applies too.`),
  H3('Who is responsible'),
  P(`The controller of your personal data is ${OPERATOR_DESCRIPTION}, ${OPERATOR_POSTAL_ADDRESS}. Contact us at ${mail(CONTACT.privacy)} or call ${OPERATOR_PHONE}.`),
  UL(
   representativeItem('Representative in the EU', 'GDPR Article 27', EU_REPRESENTATIVE),
   representativeItem('Representative in the UK', 'UK GDPR Article 27', UK_REPRESENTATIVE),
  ),
  H3('Legal bases'),
  P('The table under [Why we use data](#purposes) gives the legal basis for each use. In GDPR terms, “your consent” is Article 6(1)(a); “taking the steps you ask for” and “your request” are Article 6(1)(b), because that is how we provide the service under our [terms](/terms); “legal obligation” is Article 6(1)(c); and “legitimate interest” is Article 6(1)(f). You can object to uses based on legitimate interests, as described below.'),
  P('You do not have to give us any personal data. Without a work email address you cannot verify a work mailbox, and without your consent a draft is not screened or submitted.'),
  H3('Sensitive information'),
  P('Accounts of work can reveal special category data (GDPR Article 9), such as information about health or disability, trade union membership, religious or philosophical beliefs, political opinions, racial or ethnic origin, sex life or sexual orientation.'),
  UL(
   `**About other people.** Our [content rules](/terms#content-rules) ask you not to include this kind of information about anyone else. Our checks do not reliably catch it: the check on your device looks for identifying details such as names, contact details and exact dates, and automated screening checks whether a person could be identified, not whether a passage reveals sensitive information. ${THIRD_PARTY_SENSITIVE_DATA_BASIS ?? 'We have not yet confirmed which condition in Article 9, or which national exemption for freedom of expression and information (GDPR Article 85; in the UK, the Data Protection Act 2018), covers such information about someone else if it is published despite our rules.'} If a published contribution reveals this kind of information about you, see [If you are described in a contribution](#described), which explains when the law requires us to remove it${challenges ? ' and how the published challenge process decides a breach of our moderation rules' : ''}.`,
   CODE_FACTS.specialCategoryConsent
    ? '**About yourself.** The contribution form has a separate statement, unchecked unless you check it, that your account may reveal sensitive information about you and that you choose to publish it. Checking it is your explicit consent (Article 9(2)(a)) to that information being screened, stored while it waits and published; we store only whether you checked it, as a yes or no on the private intake record, until the contribution is withdrawn or erased. You can withdraw that consent at any time by withdrawing the contribution. Once it is published, you have also made the information public yourself (Article 9(2)(e)). Leave it out if you do not want it published; it can also make you easier to identify.'
    : '**About yourself.** If you include it about yourself, it is screened and published only because you chose to include it and submit it, and you can withdraw it at any time. Once it is published, you have made the information public yourself (Article 9(2)(e)). The submission form does not yet ask for your explicit consent to sensitive information about yourself (Article 9(2)(a)), which would cover the steps before publication: screening, storage while it waits, and any hold. Leave it out if you do not want it screened or published; it can also make you easier to identify.',
   ...(support.length ? [`**Support-resources checks.** ${upperFirst(list(support))} ${support.length > 1 ? 'handle' : 'handles'} text that may reveal information about your health, only to offer you support resources, and nothing about ${support.length > 1 ? 'them' : 'it'} is stored. ${SUPPORT_CHECKS_SENSITIVE_DATA_BASIS ?? 'We have not yet confirmed which condition in Article 9 covers this. We will state it here.'} See [Support resources](#support-resources).`] : []),
  ),
  H3('Your rights'),
  P('You have the right to access your personal data, to have it corrected or erased, to restrict or object to its use, to receive it in a portable format, and to withdraw consent at any time without affecting what was done before. We do not know who you are, so GDPR Article 11 applies: we do not have to collect more information to identify you, and the rights of access, correction, erasure, restriction and portability work only when you give us something that lets us find your data. For a contribution, that is its withdrawal capability. For the verifier’s records, it is the mailbox address, as described under [Your choices and rights](#your-rights).'),
  UL(
   '**Withdraw consent or erase.** Enter your capability on the [status page](/status). Consent to screening is asked for each draft, and sharing a search topic is off unless you turn it on.',
   `**Access and portability.** The [status page](/status) shows a contribution’s status and receipts. For a copy of the text and answers we hold for it, in a machine-readable format, email ${mail(CONTACT.privacy)} with the capability. Doing so links your email address to that contribution in our mailbox.`,
   '**Correct.** While a contribution is held or waiting for a batch, you can replace its text with a revision signed by the key in your browser. A published contribution cannot be edited: withdraw it and submit again.',
   '**Restrict.** There is no way to pause a single contribution in the product. If you ask us to restrict the use of one, we will tell you what we can do.',
   `**Object.** You can object to uses based on legitimate interests, such as the structured readings of published text or the records kept after withdrawal. Withdrawing a contribution ends the readings of it. Otherwise, write to ${mail(CONTACT.privacy)}; we will stop unless we have compelling legitimate grounds that override your interests, or need the data for legal claims. If you are described in a contribution, see [If you are described in a contribution](#described).`,
  ),
  P('We answer requests within one month. If a request is complex, we may take up to two more months, and we will tell you why within the first month.'),
  H3('Automated decisions'),
  P('These parts of moderation are automated:'),
  UL(
   'Screening of an approved draft, where our published policy code turns Jev’s probabilities into clear, repair or jury.',
   'The local identifier check that runs again when a batch is published, which can hold a contribution for repair.',
   ...(challenges ? [
    'The check of whether a challenge’s reason fits the rule it cites, made by Jev or, when Jev is unavailable, by matching the rule’s published ground terms.',
    'The re-check of a challenged account under the current policy, which can withhold a published account: its words leave the public database, and its author can repair them.',
   ] : []),
  ),
  P('[Jev and automated decisions](#jev) explains them. They decide whether a text is published as written, not anything about you, so we do not consider them decisions with legal or similarly significant effects on you under Article 22. You can still get a person involved:'),
  UL(
   'Change the words and screen them again, or withdraw the contribution.',
   jury
    ? `A case held for a jury is decided by ${initial} anonymous jurors when ${enoughJurors(juryScope(config), 'on it')}, and you can appeal once, with your capability, to a new jury of ${appeal}, when ${enoughJurors(juryScope(config), 'on the appeal')}.`
    : juryPending
     ? `${pendingJuries()}, so until one can, no person decides the merits of a held case about a real employer.${sandbox ? ` A case about a fictional sample employer can be decided by a practice jury of ${initial}, with one appeal to ${appeal} others, when ${enoughJurors('practice')}.` : ''}`
     : practice
      ? `For real employers, anonymous juries and appeals are planned but not active, so no person decides the merits of a held case about a real employer. A case about a fictional sample employer can be decided by a practice jury of ${initial}, with one appeal to ${appeal} others, when ${enoughJurors('practice')}.`
      : 'Anonymous juries and appeals are planned but not active. Until they are, no person decides the merits of a held case.',
   `Write to ${mail(CONTACT.privacy)} with the rule and the wording, not your capability. A person will check whether the published rule was applied as written and tell you the result. No one can approve or release an individual case through the application, but if our code or policy is wrong, we fix it for everyone.`,
  ),
  H3('Transfers outside the EU, EEA and UK'),
  P('We are based in the United States, and our providers process personal data there and possibly in other countries, where data protection law differs from yours. The safeguards are:'),
  UL(
   '**Cloudflare** states that when it transfers personal data from the EEA or the UK to the United States, it relies on its certification under the EU-U.S. Data Privacy Framework and the UK Extension to it, and on standard contractual clauses if that certification lapses. Cloudflare also states that its customer data processing addendum includes the EU standard contractual clauses and the UK Addendum.',
   ...(CONTACT_MAIL.mailboxProvider ? [`**${CONTACT_MAIL.mailboxProvider}**, which stores mail sent to our contact addresses: ${CONTACT_MAIL.mailboxTransfer ?? 'we have not yet confirmed the safeguard. We will state it here.'}`] : []),
   `**${phone}**, which carries calls to ${OPERATOR_PHONE}: ${TELEPHONE_PROVIDER.transfer ?? (TELEPHONE_PROVIDER.name ? 'we have not yet confirmed the safeguard. We will state it here.' : 'we have not yet named it or confirmed the safeguard. We will state both here.')}`,
   MODEL_PROVIDER.transfer
    ? `**${modelProviderName()}**: ${MODEL_PROVIDER.transfer}`
    : `**${MODEL_PROVIDER.name}**: confirmation is pending. We have not yet confirmed where ${MODEL_PROVIDER.name} processes data or which safeguard covers transfers to it. [Jev and automated decisions](#jev) explains what that means until we do.`,
  ),
  P(`For a copy of these safeguards, email ${mail(CONTACT.privacy)}.`),
  H3('Complaints and assessments'),
  P(`You can complain to a data protection supervisory authority: in the EU or the EEA, the authority where you live, where you work or where you think the infringement happened ([list of authorities](https://www.edpb.europa.eu/about-edpb/about-edpb/members_en)); in the UK, the Information Commissioner’s Office ([make a complaint](https://ico.org.uk/make-a-complaint/)). You can also complain to us first at ${mail(CONTACT.privacy)}.`),
  P(dpia
   ? `We completed a data protection impact assessment (GDPR Article 35) on ${longDate(dpia)}, and we review it when the service changes.`
   : 'We are preparing a data protection impact assessment (GDPR Article 35) for the service. It is not complete yet, and we will say here when it is.'),
 ]};
}

/** Terms section for people in the EU, the EEA and the UK: consumer law, the Digital Services Act and the UK Online Safety Act. */
function euUkTerms(config: LegalConfig): LegalSection {
 const {jury, juryPending, sandbox, practice, challenges, trustees} = switches(config), rep = DSA_LEGAL_REPRESENTATIVE, {appeal} = policy.jury;
 const {ukIllegalContentRisk, ukChildrenAccess} = COMPLIANCE_ASSESSMENTS;
 const pending = osaPending();
 const done = [ukIllegalContentRisk && `illegal content risk assessment on ${longDate(ukIllegalContentRisk)}`, ukChildrenAccess && `children’s access assessment on ${longDate(ukChildrenAccess)}`].filter((x): x is string => !!x);
 const assessments = [
  done.length ? `We completed our ${list(done)}.` : '',
  pending.length ? `Our ${list(pending)} under the Act ${pending.length > 1 ? 'are' : 'is'} not yet complete.` : '',
 ].filter(Boolean).join(' ');
 const challenge = challenges ? ', or, if it also breaks a rule in our moderation policy, challenge it from the account itself' : '';
 return {id: 'eu-uk', heading: 'EU and UK users', blocks: [
  P('This section applies if you live in the European Union, the European Economic Area or the United Kingdom. It adds to the rest of these terms and takes priority where they conflict.'),
  H3('Your consumer rights'),
  P(`If you use the service as a consumer, you keep the protection of the mandatory laws of the country where you live, even though these terms choose the law of ${GOVERNING_LAW}, and the courts described under [Governing law and venue](#governing-law). You may bring a claim in the courts of the country where you live. Nothing in these terms limits liability that cannot be limited under the law of your country, such as liability for death or personal injury caused by negligence, or for fraud.`),
  H3('Digital Services Act'),
  P(`In the EU, ${BRAND} is a hosting service and an online platform under the Digital Services Act (Regulation (EU) 2022/2065). Micro and small enterprises are exempt from some of its articles, including the transparency reports of Article 15 (Article 15(2)) and Articles 20 to 28 apart from Article 24(3) (Article 19). Whether or not a particular article applies to us, this section describes what we actually do.`),
  P(`**Points of contact (Articles 11 and 12).** Member state authorities, the European Commission and the European Board for Digital Services can reach us at ${mail(CONTACT.legal)}. You can reach us at ${mail(CONTACT.legal)}, or at ${mail(CONTACT.privacy)} about personal data, or by post at ${OPERATOR_POSTAL_ADDRESS}. A person reads and answers these messages; you are never limited to an automated tool. We communicate in English.`),
  P(representativeNamed(rep)
   ? `**Legal representative (Article 13).** Our legal representative in the EU is ${rep.name ?? ''}, ${rep.address ?? ''}${rep.email ? `, ${mail(rep.email)}` : ''}. Authorities may contact it instead of us, or as well as us, on any matter under the Act.`
   : '**Legal representative (Article 13).** We have no establishment in the EU. The appointment of our legal representative in an EU member state is pending. Until we name one here, contact us directly as above.'),
  P(`**Reporting illegal content (Article 16).** Send a notice to ${mail(CONTACT.legal)}${challenge}. Include the elements listed under [Legal notices and court orders](#legal-notices): a link to the content, why you believe it is illegal, your name and email address, and a statement that you believe in good faith that the notice is accurate and complete. You may leave out your name and email address if the notice concerns child sexual abuse or exploitation offences (Articles 3 to 7 of Directive 2011/93/EU), but we then cannot confirm receipt or tell you our decision. Otherwise we confirm receipt and, without undue delay, tell you our decision, the reasons for it and how to challenge it. A person reviews each notice sent by email and decides whether the content is illegal; no automated tool decides that.${challenges ? ' A notice that says only that a contribution breaks a rule in our moderation policy, and not the law, is handled as a challenge, as described under [Legal notices and court orders](#legal-notices).' : ''}${challenges ? ` A challenge made from the account is handled under the moderation policy, as described under [Challenging a contribution](#challenges): an automated check of whether its reason fits the cited rule, a re-check of the account, and a jury where one is needed and can be formed. You get a receipt with the outcome and the reason at once${challengesQueued() ? ', or a receipt saying the challenge is queued for a re-check that could not run at once' : ''}. You cannot yet look up a jury’s later decision${challengesQueued() ? ', or a queued re-check’s result,' : ''} with that receipt; if the jury upholds the rule, or the re-check withholds the account, it is no longer shown.` : ''}`),
  P(`**Statements of reasons (Article 17).** When a contribution is held, not published as written, withheld or removed, its author is entitled to know why. We cannot send the reasons to authors, because contributions cannot be linked to a person and we have no contact details for them. Instead, when you check a draft before submitting it, screening shows the outcome, the reason from each rule that applied and the policy version. After you submit, the [status page](/status) shows, for your capability, the contribution’s status and a receipt for each moderation decision about it, such as ${list(['screening', 'the check before publication', ...(challenges ? ['a challenge'] : []), ...(practice ? ['a jury decision', 'an appeal'] : [])], 'or')}, with the rule, the policy version and digest, how it was decided and the outcome.${practice ? ' It also shows whether you can appeal.' : ''} Removals under legal notices are recorded in the [legal requests ledger](/legal-requests) when the law allows${trustees ? '; a withholding under the trustee process is also shown on the status page' : '; the status page does not yet show them'}.`),
  P(`**Complaints about our decisions (Article 20).** You can complain about a decision free of charge for six months after it. ${jury
   ? `If a jury decides against your contribution, you can appeal once with your capability, when ${enoughJurors(juryScope(config), 'on an appeal')}; a new jury of ${appeal} decides without seeing the first result. The [status page](/status) says whether an appeal is available.`
   : juryPending
    ? `For real employers, juries and appeals are switched on, but one forms only when ${enoughJurors('real')}, and none can yet; until one can, you can repair a held case with new words, which are screened again, or withdraw it.${sandbox ? ` If a practice jury decides against a contribution about a fictional sample employer, you can appeal once with your capability, but only when ${enoughJurors('practice', 'on an appeal')}; the [status page](/status) says whether an appeal is available.` : ''}`
   : practice
    ? `For real employers, appeals to a new jury are not active yet; until they are, you can repair a held case with new words, which are screened again, or withdraw it. If a practice jury decides against a contribution about a fictional sample employer, you can appeal once with your capability, but only when ${enoughJurors('practice', 'on an appeal')}; the [status page](/status) says whether an appeal is available.`
    : 'Appeals to a new jury are planned but not active. Until they are, you can repair a held case with new words, which are screened again, or withdraw it.'} Anyone affected by a decision, including someone who sent a notice${challenges ? ' or a challenge' : ''} and an author whose contribution was held, withheld or removed, can also write to ${mail(CONTACT.legal)} with the public link or the wording (never a capability) and their reasons. A person reviews each complaint, checks whether our published rules and the law were applied correctly, and replies with the outcome. No complaint is decided only by automated means. If a complaint shows that a decision was wrong, we fix the rule or the code for everyone and tell you. We cannot release an individual held text, but its author can repair it or submit it again. ${trustees ? 'A withholding under the trustee process ends when it expires.' : 'A removal we made under a legal notice is reversed through the same administrative access.'}`),
  P('**Out-of-court dispute settlement (Article 21).** You may take a dispute about our decisions to an out-of-court dispute settlement body certified under Article 21; the European Commission publishes the list of certified bodies. We will engage with the body in good faith. Its decision does not bind you or us, and you can still go to court.'),
  P('**Trusted flaggers (Article 22).** Notices from trusted flaggers awarded that status under Article 22 are processed without undue delay, under the same rules, standard and handling as every other notice. Our [published rules](/moderation/current.json) give no organization privileged handling or priority.'),
  P(`**Transparency (Article 15).** The [transparency page](/transparency) publishes rounded counts and archives, and the [legal requests ledger](/legal-requests) records legal requests and removals when the law allows. Quarterly moderation counts, such as submissions, repairs, jury cases, rejected challenges and appeals, are published as data at [/api/moderation/stats](/api/moderation/stats)${roundedModerationCounts() ? ', refreshed once a UTC day. Counts that follow contributions (submissions, automatic publications, repairs, jury cases, held cases and jury outcomes) are shown as “<25” from 1 to 24 and otherwise rounded down to a multiple of 25; any other count below 5 is shown as “<5”.' : '; any count below 5 is shown as “<5”.'} We use no analytics, so we do not count monthly active users.`),
  P('**Suspected crimes against life or safety (Article 18).** If information we become aware of makes us suspect a criminal offence involving a threat to someone’s life or safety, the law requires us to inform the police or judicial authorities of the member state concerned promptly. We can share only what we hold; see the [privacy policy](/privacy#legal-requests).'),
  H3('UK Online Safety Act'),
  P(`For people in the UK, ${BRAND} is a user-to-user service under the Online Safety Act 2023.`),
  UL(
   `**Reporting content.** Report content you believe is illegal in the UK, or that breaks our rules, by email to ${mail(CONTACT.legal)}${challenges ? ', or, for a rule in our moderation policy, with a challenge from the account' : ''}, as described above. You do not need an account.`,
   `**Complaints.** You can complain to ${mail(CONTACT.legal)} about content, about a decision to hold, not publish, withhold or remove your contribution, about our use of automated screening, or if you think we are not meeting our duties under the Act. A person reviews each complaint and tells you the outcome.`,
   '**How we protect people from illegal content.** Our content rules forbid threats, harassment and exposing private information, among other things. Every contribution is screened automatically against the moderation policy before it can be published, as described under [How contributions are screened](#screening), and we act on notices as described under [Legal notices and court orders](#legal-notices).',
   '**Equal treatment.** Every report and complaint is decided under the same published rules and the law. No organization, including an employer, gets a privileged outcome.',
   `**Age.** You must be ${MINIMUM_AGE} or older to use the service; see [Who can use it](#eligibility).${assessments ? ` ${assessments}` : ''}`,
  ),
 ]};
}

export function termsOfUse(config: LegalConfig): LegalDocument {
 const {jury, juryPending, samples, sandbox, practice, challenges, trustees, community} = switches(config), allActive = jury && trustees && challenges;
 const {recoveryDays, employerNameMaxChars} = CODE_FACTS;
 const {initial, appeal} = policy.jury;
 const withheldBy = [challenges && 'a challenge', practice && 'a jury decision', trustees && 'a trustee exception'].filter((x): x is string => !!x);
 const agent = dmcaAgentComplete() ? DMCA_AGENT : null;
 return {
  slug: 'terms',
  title: 'Terms of use',
  lede: `The agreement between you and the operator of ${BRAND}. It is written to match how the service works${allActive ? '' : ', including what is not active yet'}.`,
  sections: [
   {id: 'agreement', heading: 'The agreement', blocks: [
    P(`${BRAND} is operated by ${OPERATOR_DESCRIPTION} (“we”, “us”). By using the site or contributing, you agree to these terms and to the content rules in our [constitution](/constitution) and [moderation policy](/moderation/current.json). Our [privacy policy](/privacy) explains how data is handled. If you do not agree, do not use the service.`),
   ]},
   {id: 'eligibility', heading: 'Who can use it', blocks: [UL(
    `You must be at least ${MINIMUM_AGE} years old and able to form a binding contract. By using the service or contributing, you confirm that you are.${CODE_FACTS.adultConfirmationEnforced ? ` The contribution form asks you to confirm it, and a contribution without that confirmation is refused.` : ''}`,
    'Contribute only about a workplace you have a real relationship with, and verify only a mailbox that was issued to you and that you are allowed to use.',
    'Employers, their staff and their agents may use the service like anyone else. They get no special access or accounts and cannot pay for anything.',
   )]},
   {id: 'service', heading: 'What the service is', blocks: [
    P(`A free place to read and contribute anonymous, credentialed accounts of workplaces, and aggregated questionnaire results. It is a preview, and features may change.${allActive ? '' : ' Some protections described in the constitution are not active yet.'}`),
    UL(
     'There are no accounts, payments, subscriptions, trials or advertising. Donations are not enabled.',
     samples ? 'Some employers are fictional samples. They are labeled wherever they appear, and their data is illustrative, not about any real organization.' : 'There are no fictional or sample employers on the site. Employers are listed by us or, where a listing says so, by whoever added it; see [Employers added by the community](#community-listings).',
     config.realPublicationEnabled ? `Accounts about real employers are published after screening and a random delay, only in ${batchRule(config, 'accepted accounts')}.${legacyBatchSentence(config)} Questionnaire results are published only as figures for groups of at least ${AGGREGATE_MIN} contributions.` : `Publication for real employers is paused. Accepted contributions about real employers are held privately and erased if not published within ${RETENTION.approvedUnbatchedDays} days of submission.`,
    ),
   ]},
   {id: 'content-rules', heading: 'Content rules', blocks: [
    P('The [constitution](/constitution) and the executable [moderation policy](/moderation/current.json) are the content rules, and they apply equally to every organization. In summary, when you contribute:'),
    UL(
     'Give a truthful account of what you experienced or directly observed, and choose the contribution type (experience, claim or opinion) honestly.',
     'Criticism and negative opinions are allowed.',
     'Do not name or otherwise identify private individuals, including managers and coworkers. Describe roles and conduct instead.',
     'Do not post anyone’s home address, personal phone number, private contact details or whereabouts.',
     'No threats, and no incitement or encouragement of violence or targeted harm.',
     'No harassment or personal attacks. Describe conduct, not a person’s character.',
     'Do not post trade secrets or other information you are legally required to keep confidential, or other people’s personal records such as health or payroll records.',
     'Do not reveal sensitive information about other people, such as their health, sexual orientation, religion, political views or trade union membership.',
     'No spam, promotion, impersonation, paid or coordinated contributions, or attempts to manipulate aggregate figures.',
     'Do not try to identify contributors, defeat the privacy protections, interfere with the service, get around rate limits, or use automated tools in a way that burdens it.',
     ...(community ? ['When you add an employer, give the name the organization uses and a domain you believe it uses for its staff’s email. Do not list a person, a made-up organization or a domain you know belongs to someone else, and do not use a listing to impersonate, promote or attack anyone.'] : []),
    ),
    P(`Automated screening checks drafts against the rules in the moderation policy: identifying a private person or the author, threats, private contact or location details, personal attacks, promotion and coordinated manipulation.${challenges ? ' Those rules can also be cited in a challenge.' : ''} The other rules above, such as truthfulness, the contribution type, confidential information, sensitive information about others and other people’s records, are not checked automatically${challenges ? ' and cannot be cited in a challenge' : ''}. No one at the operator removes a contribution on their own judgment that it breaks a content rule: we remove one for breaking these rules only where the law requires it. Report a breach of them to ${mail(CONTACT.legal)} as described under [Legal notices and court orders](#legal-notices) or, if it concerns you, as described in the [privacy policy](/privacy#described).`),
    P('Nothing in these terms limits rights you have by law, such as discussing pay and working conditions with others or reporting suspected wrongdoing to a government agency.'),
   ]},
   {id: 'your-contributions', heading: 'Your contributions', blocks: [
    P('You keep ownership of what you write. By submitting, you give us a worldwide, non-exclusive, royalty-free license to store, screen, reproduce, publish and display your contribution, to analyze it with automated tools, to include it in aggregate statistics and to let others read it, until you withdraw it or it is erased under the privacy policy. You confirm that you have the right to grant this license.'),
    P('**You are responsible for what you contribute.** Publishing an account can have legal consequences for its author. For example, a false statement of fact about an identifiable person or company can lead to a defamation claim. Someone may ask a court to order us to disclose information that could help identify an author, including before a lawsuit is filed. We resist such requests to the extent the law allows, and we can disclose only what we hold; see [legal requests](/privacy#legal-requests).'),
    P(`Only you can change your words; we do not rewrite testimony. When you withdraw, we remove your text and what we derived from it, and the license ends, except for information that no longer contains your text, such as rounded counts in transparency archives, and for database recovery history, which lasts up to ${recoveryDays} days. During that time a court order could require us to recover withdrawn text from that history. We cannot recall copies that others have made.`),
    P('Keep your withdrawal capability safe. Anyone who has it can withdraw your contribution, and we cannot recover it for you.'),
   ]},
   {id: 'verification', heading: 'Verification', blocks: [
    P(`The label “Work mailbox verified” means someone controlled a mailbox at an email domain listed for that employer at the time of verification. Beside such an account we show the domains listed for the employer when you read it, not a record of the domain its author used. For an employer added by the community, or a domain someone added to one of our own listings, the domain was supplied by whoever added it, so the label shows control of a mailbox at that domain, not that the domain belongs to the employer named. It does not prove identity, job title, current employment, or that each contribution comes from a different person. Each mailbox can obtain one credential per employer per quarter${practice ? `, and ${jurorAllowance()}` : ''}. Verification emails name the service and can be read by anyone with access to the mailbox, including your employer. For a domain added by the community, the number of verification emails a day is limited, so a code may not arrive until the next UTC day; see [Employers added by the community](#community-listings). Do not share, sell or trade credentials, proofs or juror tokens.`),
   ]},
   {id: 'screening', heading: 'How contributions are screened', blocks: [
    P('Before it can be submitted, your draft is checked on your device and, with your consent, screened by an automated model, Jev, against the published policy. Code, not a person, applies the policy. The outcome is clear, repair (you change the words) or jury (held privately). No one at the operator can approve, edit, release or suppress an individual contribution through the application.'),
    P(jury
     ? `Held cases are decided by anonymous juries of ${initial}, if the author allowed anonymous jurors to read the words and ${enoughJurors(juryScope(config), 'on the case')}, and the author can appeal once to ${appeal} different jurors when ${enoughJurors(juryScope(config), 'on an appeal')}; the appeal is final for those words. Without that permission a held case stays private and is erased about ${RETENTION.heldDays} days after it was held, unless you repair or withdraw it.`
     : juryPending
      ? `${pendingJuries()}; the [moderation page](/moderation#juries) says whether one can form now. Until one can, held cases about real employers are not published as written and are erased about ${RETENTION.heldDays} days after they were held, unless you repair or withdraw them.${sandbox ? ` Held cases about fictional sample employers can be decided by practice juries of ${initial}, but only if the author allowed anonymous jurors to read the words and ${enoughJurors('practice')}; the author can then appeal once to ${appeal} different jurors, when enough can serve on an appeal.` : ''}`
     : practice
      ? `For real employers, anonymous juries and appeals are not active yet. Until they are, held cases about real employers are not published as written and are erased about ${RETENTION.heldDays} days after they were held, unless you repair or withdraw them. Held cases about fictional sample employers can be decided by practice juries of ${initial}, but only if the author allowed anonymous jurors to read the words and ${enoughJurors('practice')}; the author can then appeal once to ${appeal} different jurors, when enough can serve on an appeal. The [moderation page](/moderation#juries) says whether a practice jury can form now.`
      : `Anonymous juries and appeals are not active yet. Until they are, held cases are not published as written and are erased about ${RETENTION.heldDays} days after they were held, unless you repair or withdraw them.`),
    ...(challenges ? [P('After publication, an account can be checked again if someone challenges it; see [Challenging a contribution](#challenges).')] : []),
   ]},
   {id: 'not-endorsed', heading: 'We do not verify or endorse what contributors say', blocks: [
    P('Contributions are the views and accounts of their anonymous authors: each is information its author provides, which we host under the published rules. We do not investigate or verify allegations, and publishing an account is not a finding by us that anything in it is true. Model readings and aggregate figures describe what contributors said; they are not our assessment of any employer.'),
    P('Answers on the evidence pages are fixed sentences that our code fills in with released numbers, their sample sizes and periods; no model writes them. When you select a group, every answer names it. Answers and notices never state a count of written accounts from one to four, although the accounts themselves can be read and counted. A summary of model readings, such as how accounts describe workload, is shown only when it covers at least five accounts and each of its counts is zero or at least five. Model readings are not votes.'),
   ]},
   {id: 'employers', heading: 'Employers named on the site', blocks: [
    P('We are not affiliated with, sponsored by or endorsed by any employer shown on the site, and listing an employer does not mean it takes part or agrees with anything said about it. Employer names are used only to identify the workplace an account describes, and we do not use employer logos. Trademarks belong to their owners.'),
   ]},
   {id: 'community-listings', heading: 'Employers added by the community', blocks: [
    P(`${community ? `Anyone can add an employer that is not listed, by giving its name (up to ${employerNameMaxChars} characters) and a work-email domain.` : 'Adding employers is closed right now; listings added before it closed remain, as described here.'} Adding an employer is separate from contributing: it reveals nothing about anyone who later writes about it, and contributing still needs a code sent to a mailbox at that domain. The privacy policy describes what is sent and kept under [When you add an employer](/privacy#adding-employers).`),
    P(`A community listing shows its domain beside the name, for example “Acme (acme.com)”, and says it was added by the community. Its name and domain were supplied by whoever added it, not by us or by the employer. Our checks are automatic and limited: the name must not contain identifying details about a person or abusive words, must not mean an employer already listed with a domain, and an automated model must judge it likely to be an organization’s name; the domain must be a valid host name with mail records that is not a free, disposable or reserved email domain, is not listed already, contains no abusive words, is not named after another listed employer, and must either carry the employer’s name or be judged by the automated model at least ${Math.round(MATCH_AT * 100)}% likely to be its email domain. A domain is added to one of our own listings that has none only if the automated model finds it at least ${Math.round(CODE_FACTS.domainPlausibility * 100)}% likely to be that employer’s corporate email domain and the domain’s own name is exactly a significant word of the employer’s name or of one of our known alternative names for it, or one of those names written as one word or with hyphens between its words; otherwise it becomes a separate listing. One of our listings that receives a domain this way keeps our name, but the domain was still supplied by whoever added it: it is shown beside the verified accounts under that listing and on the employer’s page, marked as added by the community. These checks do not establish that the organization exists, that it uses the domain, or that whoever added it has any connection to it. A listing is not a statement by us about the employer, and we do not endorse it.`),
    P(`Check the domain shown beside the name and on each account. Accounts under a community listing come from people who controlled a mailbox at that domain; if the domain is not really the employer’s, they are not accounts from its staff. Verification emails for a domain added by the community are limited to ${n(COMMUNITY_EMAIL_LIMITS.perEmployerPerDay)} per UTC day for that employer and ${n(COMMUNITY_EMAIL_LIMITS.allCommunityPerDay)} per UTC day for all such employers together. Anyone can use up those emails, and over the limit no email is sent although the request is answered as usual, so a code may not arrive until the next UTC day.`),
    P(`**Correcting a listing.** If a listing names the wrong organization, shows a domain that does not belong to the employer named, duplicates another listing or breaks the content rules, email ${mail(CONTACT.legal)} with a link to the listing, what is wrong and any public evidence, such as the organization’s own website or the domain’s mail settings. The employer concerned can write too, on the same terms as anyone else; no one gets priority or a separate channel. A person reviews each request, and only a person applies a correction: through a route that only we can use, with our administrator key, or by taking a domain down directly at the verifier, which the publisher’s scheduled job then mirrors and logs in the same way. The route can fix the name of a listing added by the community, detach a domain added by the community (from a community listing or from one of our own listings), or remove a community listing altogether, but only while nothing about it is published, held or waiting to be published. It cannot rename or remove one of our own listings, or detach a domain we listed. Detaching a domain first takes it down at the verifier, which deletes the signing keys created for it, so no new credentials are issued for it, and keeps a record of the listing and the domain so that neither can be registered again unless we re-admit it; the publisher then deletes its copies of those keys, so credentials issued with them and not yet used are no longer accepted. Each correction is added to a public log of listing corrections on the [transparency page](/transparency#listing-corrections), with the kind of correction, the reason, the quarter and a digest of the listing’s page identifier, never its name or who asked. A correction changes the listing, never the words of a published account, and does not remove one. Accounts show the domains listed for the employer when you read them, so after a wrong domain is detached they no longer show it. Whether an account itself may stay published is decided only by the content rules, the challenge process and the law, as for any other account.`),
   ]},
   {id: 'challenges', heading: 'Challenging a contribution', blocks: [
    P('Anyone, including an employer, may challenge a published contribution under a specific published rule, on equal terms. Challenges under the content rules are judged only against the published rules; legal claims are handled as legal notices under the law. Reputational discomfort, disagreement and a claim that an allegation is untrue are not grounds, and no one can pay for priority.'),
    ...(challenges ? [
     P(`To challenge, open the account and choose to challenge it. Cite one rule from the [moderation policy](/moderation/current.json) and explain, in up to ${policy.challenges.reasonMaxChars} characters and without identifying anyone, how the account breaks it. Citing a protection, such as the one for criticism, never leads to removal. Jev checks whether your reason fits the rule, reading it with any detected identifying details masked; if Jev is unavailable, has failed in the last ${policy.challenges.relevance.retryAfterMinutes} minutes or has used its daily checks, the reason must contain one of the rule’s published ground terms. If it fits, the published words are checked again under the current policy. An account is re-checked at most once under each policy version, and later challenges reuse that result:`),
     UL(
      'if the words contain a direct identifier or meet a rule’s repair threshold, the account is withheld from publication and its author can repair it;',
      jury
       ? `if they fall in the cited rule’s jury range, an anonymous jury of ${initial} decides, where one can be formed, while the account stays published;`
       : juryPending
        ? `if they fall in the cited rule’s jury range, an anonymous jury of ${initial} decides where one can be formed${sandbox ? ' (for an account about a fictional sample employer, a practice jury)' : ''}, while the account stays published; for a real employer none can form yet, so the account stays published;`
       : practice
        ? `if they fall in the cited rule’s jury range and the account is about a fictional sample employer, a practice jury of ${initial} decides, where one can be formed, while the account stays published. For a real employer, juries are not active yet, so the account stays published;`
        : 'if they fall in the cited rule’s jury range, the account stays published, because juries are not active yet;',
      'otherwise, the account stays published.',
     ),
     P(`You get a receipt with the outcome and the reason at once${challengesQueued() ? ', or, if the re-check cannot run when your challenge arrives, a receipt saying it is queued' : ''}. If the account is withheld, you are told only that it was withheld under the published rules; its author is told which rule applied. You cannot yet look up a jury’s later decision${challengesQueued() ? ', or the result of a queued re-check,' : ''} with the receipt. A challenge under a rule that already has an open jury case for the account joins that case. Once a jury has decided a rule for the same published words under the same policy version (any appeal, or a first jury that did not uphold the rule or reached no decision), later challenges under that rule are merged into that decision until the policy changes. ${challengesQueued() ? `When the day’s re-checks are used up, or Jev is unavailable, a relevant challenge is queued rather than refused, and a scheduled job re-checks it as capacity returns${urgentRechecks() ? `, challenges under the privacy and safety rules (${list([...urgentRechecks()!.rules])}) first` : ''}; the account stays published meanwhile.` : 'When the day’s re-checks are used up, a challenge is answered “try again later” and nothing changes.'}${samples && fixturesProtected() ? ' Accounts written as demonstration data for the fictional sample employers cannot be withheld by a challenge or a jury; a challenge to one is recorded as a practice case, and its receipt says so.' : ''} ${challengeBudget() && CODE_FACTS.dailyNetworkDigests ? `Each network can send at most ${challengeBudget()!.perClientPerDay} challenges a day, and a challenge whose reason does not fit the cited rule uses ${words(challengeBudget()!.notRelevantExtra)} more` : 'Challenges are limited per network, and a challenge that is not accepted uses more of the limit'}.`),
    ] : [
     P(`The in-product challenge process is not active yet. Until it is, send challenges to ${mail(CONTACT.legal)} with a link to the contribution and the rule you believe it breaks. We acknowledge each one, normally within 5 business days. A challenge that raises a legal claim or a credible safety issue is handled now as a legal notice. Other challenges are recorded and will be decided under the published rules when the process opens, and we will tell you the outcome.`),
    ]),
   ]},
   {id: 'legal-notices', heading: 'Legal notices and court orders', blocks: [
    P(`${sendLegalNotices()} A notice about content you believe is illegal should include:`),
    UL(
     'a link to each contribution concerned;',
     'an explanation of why it is illegal, citing the law where you can;',
     'your name and email address, and whether you act for someone else; and',
     'a statement that you believe in good faith that the information in the notice is accurate and complete.',
    ),
    P(`We acknowledge each notice, normally within 5 business days, review it for validity and scope, and tell the sender what we decided and the rule or law it was based on. A person decides a notice against the law, not against our content rules, and we remove a contribution only where the law requires it.${challenges ? ' If a notice says only that a contribution breaks a rule in our moderation policy, it is decided by the published challenge process instead: we can file the challenge for the sender through the same public process, with no priority, and send them its receipt.' : ''} We record notices and removals in the public [legal requests ledger](/legal-requests) when the law allows. We protect anonymous speech to the maximum extent permitted by law, and we can produce only what we hold; see the [privacy policy](/privacy#legal-requests).`),
    P(trustees
     ? `Removal under a valid legal order, or for a credible imminent-safety issue, requires at least ${words(policy.exceptions.requiredSignatures)} of ${words(policy.exceptions.trustees)} independent trustees, is limited in scope and time, and gets a public transparency entry.`
     : `Removal under a valid legal order, or for a credible imminent-safety issue, is designed to require ${words(policy.exceptions.requiredSignatures)} of ${words(policy.exceptions.trustees)} independent trustees, limited in scope and time, with a public transparency entry. That process is not active yet. Until it is, we act on valid orders through direct administrative access to our infrastructure, limit the action to what the order requires, and record it in the ledger when the law allows.`),
    P(`**If your contribution is removed.** We cannot notify authors, because we do not know who they are.${withheldBy.length ? ` The [status page](/status) shows, with a receipt, when a contribution was withheld after ${list(withheldBy, 'or')}.` : ''}${trustees ? '' : ' The status page does not yet show a removal we made under a legal notice; check the legal requests ledger.'} If you believe a removal was wrong, write to ${mail(CONTACT.legal)} with the public link, not your capability, and explain why; for a copyright removal, send a counter-notice as described below.`),
   ]},
   {id: 'copyright', heading: 'Copyright complaints (DMCA)', blocks: [
    P(`If you believe material on the site infringes your copyright, send a notice to our designated agent at ${mail(CONTACT.dmca)}. It must include:`),
    UL(
     'your physical or electronic signature;',
     'identification of the copyrighted work;',
     'identification of the material you want removed and where it is on the site, such as a link;',
     'your name, postal address, telephone number and email address;',
     'a statement that you believe in good faith that the use is not authorized by the copyright owner, its agent or the law; and',
     'a statement that the information in the notice is accurate and, under penalty of perjury, that you are the owner or authorized to act for the owner.',
    ),
    P(agent
     ? `Our designated agent, registered with the US Copyright Office, is ${agent.name}, ${agent.postalAddress}, telephone ${agent.phone}, email ${mail(CONTACT.dmca)}.`
     : `Registration of our designated agent with the US Copyright Office is pending. Until it is complete, send notices to ${mail(CONTACT.dmca)} and we will still act on them. We will publish the agent’s name, postal address and telephone number here once registration is complete.`),
    P(`If your contribution was removed after a copyright notice, you may send a counter-notice to ${mail(CONTACT.dmca)}. It must include:`),
    UL(
     'your physical or electronic signature;',
     'identification of the material that was removed and where it appeared before it was removed;',
     'a statement under penalty of perjury that you believe in good faith that the material was removed as a result of mistake or misidentification;',
     'your name, address and telephone number; and',
     'a statement that you consent to the jurisdiction of the federal district court for the judicial district in which your address is located or, if your address is outside the United States, any judicial district in which we may be found, and that you will accept service of process from the person who sent the notice or their agent.',
    ),
    P('A counter-notice identifies you to us and to the person who complained. Consider that before sending one. Because we do not know who authors are, we cannot tell an author directly that their contribution was removed; removals are recorded in the legal requests ledger when the law allows.'),
    P('Contributions cannot be linked to each other or to a person, by design, and there are no accounts. We therefore cannot identify repeat infringers in the usual way. We remove each infringing contribution when we receive a valid notice.'),
   ]},
   {id: 'jurors', heading: 'Jurors', blocks: [
    P(`${jury ? '' : juryPending ? `Juries for real employers are switched on, but one forms only when ${enoughJurors('real')}, and none can yet; the [moderation page](/moderation#juries) says whether one can form now. ${sandbox ? `Practice juries decide cases about fictional sample employers only when ${enoughJurors('practice')}. ` : ''}` : practice ? `Juries for real employers are not active yet. Practice juries decide cases about fictional sample employers only when ${enoughJurors('practice')}; the [moderation page](/moderation#juries) says whether one can form now. ` :'Juries are not active yet. When they are, the following applies. '}Jurors are unpaid volunteers. Serving as a juror does not make you our employee, agent or contractor. Jurors must answer only the question asked, using the rule and passage shown, and must not try to identify authors.${practice || juryPending ? ` Juror tokens do not prove that their holders are different people: one work mailbox can obtain ${jurorAllowance('tokens')} per employer per quarter${seatLimits()}.${jury || juryPending ? communityJurors() : ''}${sandbox ? ` Tokens for fictional sample employers need no email address and prove nothing about employment${seatCap('sandbox') === null ? '. They have no seat limit, so one person can hold several seats on a practice case, which therefore only demonstrates the procedure' : ''}.` : ''}` : ''}`),
   ]},
   {id: 'no-payments', heading: 'No payments', blocks: [
    P('The service is free. There are no subscriptions, trials, paid features or purchases, and donations are not enabled. No one can pay to influence publication, ranking or moderation. If we ever accept donations, we will update these terms first.'),
   ]},
   {id: 'our-site', heading: 'Our site and code', blocks: [
    P(`Our original source code is published under the MIT License and can be downloaded from the [source page](/source). Contributions belong to their authors. The name ${BRAND} is ours; do not use it in a way that suggests we endorse you.`),
   ]},
   {id: 'disclaimers', heading: 'Disclaimers', blocks: [
    P('The service is provided “as is” and “as available”, without warranties of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, accuracy and non-infringement, to the fullest extent the law allows. We do not promise that the service will be available, error-free or secure.'),
    P('Local privacy checks and delayed release reduce the risk of identification but cannot guarantee anonymity. Nothing on the site is legal, financial, employment or other professional advice; use your own judgment before acting on it.'),
   ]},
   {id: 'liability', heading: 'Limitation of liability', blocks: [
    P('To the fullest extent the law allows, we and our members, managers and contractors are not liable for any indirect, incidental, special, consequential, exemplary or punitive damages, or for lost profits, data, goodwill or opportunities, arising from or related to the service or these terms, even if we were told they were possible. Our total liability for all claims relating to the service is limited to one hundred US dollars (US$100). Some jurisdictions do not allow these limits, so some of them may not apply to you.'),
   ]},
   {id: 'indemnity', heading: 'Indemnity', blocks: [
    P('To the extent the law allows, you will defend and indemnify us against claims, losses and costs, including reasonable legal fees, that arise from your contributions or your breach of these terms.'),
   ]},
   {id: 'governing-law', heading: 'Governing law and venue', blocks: [
    P(`These terms are governed by the laws of ${GOVERNING_LAW}, without regard to conflict-of-law rules. Any dispute arising from these terms or the service will be brought only in ${VENUE}, and you and we consent to their jurisdiction. If the law where you live gives you the right to bring claims in your local courts or under local consumer law, this section does not take that right away.${SERVES_EU_UK ? ' If you live in the EU, the EEA or the UK, see also [EU and UK users](#eu-uk).' : ''}`),
   ]},
   ...(SERVES_EU_UK ? [euUkTerms(config)] : []),
   {id: 'changes', heading: 'Changes to these terms', blocks: [
    P('We will post changes here with a new version number and effective date. Material changes will be posted at least 30 days before they take effect, unless a change is required by law or urgently needed for security. If you keep using the service after a change takes effect, the new terms apply. Changes to the constitution follow its own notice process.'),
    changelog(),
   ]},
   {id: 'general', heading: 'General', blocks: [
    P('If part of these terms is unenforceable, the rest stays in effect. Not enforcing a term is not a waiver. These terms, together with the constitution, the moderation policy and the privacy policy, are the whole agreement between you and us about the service. We may transfer these terms to a successor that keeps the commitments in the privacy policy. You may stop using the service at any time.'),
   ]},
   {id: 'contact', heading: 'Contact', blocks: [P(`${OPERATOR_DESCRIPTION}.`), contacts()]},
  ],
 };
}

/** The day of the last accessibility self-review and automated scan. Move it only when a new review is done. */
export const ACCESSIBILITY_REVIEWED = '2026-09-22';
/**
 * Known accessibility gaps as of ACCESSIBILITY_REVIEWED, from a self-review of web/styles.css, web/contribute.css,
 * pages.ts and the app, and an automated contrast and target-size scan of the main pages in light and dark themes, plus
 * what was added since without a review. Update as they are fixed.
 */
export const ACCESSIBILITY_GAPS: readonly string[] = [
 'The form for adding an employer and the short proof-of-work wait before a code is sent, added on September 23, 2026, have not been through our self-review or automated scan yet. On a slow device the wait can take several seconds.',
 'Some checkboxes are 18 to 20 pixels square, smaller than the 24 by 24 pixel target size; their text labels can be clicked instead.',
 'We have not yet checked that every chart, beyond the trend charts, has a text description or an equivalent table of its values.',
 'The evidence canvas needs JavaScript. The policy and trust pages do not.',
 'We have not yet tested the site with screen readers such as VoiceOver, NVDA and JAWS, or with voice control.',
 'Our automated contrast check does not cover text over images or inside charts.',
];

export function accessibilityStatement(): LegalDocument {
 return {
  slug: 'accessibility',
  title: 'Accessibility statement',
  lede: `Everyone should be able to read the evidence and contribute safely. This statement says where ${BRAND} stands today, including what does not work well yet.`,
  sections: [
   {id: 'target', heading: 'Our target', blocks: [
    P(`We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA across ${BRAND}. The site does not fully meet that target yet: it is partially conformant, and the known gaps are listed below.`),
   ]},
   {id: 'in-place', heading: 'What is in place', blocks: [UL(
    'Pages declare their language, and every page has a skip link to the main content.',
    'Links, buttons and form fields show a visible keyboard focus outline, and in Windows High Contrast mode the question box and open chips draw one too.',
    'An automated check of the main pages, in light and dark themes, found no text below the 4.5:1 contrast minimum. The smallest text is 13 pixels, and form field borders meet the 3:1 minimum for controls.',
    'Animations and smooth scrolling are turned off when your system asks for reduced motion.',
    'Trend charts carry text descriptions of the values they show.',
    'The policy and trust pages, including this one, work without JavaScript, and their tables mark column and row headers.',
    `The only short time limit is on verification codes. They expire after ${CODE_FACTS.codeMinutes} minutes for security, and you can request a new one, up to ${words(CODE_FACTS.codeEmailsPerWindow)} in ${CODE_FACTS.codeMinutes} minutes.`,
   )]},
   {id: 'known-gaps', heading: 'Known gaps', blocks: [UL(...ACCESSIBILITY_GAPS), P('We are working on these. This list changes when they are fixed.')]},
   {id: 'feedback', heading: 'Report a problem', blocks: [
    P(`If something is hard to use, email ${mail(CONTACT.legal)} or call ${OPERATOR_PHONE}, and tell us the page and what happened. If you need information from the site in another format, ask and we will provide it where we can. Contacting us is not anonymous, so do not include a draft or a withdrawal capability.`),
    P(`${BRAND} is operated by ${OPERATOR_DESCRIPTION}.`),
   ]},
   {id: 'about', heading: 'About this statement', blocks: [
    P(`Prepared by self-assessment; the last review was on ${longDate(ACCESSIBILITY_REVIEWED)}. It has not been independently audited. We will update it as gaps are fixed.`),
   ]},
  ],
 };
}

const ESCAPES: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ESCAPES[c]!);
/** Only site paths, in-page anchors, mailto: and https:// links are rendered as links. */
const LINK = /\[([^\]]+)\]\(((?:\/|#|mailto:|https:\/\/)[^)\s]*)\)/g;
/** Escapes the text first, then turns the two inline markers into elements. */
export function inlineHtml(text: string) {
 return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(LINK, (_m, label: string, href: string) => `<a href="${href}">${label}</a>`);
}

function blockHtml(block: LegalBlock): string {
 if ('p' in block) return `<p>${inlineHtml(block.p)}</p>`;
 if ('note' in block) return `<p class="notice">${inlineHtml(block.note)}</p>`;
 if ('h3' in block) return `<h3>${escapeHtml(block.h3)}</h3>`;
 if ('ul' in block) return `<ul>${block.ul.map(item => `<li>${inlineHtml(item)}</li>`).join('')}</ul>`;
 const t = block.table;
 const row = (cells: string[]) => cells.map((c, i) => i === 0 ? `<th scope="row">${inlineHtml(c)}</th>` : `<td>${inlineHtml(c)}</td>`).join('');
 return `<div class="ledger-scroll"><table class="ledger"><caption>${escapeHtml(t.caption)}</caption><thead><tr>${t.head.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr>${row(r)}</tr>`).join('')}</tbody></table></div>`;
}

/**
 * The visible notice every live legal page carries until counsel has reviewed this LEGAL_VERSION (LEGAL_REVIEWED in
 * shared/brand.ts). It says what the text is, not that it is wrong: the pages describe the running system.
 */
export const LEGAL_DRAFT_NOTICE = '**Draft — pending attorney review.** Counsel has not yet reviewed this text, and it is not legal advice. It describes how the service works today; a reviewed version will carry a new version number and effective date.';
/** Trust-document HTML fragment: goes inside pages.ts's <main class="page trust-document"> frame. */
export function renderLegalHtml(doc: LegalDocument): string {
 const meta = `<p class="small-note">Version ${escapeHtml(LEGAL_VERSION)}, effective <time datetime="${escapeHtml(LEGAL_EFFECTIVE)}">${longDate(LEGAL_EFFECTIVE)}</time>.</p>`;
 const draft = LEGAL_REVIEWED ? '' : `<p class="notice legal-draft" role="note">${inlineHtml(LEGAL_DRAFT_NOTICE)}</p>`;
 const contents = `<nav class="legal-contents" aria-label="On this page"><ol>${doc.sections.map(s => `<li><a href="#${s.id}">${escapeHtml(s.heading)}</a></li>`).join('')}</ol></nav>`;
 const sections = doc.sections.map(s => `<h2 id="${s.id}">${escapeHtml(s.heading)}</h2>${s.blocks.map(blockHtml).join('')}`).join('');
 return `<h1>${escapeHtml(doc.title)}</h1>${draft}<p class="lede">${inlineHtml(doc.lede)}</p>${meta}${contents}${sections}`;
}

export const privacyPolicyHtml = (config: LegalConfig) => renderLegalHtml(privacyPolicy(config));
export const termsHtml = (config: LegalConfig) => renderLegalHtml(termsOfUse(config));
export const accessibilityHtml = () => renderLegalHtml(accessibilityStatement());

/**
 * "How to send a legal request" on /legal-requests (pages.ts), which the challenge dialog points to for a legal notice:
 * the legal@ address, the postal address and links to the terms and the privacy policy. It uses the terms' own sentence
 * for where notices go and the same challenge switch, so the page and the terms cannot disagree, and it keeps the
 * operator constants in this module.
 */
export function legalRequestsContact(config: LegalConfig): LegalSection {
 const {challenges} = switches(config);
 return {id: 'send', heading: 'How to send a legal request', blocks: [
  P(sendLegalNotices()),
  P('What a notice about content should include, and how we handle notices, court orders and subpoenas, is set out in the terms of use under [Legal notices and court orders](/terms#legal-notices). What we hold, and so what we could be required to disclose, is set out in the privacy policy under [Legal requests and disclosure](/privacy#legal-requests).'),
  UL(
   `Copyright notices go to ${mail(CONTACT.dmca)}; see [Copyright complaints (DMCA)](/terms#copyright).`,
   `Requests about your own personal data, or about a contribution that describes you, go to ${mail(CONTACT.privacy)}; see [Your choices and rights](/privacy#your-rights) and [If you are described in a contribution](/privacy#described).`,
   `Requests to correct an employer listing (a wrong organization, a domain that is not the employer’s, a duplicate, or a name that breaks the content rules) go to ${mail(CONTACT.legal)}; a person reviews each one, and every correction is logged publicly. See [Employers added by the community](/terms#community-listings).`,
   challenges
    ? 'A report that an account breaks a rule in our moderation policy, and not the law, is not a legal request: it is decided by a challenge under the published rules; see [Challenging a contribution](/terms#challenges).'
    : `The in-product challenge process is not open. Until it is, send a report that an account breaks a rule in our moderation policy, and not the law, to ${mail(CONTACT.legal)}, as described under [Challenging a contribution](/terms#challenges).`,
  ),
  P('Email and post are not anonymous. Give the public link to a contribution, never a withdrawal capability.'),
 ]};
}
/** legalRequestsContact() as a trust-document HTML fragment (an h2 section). */
export function legalRequestsContactHtml(config: LegalConfig): string {
 const section = legalRequestsContact(config);
 return `<h2 id="${section.id}">${escapeHtml(section.heading)}</h2>${section.blocks.map(blockHtml).join('')}`;
}

const absolute = (text: string) => text.replace(LINK, (_m, label: string, href: string) => `[${label}](${href.startsWith('/') ? CANONICAL_ORIGIN + href : href})`);
const cell = (text: string) => absolute(text).replace(/\|/g, '\\|');
function blockMarkdown(block: LegalBlock): string {
 if ('p' in block) return absolute(block.p);
 if ('note' in block) return `> ${absolute(block.note)}`;
 if ('h3' in block) return `### ${block.h3}`;
 if ('ul' in block) return block.ul.map(item => `- ${absolute(item)}`).join('\n');
 const t = block.table;
 return [`*${t.caption}*`, '', `| ${t.head.map(cell).join(' | ')} |`, `| ${t.head.map(() => '---').join(' | ')} |`, ...t.rows.map(r => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

/** Markdown review copy of a document, with the attorney-review header note and the open items. */
export function renderLegalMarkdown(doc: LegalDocument, config?: LegalConfig): string {
 const s = config ? switches(config) : null;
 const state = config && s ? [
  `real-employer publication ${config.realPublicationEnabled ? `enabled, with written accounts in batches of at least ${s.batch}` : 'paused'}`,
  `real-employer juries ${s.jury ? 'active (a jury forms when enough jurors can serve)' : s.juryPending ? 'switched on but unable to form' : 'not active'}`,
  `fictional sample employers ${s.samples ? 'shown' : 'not shown'}`,
  `practice juries for fictional employers ${s.sandbox ? 'available' : 'not available'}`,
  `adding employers ${s.community ? 'open to anyone' : 'closed'}`,
  `in-product challenges ${s.challenges ? 'open' : 'not open'}`,
  `trustee exceptions ${s.trustees ? 'active' : 'not active'}`,
  `crisis card ${config.crisisCardEnabled ? 'shown' : 'not shown'}`,
  `publisher rate-limit hash ${config.rateLimitKeyed ? 'keyed' : 'not assumed to be keyed'}`,
  `server crisis resources ${s.serverCrisis ? 'on' : 'off'}`,
  `self-harm screening question ${s.selfHarm ? 'on' : 'off'}`,
 ] : null;
 const open = config ? legalOpenItems(config) : [];
 const drafts = LEGAL_CHANGELOG.filter(c => c.draft);
 const flag = (item: LegalOpenItem) => item.blocksLaunch ? '**Launch blocker.** ' : item.euUk ? '**EU, EEA and UK.** ' : '';
 const header = [
  '<!-- Generated from worker/src/legal.ts. Make agreed changes there and regenerate; the live page renders the same source. -->',
  '',
  LEGAL_REVIEWED ? `> This is the review copy of the live page. Version ${LEGAL_VERSION} is recorded as approved by counsel (LEGAL_REVIEWED_VERSION in shared/brand.ts, set on the owner’s statement), so the live page carries no draft notice.` : '> **Draft — pending attorney review.** This text has not yet been reviewed by counsel and is not legal advice. It is the review copy of the live page, which shows the same notice.',
  ...(state ? ['>', `> Rendered for the current configuration: ${state.join('; ')}. Passages that change with these switches are selected in \`worker/src/legal.ts\`.`] : []),
  ...(open.length ? ['>', `> Open items (owner facts in \`shared/brand.ts\`). ${open.some(item => item.blocksLaunch) ? 'Items marked “Launch blocker” must be resolved before this version of the pages is served. ' : ''}The owner decided on September 22, 2026 that the model provider’s facts, the DMCA registration and the EU, EEA and UK items do not block launch. The pages never present an open item as resolved.`, ...open.map(item => `> - ${flag(item)}${item.detail}`)] : []),
  ...(drafts.length ? ['>', `> Review drafts that were never published, and are not listed in the public version history: ${drafts.map(c => `${c.version} (${c.summary})`).join('; ')}`] : []),
  '',
 ];
 const body = [
  `# ${doc.title}`, '', absolute(doc.lede), '', `Version ${LEGAL_VERSION}, effective ${longDate(LEGAL_EFFECTIVE)}.`,
  ...doc.sections.flatMap(s => ['', `## ${s.heading}`, ...s.blocks.flatMap(b => ['', blockMarkdown(b)])]),
 ];
 return `${[...header, ...body].join('\n')}\n`;
}

/** Every Markdown review copy, for regenerating docs/legal/*.md or checking they match the live source. */
export function legalMarkdownFiles(config: LegalConfig): {path: string; content: string}[] {
 return [
  {path: LEGAL_PAGES.privacy.markdown, content: renderLegalMarkdown(privacyPolicy(config), config)},
  {path: LEGAL_PAGES.terms.markdown, content: renderLegalMarkdown(termsOfUse(config), config)},
  {path: LEGAL_PAGES.accessibility.markdown, content: renderLegalMarkdown(accessibilityStatement())},
 ];
}
