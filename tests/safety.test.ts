/**
 * Trust and safety text: the on-device crisis-language detector, and the legal pages rendered from worker/src/legal.ts.
 *
 * Crisis detector: shows resources for real crisis phrases, stays quiet on workplace idioms, and cannot store or send
 * anything. Legal pages: the Markdown review copies match the live source, every number and switch comes from code,
 * and passages about features that are not wired or not active are not shown.
 *
 * Run with: node --test tests/safety.test.ts
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

import {detectCrisis, crisisResourcesFor, crisisCopyFor, CRISIS_RESOURCES, CRISIS_COPY, CRISIS_CARD_ENABLED} from '../shared/safety.ts';
import {
 legalConfig, reviewConfig, legalMarkdownFiles, legalOpenItems, legalLaunchBlockers, privacyPolicyHtml, termsHtml, accessibilityHtml,
 legalRequestsContactHtml, CODE_FACTS, REVIEW_ENV, REVIEW_SECRETS, LEGAL_NOTICE, LEGAL_DRAFT_NOTICE, longDate, sampleEmployersOn, testimonyBatchSize, communityListingsOpen, type LegalConfig,
} from '../worker/src/legal.ts';
import {jurorProtocolAvailable} from '../worker/src/credentials.ts';
import {policy, ownEmployerExcluded, seatsPerEmployer} from '../shared/policy.ts';
import {parseTrustees} from '../shared/trustees.ts';
import {eligibility} from '../worker/src/submissions.ts';
import {
 CONTACT_MAIL, DMCA_AGENT, MODEL_PROVIDER, OPERATOR_DESCRIPTION, OPERATOR_PHONE, TELEPHONE_PROVIDER, SERVES_EU_UK, EU_REPRESENTATIVE,
 UK_REPRESENTATIVE, DSA_LEGAL_REPRESENTATIVE, COMPLIANCE_ASSESSMENTS, THIRD_PARTY_SENSITIVE_DATA_BASIS, SUPPORT_CHECKS_SENSITIVE_DATA_BASIS,
 LEGAL_VERSION, LEGAL_CHANGELOG, LEGAL_REVIEWED, LEGAL_REVIEWED_VERSION, LEGAL_EFFECTIVE, LEGAL_FIRST_SERVED, MINIMUM_AGE, CONTACT, OPERATOR_POSTAL_ADDRESS, type Representative,
} from '../shared/brand.ts';
import {samplesEnabled, testimonyBatchMin} from '../worker/src/flags.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');

// ---------------------------------------------------------------------------------------------------------------
// Crisis-language detector
// ---------------------------------------------------------------------------------------------------------------

const selfHarm = [
 'Some days I want to kill myself before standup.',
 'I have been thinking about suicide since the layoffs.',
 'I feel suicidal most mornings.',
 'I want to end my life.',
 'Honestly I just want to die.',
 'I wanted to die after that review.',
 'I know that I want to die.',
 'I’ve started cutting myself again.',
 'I thought about hurting myself last week.',
 'I have been self-harming since the reorg.',
 'Everyone would be better off dead without me, I’m better off dead.',
 'Everyone would be better off without me.',
 'I don’t want to be alive anymore.',
 'There is no reason to live.',
 'This life isn’t worth living.',
 'I am thinking about taking an overdose.',
 'I tried to overdose.',
 'I overdosed after the layoff.',
 'I want to end it all.',
 'I tried to kill myself last year.',
 'I nearly took my life last year.',
 'I want to kill myself for what I did.',
 'I want to kill myself every day.',
 'I kill myself every night in my head.',
 'I want to kill myself before I start working.',
 'I wish I could die.',
 'I hope I die in my sleep.',
 'I hope I don’t wake up tomorrow.',
 'I want to be dead.',
 'I will jump in front of a train.',
 'I cannot go on anymore.',
 'Me quiero morir.',
 'Me quiero suicidar.',
 'Creo que me voy a matar.',
];
const aboutSomeoneElse = [
 'My coworker threatened to kill himself.',
 'My coworker said he wants to kill himself.',
 'She talked about hurting herself after the layoff.',
 'He tried to take his own life last year.',
];
const danger = [
 'I’m going to kill my manager.',
 'I’ll shoot them all tomorrow.',
 'I am going to hurt someone if this continues.',
 'He threatened to kill me in the parking lot.',
 'He threatened to shoot me.',
 'My supervisor told me he would hurt me if I reported it.',
 'Someone brought a gun to the office yesterday.',
 'A coworker pulled a knife during the shift change.',
 'He said he would shoot up the office.',
];
const workplace = [
 'The sales team is killing it this quarter.',
 'This deadline is killing me.',
 'The layoffs killed morale.',
 'Leadership decided to kill the project.',
 'Shoot me an email if you have questions.',
 'I’ll shoot him an email tomorrow.',
 'I will shoot them a quick message about the rota.',
 'I will shoot you a meeting invite.',
 'I’ll shoot everyone a quick recap.',
 'I will shoot everyone an update.',
 'I’m going to shoot them the deck tonight.',
 'I will shoot them all a note.',
 'He said he would shoot me an email.',
 'My manager is going to kill me if I miss this.',
 'I’m going to kill him with kindness at the offsite.',
 'I plan to attack my manager’s proposal in the review.',
 'Speaking up in that meeting was career suicide.',
 'Shipping that release felt like a suicide mission.',
 'We had suicide prevention training during onboarding.',
 'I’ve been killing myself for this company for three years.',
 'I was killing myself trying to hit quota.',
 'I kill myself every quarter to hit quota.',
 'I’m killing myself at this job.',
 'The team is killing themselves to hit the deadline.',
 'I shot myself in the foot when I volunteered; I really did shoot myself in the foot.',
 'Let’s kill two birds with one stone and kill time before the killer feature demo.',
 'Adding a kill switch was overkill; just kill -9 the process.',
 'I want to die on this hill about code review.',
 'I wanted to die of embarrassment when my slides crashed.',
 'I just want to die inside when the CEO talks.',
 'I don’t want to die at this desk, so I am leaving.',
 'I don’t want to live in Dallas.',
 'I cut myself off from the team chat after hours.',
 'I kept hurting myself lifting boxes and they denied workers comp.',
 'He hurt himself on the line and they denied comp.',
 'I finally took my life back by quitting.',
 'The stock crash took my life savings.',
 'The stock crash took my life’s savings.',
 'Morale is dead and the job is a dead end with impossible deadlines.',
 'I don’t want to wake up at 5am for this commute.',
 'I hope I don’t wake up late for the 5am meeting.',
 'I can’t go on anymore with these hours.',
 'They’d be better off without me on the project.',
 'I overdosed on coffee before the demo.',
 'The 988 Suicide & Crisis Lifeline number is on the break room wall.',
 // Healthcare and care work: other people's wishes are not the writer's crisis.
 'I had a patient who wanted to die at home.',
 'I see people who want to die with dignity.',
 // Spanish effort and embarrassment idioms.
 'Tengo que matarme trabajando.',
 'Me voy a matar trabajando este mes.',
 'Me quiero morir de vergüenza.',
 'No quiero vivir en Dallas.',
];
/**
 * Self-harm statements show the card even inside a comparison, whatever follows "than" (Q3: a false negative costs far
 * more than a false positive). That includes a method named in "rather … than".
 */
const explicitComparatives = [
 'I’d rather kill myself than sit through another all-hands.',
 'I’d rather be dead than work here.',
 'I would sooner kill myself than go back to that team.',
 'I’d rather be dead, than spend another year on call.',
 'Honestly I’d rather hang myself than work for him again.',
 'I’d rather jump off a bridge than live like this.',
 'I’d rather jump in front of a train than keep living.',
 'honestly I’d rather jump off a bridge than go on',
 'I would sooner jump off the roof than go back to that office.',
 'I’d rather jump off a bridge than sit through another all-hands.',
 'I would sooner jump in front of a train than work there again.',
 'I’d sooner just jump off the roof than redo that deck.',
];

test('crisis phrases about self-harm are detected as self_harm', () => {
 for (const text of selfHarm) {
  const found = detectCrisis(text);
  assert.equal(found?.kind, 'self_harm', text);
  assert.equal(found?.about, undefined, text);
 }
});

test('self-harm language about someone else is detected and marked, with its own copy', () => {
 for (const text of aboutSomeoneElse) {
  const found = detectCrisis(text);
  assert.equal(found?.kind, 'self_harm', text);
  assert.equal(found?.about, 'someone_else', text);
  assert.equal(crisisCopyFor(found!), CRISIS_COPY.someone_else);
 }
 assert.equal(crisisCopyFor(detectCrisis('I want to end my life.')!), CRISIS_COPY.self_harm);
 assert.equal(crisisCopyFor(detectCrisis('I’m going to kill my manager.')!), CRISIS_COPY.danger);
});

test('imminent danger to others, or to the writer from others, is detected as danger', () => {
 for (const text of danger) assert.equal(detectCrisis(text)?.kind, 'danger', text);
});

test('workplace, care-work and Spanish idioms do not trigger the crisis card', () => {
 for (const text of workplace) assert.equal(detectCrisis(text), null, text);
});

test('explicit self-harm statements show the card even inside "rather … than"', () => {
 for (const text of explicitComparatives) {
  const found = detectCrisis(text);
  assert.equal(found?.kind, 'self_harm', text);
  assert.equal(found?.about, undefined, text);
  assert.ok(text.includes(found!.excerpt), text);
 }
 assert.equal(detectCrisis('I’d rather kill myself than go to standup.')?.excerpt, 'kill myself');
 assert.equal(detectCrisis('I’d rather be dead than work here.')?.excerpt, 'rather be dead');
 assert.equal(detectCrisis('I’d rather jump off a bridge than live like this.')?.excerpt, 'jump off a bridge');
 assert.equal(detectCrisis('I would sooner jump in front of a train than keep living.')?.excerpt, 'jump in front of a train');
 // The same methods stated plainly show the card too.
 for (const text of ['I want to jump off a bridge.', 'I will jump in front of a train.', 'I keep thinking I should jump off the roof.']) assert.equal(detectCrisis(text)?.kind, 'self_harm', text);
});

test('the earliest self-harm phrase is reported, and workplace idioms stay quiet inside a comparison', () => {
 assert.equal(detectCrisis('I’d rather jump off a bridge than go to standup. Honestly I want to kill myself.')?.excerpt, 'jump off a bridge');
 assert.equal(detectCrisis('I’d rather go back to the office than kill myself over this.')?.excerpt, 'kill myself');
 // Workplace idioms stay quiet inside a comparison too.
 for (const text of ['I’d rather kill the project than ship it like this.', 'I’d rather be killing it at a startup than stuck here.', 'I would sooner kill myself working for a company that pays fairly than stay.']) assert.equal(detectCrisis(text), null, text);
});

test('empty and non-crisis text returns null', () => {
 assert.equal(detectCrisis(''), null);
 assert.equal(detectCrisis('   '), null);
 assert.equal(detectCrisis('Promotions are slow but my manager is fair.'), null);
 assert.equal(detectCrisis(undefined as unknown as string), null);
});

test('danger is reported before self-harm when both appear', () => {
 assert.equal(detectCrisis('I will kill myself, and I am going to kill him first.')?.kind, 'danger');
});

test('the excerpt is the matched phrase exactly as typed, curly apostrophes included', () => {
 const text = 'Most days I don’t want to be alive anymore, honestly.';
 const found = detectCrisis(text);
 assert.equal(found?.excerpt, 'don’t want to be alive anymore');
 assert.ok(text.includes(found!.excerpt));
 assert.ok(detectCrisis(`I want to kill myself ${'x'.repeat(500)}`)!.excerpt.length <= 120);
});

test('detection is deterministic and stateless across calls', () => {
 const text = 'I thought about suicide during the reorg.';
 assert.deepEqual(detectCrisis(text), detectCrisis(text));
 assert.deepEqual(detectCrisis(text), {kind: 'self_harm', excerpt: 'suicide'});
 // Global regular expressions must not carry lastIndex between calls.
 for (let i = 0; i < 3; i++) assert.equal(detectCrisis('Honestly I just want to die.')?.kind, 'self_harm');
});

test('the detector cannot store, send or log anything', () => {
 const source = read('shared/safety.ts');
 assert.doesNotMatch(source, /^\s*import\s/m, 'no imports');
 for (const api of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'console.', 'postMessage'])
  assert.ok(!source.includes(api), `safety.ts must not use ${api}`);
});

test('resources: 988 call, text and chat in the US, findahelpline.com elsewhere, emergency numbers labeled by region', () => {
 const lifeline = CRISIS_RESOURCES['988'];
 assert.match(lifeline.detail, /Call or text 988/);
 assert.deepEqual(lifeline.links.map(l => l.href), ['tel:988', 'sms:988', 'https://988lifeline.org']);
 assert.equal(CRISIS_RESOURCES.findahelpline.links[0]?.href, 'https://findahelpline.com');
 const emergency = CRISIS_RESOURCES.emergency;
 assert.match(emergency.detail, /local emergency number/);
 assert.deepEqual(emergency.links.map(l => l.href), ['tel:911', 'tel:112']);
 for (const link of emergency.links) assert.match(link.label, /\(.+\)/, 'each emergency number names where it works');
 assert.deepEqual(crisisResourcesFor('danger').map(r => r.id), ['emergency', '988', 'findahelpline']);
 assert.deepEqual(crisisResourcesFor('self_harm').map(r => r.id), ['988', 'findahelpline', 'emergency']);
 for (const resource of Object.values(CRISIS_RESOURCES)) for (const link of resource.links) assert.match(link.href, /^(?:tel:|sms:|https:\/\/)/);
 assert.match(CRISIS_COPY.privacy, /only on this device/);
 assert.match(CRISIS_COPY.privacy, /Nothing about it is stored, sent or reported/);
 // Resources carried by a server reply use their own line: that text did reach the server.
 assert.doesNotMatch(CRISIS_COPY.serverPrivacy, /on this device|not sent|nothing .* sent/i);
 assert.match(CRISIS_COPY.serverPrivacy, /sent to our server/);
 assert.match(CRISIS_COPY.serverPrivacy, /do not store, log or report/);
 assert.ok(CRISIS_COPY.server.heading && CRISIS_COPY.server.body);
});

test('server-side crisis resources come from the same lexicon and are never stored, logged or used as a signal', () => {
 const app = read('worker/src/app.ts'), inference = read('worker/inference-core.ts');
 // The publisher's check is the shared lexicon, keyed on CRISIS_RESOURCES_ENABLED, and its reply carries only CRISIS_RESOURCES.
 assert.match(app, /CRISIS_RESOURCES_ENABLED\s*===\s*'true'/);
 assert.match(app, /detectCrisis\(/);
 assert.match(app, /resources:\s*CRISIS_RESOURCES/);
 // Jev's self-harm question is asked only when SELF_HARM_SCREENING is 'true'; its answer never becomes a policy signal,
 // because the signals are exactly the policy's risk questions.
 assert.match(inference, /SELF_HARM_SCREENING\s*===\s*'true'/);
 assert.match(inference, /Object\.keys\(riskQuestions\)\.map/);
});

// ---------------------------------------------------------------------------------------------------------------
// Legal pages (worker/src/legal.ts). Kept here because this round may create only this test file; they can move to
// tests/legal.test.ts unchanged.
// ---------------------------------------------------------------------------------------------------------------

function files(dir: string, out: string[] = []): string[] {
 for (const name of readdirSync(join(root, dir))) {
  const path = join(dir, name);
  if (name === 'node_modules' || name === 'generated') continue;
  if (statSync(join(root, path)).isDirectory()) files(path, out);
  else if (/\.(?:ts|tsx|mjs|js)$/.test(name)) out.push(path);
 }
 return out;
}
const webImportsSafety = () => files('web').some(path => /from\s+['"][./]*shared\/safety(?:\.ts)?['"]/.test(read(path)));
const jsonc = (path: string) => JSON.parse(read(path).replace(/^\s*\/\/.*$/gm, '')) as Record<string, any>;
/**
 * Every combination of the twelve switches (4096 configurations): the nine of round 3, plus whether fictional employers
 * are shown, whether real-employer juries are switched on while none can form, and whether anyone can add an employer.
 * Written accounts publish in batches of 5 in half of them (the production value) and 25 in the other half.
 */
const allConfigs = (): LegalConfig[] => Array.from({length: 4096}, (_, bits) => ({
 realPublicationEnabled: !!(bits & 1), juryEnabled: !!(bits & 2), trusteesEnabled: !!(bits & 4), crisisCardEnabled: !!(bits & 8), rateLimitKeyed: !!(bits & 16),
 practiceJuriesEnabled: !!(bits & 32), challengesEnabled: !!(bits & 64), serverCrisisResources: !!(bits & 128), selfHarmScreening: !!(bits & 256),
 sampleEmployers: !!(bits & 512), juryConfigured: !!(bits & 2) || !!(bits & 1024), communityListings: !!(bits & 2048), testimonyBatch: bits & 1 ? 5 : 25,
}));
/**
 * The switches as legal.ts applies them: practice juries need fictional employers (sandbox); a real-employer jury implies
 * the juror token texts (practice); a jury switched on that cannot form is pending; challenges default to open.
 */
const on = (config: LegalConfig) => {
 const samples = config.sampleEmployers !== false, sandbox = samples && config.practiceJuriesEnabled === true;
 return {jury: config.juryEnabled, juryPending: !config.juryEnabled && config.juryConfigured === true, samples, sandbox, practice: config.juryEnabled || sandbox, challenges: config.challengesEnabled !== false, trustees: config.trusteesEnabled === true, serverCrisis: config.serverCrisisResources === true, selfHarm: config.selfHarmScreening === true, community: config.communityListings !== false && config.rateLimitKeyed === true};
};
/** The text of one h2 section of a rendered page, up to the next h2 (a hoisted declaration, usable by every test). */
function h2Section(html: string, id: string) {
 const start = html.indexOf(`<h2 id="${id}">`);
 if (start < 0) return '';
 const end = html.indexOf('<h2 ', start + 1);
 return html.slice(start, end < 0 ? undefined : end);
}
/** A string array literal in a source file, e.g. `export const SPA_PATHS=['/submit',...]`. */
const sourceArray = (source: string, name: string) => {
 const body = new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source)?.[1];
 assert.ok(body, `${name} not found`);
 return [...body.matchAll(/'([^']+)'/g)].map(m => m[1]!);
};

test('legal: docs/legal/*.md match what worker/src/legal.ts renders for the review configuration', () => {
 for (const file of legalMarkdownFiles(reviewConfig())) assert.equal(read(file.path), file.content, `${file.path} is stale: regenerate it from worker/src/legal.ts`);
});

test('legal: the review configuration matches wrangler.jsonc and inference.wrangler.jsonc', () => {
 const wrangler = jsonc('wrangler.jsonc'), inference = jsonc('inference.wrangler.jsonc'), config = reviewConfig();
 const vars: Record<string, string> = wrangler.vars ?? {};
 for (const [name, value] of Object.entries(REVIEW_ENV)) if (name !== 'RATE_LIMIT_SECRET') assert.equal(value, vars[name], `REVIEW_ENV.${name} must match wrangler.jsonc vars`);
 for (const name of ['REAL_PUBLICATION_ENABLED', 'JURY_ENABLED', 'CRISIS_RESOURCES_ENABLED', 'SAMPLE_EMPLOYERS', 'TESTIMONY_BATCH_MIN']) assert.equal((REVIEW_ENV as Record<string, string | undefined>)[name], vars[name], `wrangler.jsonc vars.${name} must be mirrored in REVIEW_ENV`);
 assert.equal(config.realPublicationEnabled, vars.REAL_PUBLICATION_ENABLED === 'true');
 // Launch decisions (2026-09-23): production shows no fictional employers, publishes written accounts in batches of 5,
 // and publishes real-employer accounts.
 assert.equal(vars.SAMPLE_EMPLOYERS, 'off', 'production shows no fictional employers');
 assert.equal(config.sampleEmployers, false);
 assert.equal(config.practiceJuriesEnabled, false, 'no practice juries without fictional employers');
 assert.equal(config.testimonyBatch, testimonyBatchMin(vars), 'the batch the legal pages state is the one publication uses');
 assert.equal(config.testimonyBatch, 5);
 assert.equal(config.realPublicationEnabled, true);
 // Listing employers needs the VERIFIER and INFERENCE service bindings, which reviewConfig() assumes, and the secrets above.
 for (const binding of ['VERIFIER', 'INFERENCE']) assert.ok((wrangler.services ?? []).some((s: {binding?: string}) => s.binding === binding), `wrangler.jsonc binds ${binding}`);
 assert.equal(config.communityListings, true);
 assert.equal(config.juryEnabled, jurorProtocolAvailable() && vars.JURY_ENABLED === 'true', 'real-employer juries follow JURY_ENABLED');
 assert.equal(config.serverCrisisResources, vars.CRISIS_RESOURCES_ENABLED === 'true', 'server crisis resources follow CRISIS_RESOURCES_ENABLED');
 assert.equal(config.selfHarmScreening, inference.vars?.SELF_HARM_SCREENING === 'true', 'CODE_FACTS.selfHarmScreening mirrors inference.wrangler.jsonc');
 // Secrets are assumed only where docs/operations.md marks them required in production for the main worker (and
 // wrangler.jsonc secrets.required, where it lists any, agrees).
 const operations = read('docs/operations.md');
 const requiredMain = [...operations.matchAll(/^\| Main \| `([A-Z_]+)` \| Required \|/gm)].map(m => m[1]!).sort();
 const wranglerRequired: string[] = wrangler.secrets?.required ?? [];
 for (const name of wranglerRequired) assert.ok(requiredMain.includes(name), `wrangler.jsonc requires ${name}; docs/operations.md must mark it required too`);
 for (const name of Object.keys(REVIEW_SECRETS)) assert.ok(requiredMain.includes(name), `REVIEW_SECRETS assumes ${name}, which docs/operations.md must mark required for the main worker`);
 assert.equal(config.rateLimitKeyed, requiredMain.includes('RATE_LIMIT_SECRET'), 'rateLimitKeyed may be assumed only when RATE_LIMIT_SECRET is a required secret');
 assert.ok(!requiredMain.includes('TRUSTEE_KEYS'));
 assert.equal(config.challengesEnabled, config.rateLimitKeyed, 'challenges are open only with RATE_LIMIT_SECRET');
 assert.equal(config.trusteesEnabled, false, 'TRUSTEE_KEYS is a secret the review copy cannot assume');
});

test('legal: switches come from env and the same checks the moderation module applies', () => {
 const off = legalConfig({REAL_PUBLICATION_ENABLED: 'false'});
 assert.equal(off.juryEnabled, false, 'real-employer juries are off unless JURY_ENABLED is "true"');
 assert.equal(legalConfig({JURY_ENABLED: 'true'}).juryEnabled, jurorProtocolAvailable());
 assert.equal(off.practiceJuriesEnabled, false, 'practice juries need SAMPLE_EMPLOYERS on');
 assert.equal(legalConfig({SAMPLE_EMPLOYERS: 'on'}).practiceJuriesEnabled, jurorProtocolAvailable());
 assert.equal(legalConfig({SAMPLE_EMPLOYERS: 'off'}).practiceJuriesEnabled, false);
 // The same reading as the rest of the main worker (worker/src/flags.ts): only 'on' shows fictional employers.
 for (const value of [undefined, '', 'on', 'off', 'true', 'ON']) assert.equal(sampleEmployersOn({SAMPLE_EMPLOYERS: value}), samplesEnabled({SAMPLE_EMPLOYERS: value}), String(value));
 for (const value of [undefined, '', '1', '5', '25', '30', 'x']) assert.equal(testimonyBatchSize({TESTIMONY_BATCH_MIN: value}), testimonyBatchMin({TESTIMONY_BATCH_MIN: value}), String(value));
 assert.equal(legalConfig({JURY_ENABLED: 'true'}).juryConfigured, jurorProtocolAvailable());
 assert.equal(off.juryConfigured, false);
 // Listing follows community.ts listingOpen: the verifier binding, a full-length internal secret, inference and the rate-limit secret.
 const open = {VERIFIER: {}, INFERENCE: {}, INTERNAL_TOKEN: 'x'.repeat(32), RATE_LIMIT_SECRET: 'x'};
 assert.equal(communityListingsOpen(open), true);
 for (const missing of ['VERIFIER', 'INFERENCE', 'INTERNAL_TOKEN', 'RATE_LIMIT_SECRET'] as const) assert.equal(communityListingsOpen({...open, [missing]: undefined}), false, missing);
 assert.equal(communityListingsOpen({...open, INTERNAL_TOKEN: 'short'}), false);
 assert.equal(legalConfig(open).communityListings, true);
 assert.equal(off.communityListings, false, 'without the bindings and the secrets, listing is closed');
 assert.equal(off.challengesEnabled, false, 'challenges are closed without RATE_LIMIT_SECRET');
 assert.equal(legalConfig({RATE_LIMIT_SECRET: 'x'}).challengesEnabled, CODE_FACTS.challengesEnabled);
 assert.equal(off.serverCrisisResources, false);
 assert.equal(legalConfig({CRISIS_RESOURCES_ENABLED: 'true'}).serverCrisisResources, true);
 assert.equal(off.selfHarmScreening, CODE_FACTS.selfHarmScreening);
 assert.equal(off.trusteesEnabled, false);
 assert.equal(legalConfig({TRUSTEE_KEYS: 'not json'}).trusteesEnabled, parseTrustees('not json') !== null);
 assert.equal(off.crisisCardEnabled, CRISIS_CARD_ENABLED);
 assert.equal(off.rateLimitKeyed, false);
 assert.equal(legalConfig({REAL_PUBLICATION_ENABLED: 'true', RATE_LIMIT_SECRET: 'x'}).realPublicationEnabled, true);
 assert.equal(legalConfig({RATE_LIMIT_SECRET: 'x'}).rateLimitKeyed, true);
 assert.match(privacyPolicyHtml({...off, rateLimitKeyed: true}), /HMAC-SHA-256 with a secret key\) and the verifier/);
 assert.match(privacyPolicyHtml(off), /daily SHA-256 hash of it/);
 // The moderation module decides these the same way; if it changes, legalConfig must follow.
 const moderation = read('worker/src/moderation.ts');
 assert.match(moderation, /jurorProtocolAvailable\(\)&&\(juryClass==='sandbox'\?samplesEnabled\(env\):settings\(env\)\.JURY_ENABLED==='true'\)/, 'juryActive() still keys real-employer juries on JURY_ENABLED and sandbox juries on the protocol and SAMPLE_EMPLOYERS');
 assert.match(moderation, /parseTrustees\(settings\(env\)\.TRUSTEE_KEYS\)/, 'trustee exceptions still key on TRUSTEE_KEYS');
 assert.match(moderation, /challengesOpen=\(env:Env\)=>typeof env\.RATE_LIMIT_SECRET==='string'&&env\.RATE_LIMIT_SECRET\.length>0/, 'challenges open only with RATE_LIMIT_SECRET');
 assert.match(moderation, /challengesEnabled:challengesOpen\(env\)/, 'moderationStatus reports the same switch');
});

test('legal: /api/config gets the operator from LEGAL_NOTICE, and live legal pages carry the draft notice until counsel signs off', () => {
 assert.equal(LEGAL_NOTICE.operator, OPERATOR_DESCRIPTION);
 assert.match(read('worker/src/app.ts'), /operator:\s*LEGAL_NOTICE\.operator/);
 for (const html of [privacyPolicyHtml(reviewConfig()), termsHtml(reviewConfig()), accessibilityHtml()]) {
  assert.equal(html.includes('Draft — pending attorney review.'), !LEGAL_REVIEWED);
  if (!LEGAL_REVIEWED) assert.match(html, /^<h1>[^<]+<\/h1><p class="notice legal-draft" role="note"><strong>Draft — pending attorney review\.<\/strong>/, 'the notice sits right under the page title');
 }
 assert.match(LEGAL_DRAFT_NOTICE, /not legal advice/);
 for (const file of legalMarkdownFiles(reviewConfig())) assert.equal(file.content.includes('Draft — pending attorney review'), !LEGAL_REVIEWED, file.path);
});

test('legal: the crisis card is described only while web/ actually renders it', () => {
 const wired = webImportsSafety();
 assert.ok(!CRISIS_CARD_ENABLED || wired, 'CRISIS_CARD_ENABLED is true but nothing under web/ imports shared/safety.ts');
 const live = privacyPolicyHtml(legalConfig({}));
 assert.equal(live.includes('crisis support resources'), CRISIS_CARD_ENABLED);
 if (!wired) assert.ok(!live.includes('crisis'), 'the privacy policy mentions a crisis check that is not wired');
 assert.match(privacyPolicyHtml({...legalConfig({}), crisisCardEnabled: true}), /crisis support resources/);
});

test('legal: support resources are described exactly as they run, and their Article 9 condition is an EU and UK open item', () => {
 for (const config of allConfigs()) {
  const s = on(config), privacy = privacyPolicyHtml(config), name = JSON.stringify(config);
  assert.equal(privacy.includes('<h2 id="support-resources">'), config.crisisCardEnabled === true || s.serverCrisis || s.selfHarm, name);
  assert.equal(/<strong>On your device\.<\/strong>/.test(privacy), config.crisisCardEnabled === true, name);
  assert.equal(/<strong>On our server\.<\/strong>/.test(privacy), s.serverCrisis, name);
  assert.equal(/<strong>During screening\.<\/strong>/.test(privacy), s.selfHarm, name);
  if (s.selfHarm) assert.match(privacy, /The answer is never stored, logged or used for moderation, and it never changes the outcome/, name);
  assert.equal(/Its answer is discarded/.test(privacy), s.selfHarm && !s.serverCrisis, name);
 }
 const config = reviewConfig(), ids = legalOpenItems(config).map(item => item.id);
 assert.equal(ids.includes('support-checks-sensitive-data-basis'), SERVES_EU_UK && (config.serverCrisisResources === true || config.selfHarmScreening === true) && !SUPPORT_CHECKS_SENSITIVE_DATA_BASIS);
 assert.ok(!legalOpenItems({...config, serverCrisisResources: false, selfHarmScreening: false}).some(item => item.id === 'support-checks-sensitive-data-basis'));
});

test('legal: retention, batch and jury numbers are rendered from the moderation policy', () => {
 const html = privacyPolicyHtml({...reviewConfig(), juryEnabled: false, juryConfigured: false, sampleEmployers: true, practiceJuriesEnabled: true, challengesEnabled: true}), terms = termsHtml({...reviewConfig(), realPublicationEnabled: false, juryEnabled: false, juryConfigured: false});
 const {heldDays, approvedUnbatchedDays, aggregateRereleaseChanges, moderationRecordsQuarters} = policy.retention;
 const batch = reviewConfig().testimonyBatch, aggregate = (policy.retention as {aggregateMinimum?: number}).aggregateMinimum;
 assert.equal(aggregate, 25, 'questionnaire figures keep a minimum of 25');
 assert.match(html, new RegExp(`Erased about ${heldDays} days after it was held`));
 assert.match(html, new RegExp(`Erased about ${approvedUnbatchedDays} days after submission`));
 assert.match(html, new RegExp(`batch of at least ${batch} accepted contributions for the same ${CODE_FACTS.publicationGroup}`));
 assert.match(html, new RegExp(`for groups with at least ${aggregate} published contributions, and each figure needs at least ${aggregate} answers`));
 assert.match(html, new RegExp(`at least ${aggregateRereleaseChanges} further publications or withdrawals`));
 assert.match(html, new RegExp(`${approvedUnbatchedDays + 1} days so the same request cannot be replayed`));
 assert.match(html, new RegExp(`juries of ${policy.jury.initial} randomly selected people, with appeals to ${policy.jury.appeal} different people`));
 assert.match(html, new RegExp(`expires after ${policy.jury.assignmentHours} hours`));
 assert.match(html, new RegExp(`more than (?:${['zero', 'one', 'two', 'three', 'four', 'five', 'six'][moderationRecordsQuarters] ?? moderationRecordsQuarters}) quarters old`));
 assert.match(html, new RegExp(`up to ${policy.challenges.reasonMaxChars} characters`));
 assert.match(terms, new RegExp(`within ${approvedUnbatchedDays} days of submission`));
 assert.match(terms, new RegExp(`erased about ${heldDays} days after they were held`));
});

test('legal: numbers and behavior fixed in code outside the policy still match their source', async () => {
 const issuer = read('worker/issuer.ts');
 assert.equal(Number(/expiresInMinutes:\s*(\d+)/.exec(issuer)?.[1]), CODE_FACTS.codeMinutes);
 assert.equal(Number(/getTime\(\)\s*\+\s*(\d+)\s*\*\s*60000/.exec(issuer)?.[1]), CODE_FACTS.codeMinutes);
 // The email throttle: at most codeEmailsPerWindow unexpired requests per mailbox (one keyed hash across purposes).
 assert.equal(Number(/recent\?\.n\?\?0\)\s*(?:<|>=)\s*(\d+)/.exec(issuer)?.[1]), CODE_FACTS.codeEmailsPerWindow);
 assert.match(issuer, /throttle-v1:\$\{mailbox\}/, 'the email throttle counts one mailbox across purposes and quarters');
 // Exactly one subject line, which names the product; juror tokens and credentials keep separate quota hashes.
 assert.equal([...issuer.matchAll(/subject\s*[:=]\s*['`]/g)].length, 1, 'a second subject line would make emails distinguishable');
 assert.match(issuer, /subject\s*[:=]\s*'[^']*Should I Work There[^']*'/);
 assert.match(issuer, /'juror-v1'\s*:\s*'quota-v3'/, 'juror tokens and credentials keep separate quota hashes');
 // Q1: one email whatever the mailbox already holds; /start never reads the quotas, which are enforced only at /issue and /issue-juror.
 const start = issuer.slice(issuer.indexOf("action.action==='start'"), issuer.indexOf('return reply({challengeId'));
 assert.ok(start.length > 0, '/start block');
 assert.equal(!/issuance_quota|juror_quota|notice/.test(start) && [...issuer.matchAll(/EMAIL\.send\(/g)].length === 1, CODE_FACTS.identicalVerifierEmails, 'CODE_FACTS.identicalVerifierEmails must match worker/issuer.ts /start');
 assert.equal(Number(/ids:[^\n]*?\.max\((\d+)\)/.exec(read('worker/inference-core.ts'))?.[1]), CODE_FACTS.rankLimit);
 const main = jsonc('wrangler.jsonc'), verifier = jsonc('issuer.wrangler.jsonc');
 for (const limit of [...main.ratelimits, ...verifier.ratelimits]) assert.equal(limit.simple.period, CODE_FACTS.limiterWindowSeconds, limit.name);
 assert.deepEqual(main.triggers.crons, [`0 */${CODE_FACTS.publisherJobHours} * * *`]);
 assert.deepEqual(verifier.triggers.crons, [`*/${CODE_FACTS.verifierJobMinutes} * * * *`]);
 for (const flag of [main.observability, verifier.observability, jsonc('inference.wrangler.jsonc').observability]) assert.equal(flag?.enabled, false, 'application logging must stay off');
 const hour = 3600000, {min, max} = CODE_FACTS.publicationDelayHours;
 for (const start of [Date.UTC(2026, 8, 22, 0, 0), Date.UTC(2026, 8, 22, 5, 59), Date.UTC(2026, 8, 22, 13, 17)]) {
  for (const random of [0, 0.25, 0.5, 0.999999]) {
   const delay = Date.parse(eligibility(new Date(start), random)) - start;
   assert.ok(delay >= min * hour && delay <= max * hour, `publication delay ${delay / hour}h is outside ${min}–${max}h`);
  }
 }
 // Challenges: the route exists (open while RATE_LIMIT_SECRET is set), their stats route is public, and no reason is stored.
 const moderation = read('worker/src/moderation.ts');
 assert.equal(/case '\/api\/challenge':/.test(moderation), CODE_FACTS.challengesEnabled, 'the challenge route');
 assert.match(moderation, /'\/api\/moderation\/stats':'GET'/);
 const challengeTable = /CREATE TABLE IF NOT EXISTS challenges \(([^;]*)\);/.exec(read('db/intake-migrations/0003_moderation.sql'))?.[1];
 assert.ok(challengeTable, 'challenges table');
 assert.doesNotMatch(challengeTable!, /\breason\b/, 'the privacy policy says challenge reasons are not stored');
 // Explicit consent to sensitive information about the author is claimed only once the submission form asks for it,
 // and the server stores it only as a yes/no on the intake row, erased with the row.
 assert.equal(/sensitive information about me/i.test(read('web/submit.tsx')), CODE_FACTS.specialCategoryConsent, 'update CODE_FACTS.specialCategoryConsent to match web/submit.tsx');
 const submissions = read('worker/src/submissions.ts');
 assert.match(submissions, /sensitiveConsent:z\.boolean\(\)/);
 assert.match(/const ERASE="([^"]*)"/.exec(submissions)?.[1] ?? '', /sensitive_consent=0/, 'withdrawal and expiry erase the sensitive-information choice');
 // The 18+ confirmation is enforced by the server.
 assert.equal(/adultConfirmed:z\.literal\(true\)/.test(submissions), CODE_FACTS.adultConfirmationEnforced, 'CODE_FACTS.adultConfirmationEnforced must match submitSchema');
 // The minimal record after withdrawal or expiry is scrubbed after the policy's number of months.
 const months = (policy.retention as {erasedRecordsMonths?: number}).erasedRecordsMonths;
 if (months !== undefined) {
  assert.match(submissions, /SCRUB_MONTHS=policy\.retention\.erasedRecordsMonths/);
  assert.match(submissions, /capability_hash='scrubbed:'\|\|lower\(hex\(randomblob\(\d+\)\)\),company_id='',company_slug='',period='',publication_period=''/, 'the scrub removes the capability hash, the employer and the periods');
  assert.match(submissions, /scrubErased/);
 }
 // Screening's model-call budgets and the hourly analysis catch-up.
 const inferenceCore = read('worker/inference-core.ts');
 const budgets = /export const BUDGETS=\{([^}]*)\}/.exec(inferenceCore)?.[1] ?? '';
 assert.deepEqual(Object.fromEntries([...budgets.matchAll(/(\w+):(\d+)/g)].map(m => [m[1], Number(m[2])])), CODE_FACTS.dailyModelCalls);
 // Launch decision 6: about 100,000 model calls a day in total.
 assert.deepEqual(CODE_FACTS.dailyModelCalls, {search: 45000, live: 45000, screen: 5000, analysis: 4000, relevance: 1000});
 // Publication batches: publishDue groups approved contributions exactly as CODE_FACTS.publicationGroup says.
 const due = submissions.slice(submissions.indexOf('export async function publishDue'), submissions.indexOf('async function publishGroup'));
 const grouped = /GROUP BY ([a-z_, ]+) HAVING/.exec(due)?.[1]?.split(',').map(c => c.trim()).sort().join(',');
 const described = {'employer and verification type': 'company_id,verification_class', 'employer, reporting quarter and verification type': 'company_id,period,verification_class'}[CODE_FACTS.publicationGroup];
 assert.equal(grouped, described, 'CODE_FACTS.publicationGroup must name the GROUP BY of publishDue in worker/src/submissions.ts');
 // Proof of work (shared/pow.ts): the difficulty, window and actions the privacy policy describes.
 const pow = await import('../shared/pow.ts');
 assert.equal(pow.POW_BITS, CODE_FACTS.powBits);
 assert.equal(pow.POW_WINDOW_MINUTES, CODE_FACTS.powMinutes);
 assert.deepEqual([...pow.POW_ACTIONS].sort(), ['add-employer', 'issue-juror', 'start']);
 assert.match(read('shared/pow.ts'), /no\s+(?:\*\s+)?spent-stamp table is kept/, 'the privacy policy says proof-of-work answers are not stored');
 // Adding an employer (worker/src/app.ts, shared/domains.ts): the name limit, the plausibility threshold and the resolver.
 const community = await import('../worker/src/community.ts');
 assert.equal(new URL(community.DOH_ENDPOINT).hostname, CODE_FACTS.dnsResolver, 'the MX lookup uses the resolver the privacy policy names');
 assert.equal(community.EMPLOYER_NAME_MAX, CODE_FACTS.employerNameMaxChars, 'the employer name limit');
 assert.equal(community.PLAUSIBLE_AT, CODE_FACTS.domainPlausibility, 'the plausibility threshold');
 assert.match(read('worker/src/app.ts'), /addEmployer\(env,await body\(request\),request\)/, 'POST /api/employers is the listing route the pages describe');
 // What a listing stores: no person, address or time in employer_domains; the listing row itself is the companies row.
 assert.match(read('db/migrations/0010_community_employers.sql'), /No person, address or time is stored/);
 assert.match(read('worker/src/community.ts'), /INSERT INTO companies\(id,slug,name,kind,sector,coverage_note,origin\) VALUES\(\?,\?,\?,'real',NULL,\?,'community'\)/, 'the listing row holds only the name, slug, note and origin (and the table’s created_at)');
 assert.match(read('worker/src/community.ts'), /\\nemployers\\n\$\{await digest\(`siwt-address-v1:\$\{requestClient\(request\)\}`\)\}/, 'the listing limit’s daily record names only the purpose “employers”');
 assert.equal(Number(/BACKFILL_LIMIT=(\d+)/.exec(inferenceCore)?.[1]), CODE_FACTS.backfillPerRun);
 const inferenceConfig = jsonc('inference.wrangler.jsonc');
 assert.equal(!!inferenceConfig.vectorize, CODE_FACTS.semanticIndex, 'the retrieval step is a no-op without a VECTORIZE binding');
 assert.equal(inferenceConfig.vars?.SELF_HARM_SCREENING === 'true', CODE_FACTS.selfHarmScreening, 'CODE_FACTS.selfHarmScreening must match inference.wrangler.jsonc');
 // Daily network records: an HMAC under RATE_LIMIT_SECRET of the day, the purpose and a digest of the address, stored only
 // with the secret, and deleted after the day by the scheduled jobs.
 const app = read('worker/src/app.ts');
 assert.equal(/INSERT OR IGNORE INTO interest_seen/.test(app) && /INSERT INTO daily_budgets/.test(moderation), CODE_FACTS.dailyNetworkDigests);
 if (CODE_FACTS.dailyNetworkDigests) {
  assert.match(app, /if\(!env\.RATE_LIMIT_SECRET\)return false;/, 'no interest record without the secret');
  assert.match(app, /purgeDailyDigests/);
  assert.match(moderation, /DELETE FROM daily_budgets WHERE day<\?/);
  assert.match(read('db/intake-migrations/0004_consent_retention_budget.sql'), /CREATE TABLE IF NOT EXISTS daily_budgets/);
 }
 // Seeded fixtures cannot be withheld by a challenge or a jury (policy text and code agree).
 assert.equal(typeof (policy.challenges as {fixtures?: unknown}).fixtures === 'string', /'practice_fixture'/.test(moderation));
});

test('legal: every configuration renders clean, escaped, linked HTML with no false switch text', () => {
 const check = (name: string, html: string) => {
  assert.doesNotMatch(html, /\]\(|\*\*/, `${name}: unrendered marker`);
  for (const [, href] of html.matchAll(/href="([^"]*)"/g)) assert.match(href!, /^(?:\/|#|mailto:|https:\/\/)/, `${name}: href ${href}`);
  const ids = [...html.matchAll(/<h2 id="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, `${name}: duplicate ids`);
  for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(anchor), `${name}: dangling #${anchor}`);
  for (const tag of ['p', 'ul', 'li', 'table', 'tr', 'td', 'th', 'h2', 'h3', 'nav', 'ol', 'a', 'strong', 'div', 'caption']) {
   const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length, close = (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
   assert.equal(open, close, `${name}: unbalanced <${tag}>`);
  }
  assert.doesNotMatch(html, /<script|\son\w+=/i, `${name}: script or event handler`);
  assert.doesNotMatch(html, /undefined|\bnull\b|\bNaN\b|\[object|Delaware/, `${name}: leaked value or forbidden text`);
  assert.doesNotMatch(html.replace(/cannot guarantee anonymity/g, ''), /guarantee[sd]?\s+(?:your\s+)?anonymity|(?:100%|fully|completely|totally)\s+anonym/i, `${name}: anonymity guarantee`);
  assert.ok(html.includes(OPERATOR_DESCRIPTION), `${name}: operator not named`);
 };
 for (const config of allConfigs()) {
  const privacy = privacyPolicyHtml(config), terms = termsHtml(config), name = JSON.stringify(config), s = on(config);
  check(`privacy ${name}`, privacy);
  check(`terms ${name}`, terms);
  if (s.jury && s.trustees && s.challenges) for (const html of [privacy, terms]) assert.doesNotMatch(html, /not active|planned but|not open/, `${name}: says something is not active while everything is`);
  if (!s.jury && !s.juryPending) assert.match(privacy, /[Aa]nonymous juries of \d+ randomly selected people[^.]*are planned but not active/);
  // A real-employer jury that is switched on but cannot form is described as such, never as planned or as deciding.
  if (s.juryPending) {
   assert.match(privacy, /Anonymous juries of \d+ randomly selected people for real employers, with appeals to \d+ different people, are switched on, but one forms only when enough jurors[^,]* can serve, and none can yet/, name);
   assert.doesNotMatch(privacy + terms, /are planned but not active/, name);
  }
  if (!s.trustees) assert.match(terms, /That process is not active yet/);
  assert.equal(/Publication for real employers is paused/.test(privacy), !config.realPublicationEnabled, name);
  // Real-employer juries only when on; practice juries scoped to fictional employers; challenges never described as closed while open.
  assert.equal(/practice jur/.test(privacy + terms), s.sandbox && !s.jury, `${name}: practice juries`);
  // Zero data: without fictional employers nothing describes them, sandbox credentials, practice tokens or fixtures.
  if (!s.samples) assert.doesNotMatch(privacy + terms, /Some employers are fictional|Sandbox credentials|practice token|Practice tokens|demonstration data|fictional sample employers? (?:need|can be decided|have)/, `${name}: fictional employers described while none are shown`);
  assert.equal(/There are no fictional or sample employers on the site/.test(terms), !s.samples, `${name}: zero-data statement`);
  // Written accounts: the configured batch and grouping; questionnaire figures keep their own minimum.
  if (config.realPublicationEnabled) assert.ok(terms.includes(`only in a batch of at least ${config.testimonyBatch} accepted accounts for the same ${CODE_FACTS.publicationGroup}`), `${name}: batch in the terms`);
  assert.ok(privacy.includes(`only in a batch of at least ${config.testimonyBatch} accepted contributions for the same ${CODE_FACTS.publicationGroup}`), `${name}: batch in the privacy policy`);
  assert.equal(/A batch that small hides less than a large one/.test(privacy), (config.testimonyBatch ?? 25) < 25, `${name}: small-batch caveat`);
  // Adding employers: described as open only while it is; the correction route is always stated.
  // The version history is a record of what each version said, so it is left out of switch checks.
  const current = (html: string) => html.replace(h2Section(html, 'changes'), '');
  assert.equal(/Anyone can add an employer/.test(current(privacy) + current(terms)), s.community, `${name}: listing open`);
  assert.equal(/Adding employers is closed/.test(privacy + terms), !s.community, `${name}: listing closed`);
  assert.match(h2Section(terms, 'community-listings'), /<strong>Correcting a listing\.<\/strong>/, name);
  assert.match(h2Section(terms, 'community-listings'), /A correction changes the listing, never the words of a published account/, name);
  assert.match(h2Section(terms, 'community-listings'), /we do not endorse it/, name);
  assert.match(h2Section(privacy, 'adding-employers'), /Nothing about who added the listing is kept with it/, name);
  // Proof of work: computed on the device, and it sends nothing about the person.
  assert.match(privacy, /It is computed only on your device, and the answer adds nothing about you to the request it goes with/, name);
  assert.equal(/the in-product challenge process/.test(privacy), !s.challenges, `${name}: challenge process listed as inactive`);
  assert.equal(/The in-product challenge process is not active yet/.test(terms), !s.challenges, `${name}: terms challenges`);
  // The status page, not the contribution page, is where a capability is used.
  assert.doesNotMatch(privacy + terms, /href="\/submit"/, `${name}: capability flows live on /status`);
 }
 check('accessibility', accessibilityHtml());
 assert.match(privacyPolicyHtml(reviewConfig()), /<tr><th scope="row">/, 'table rows carry row headers');
});

test('legal: every site path a legal page links to is served by the worker', () => {
 const index = read('worker/src/app.ts'), moderation = read('worker/src/moderation.ts');
 const served = new Set(['/', ...sourceArray(index, 'SPA_PATHS'), ...sourceArray(index, 'TRUST_PAGES').map(page => `/${page}`)]);
 if (index.includes("path==='/moderation/current.json'")) served.add('/moderation/current.json');
 for (const [route] of moderation.matchAll(/'\/api\/moderation\/[a-z]+'(?=:'GET')/g)) served.add(route.slice(1, -1));
 for (const config of allConfigs()) {
  for (const html of [privacyPolicyHtml(config), termsHtml(config)]) {
   for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) assert.ok(served.has(href!.split('#')[0]!), `${href} is linked but not served (${JSON.stringify(config)})`);
  }
 }
 for (const [, href] of accessibilityHtml().matchAll(/href="(\/[^"]*)"/g)) assert.ok(served.has(href!.split('#')[0]!), href!);
});

test('legal: the operator is named only in legal text, never as product branding', () => {
 const code = ['worker', 'web', 'shared', 'tools'].flatMap(dir => files(dir));
 assert.deepEqual(code.filter(path => read(path).includes('Robles')), ['shared/brand.ts']);
 const users = code.filter(path => path !== 'shared/brand.ts' && /\bOPERATOR_(?:LEGAL_NAME|DESCRIPTION|JURISDICTION|ENTITY_TYPE)\b/.test(read(path)));
 assert.deepEqual(users.map(path => relative('.', path)), ['worker/src/legal.ts']);
});

test('legal: owner facts that are still missing are listed and described as pending, not asserted', () => {
 const items = legalOpenItems(), open = items.map(item => item.id), privacy = privacyPolicyHtml(reviewConfig()), terms = termsHtml(reviewConfig());
 assert.equal(open.includes('email-routing'), !CONTACT_MAIL.routingEnabled || !CONTACT_MAIL.forwardingVerified, 'mail must be proven to arrive, not just routed');
 assert.equal(items.find(item => item.id === 'email-routing')?.blocksLaunch ?? true, true);
 assert.equal(open.includes('mailbox-provider'), !CONTACT_MAIL.mailboxProvider);
 assert.equal(open.includes('mailbox-transfer'), SERVES_EU_UK && !!CONTACT_MAIL.mailboxProvider && !CONTACT_MAIL.mailboxTransfer);
 assert.equal(open.includes('model-provider'), !MODEL_PROVIDER.legalName || !MODEL_PROVIDER.location || !MODEL_PROVIDER.handling || (SERVES_EU_UK && !MODEL_PROVIDER.transfer));
 assert.equal(open.includes('telephone-provider'), !TELEPHONE_PROVIDER.name || (SERVES_EU_UK && !TELEPHONE_PROVIDER.transfer));
 if (SERVES_EU_UK && !MODEL_PROVIDER.transfer) assert.match(privacy, /<strong>TypeSafe<\/strong>: confirmation is pending/);
 if (!MODEL_PROVIDER.handling) assert.match(privacy, /We have not yet confirmed TypeSafe’s legal entity/);
 if (!MODEL_PROVIDER.location) assert.match(privacy, /in locations we have not yet confirmed/);
 if (!CONTACT_MAIL.mailboxProvider) assert.match(privacy, /we will name its provider here/);
 if (!TELEPHONE_PROVIDER.name) {
  assert.match(privacy, /<tr><th scope="row">Our telephone provider \(not yet named\)<\/th><td>Carries calls to/, 'the telephone provider is listed by category');
  assert.match(privacy, /We will name our telephone provider here once it is confirmed/);
 }
 if (!(DMCA_AGENT.registered && DMCA_AGENT.name && DMCA_AGENT.postalAddress && DMCA_AGENT.phone)) {
  assert.ok(open.includes('dmca-agent'));
  assert.match(terms, /Registration of our designated agent with the US Copyright Office is pending/);
  assert.doesNotMatch(terms, /registered with the US Copyright Office, is/);
 }
 for (const file of legalMarkdownFiles(reviewConfig()).slice(0, 2)) for (const item of items) assert.ok(file.content.includes(item.detail), `${file.path} header lists ${item.id}`);
 // D13: of the owner facts, only contact mail that does not arrive blocks launch. The model provider's facts, the DMCA
 // registration and the EU, EEA and UK items stay disclosed as pending but are not launch gates. The one other blocker is
 // version 1.2.0's notice question (change-notice), which counsel's sign-off on that version closes.
 assert.deepEqual(legalLaunchBlockers().map(item => item.id), items.filter(item => item.blocksLaunch).map(item => item.id));
 for (const item of items) assert.equal(item.blocksLaunch, ['email-routing', 'mailbox-provider', 'change-notice'].includes(item.id), `${item.id}: only unreachable contact mail and the 1.2.0 notice question block launch`);
 for (const id of ['model-provider', 'dmca-agent']) assert.ok(!legalLaunchBlockers().some(item => item.id === id), id);
 for (const file of legalMarkdownFiles(reviewConfig())) assert.doesNotMatch(file.content, /Blocks launch in the EU/, file.path);
});

test('legal: the legal module never imports the provider client, because the public worker renders it', () => {
 assert.doesNotMatch(read('worker/src/legal.ts'), /from\s+['"]\.\/(?:ai|jev)(?:\.ts)?['"]/);
});

test('legal: challenges and juries are described as they run, including what they store and send to Jev', () => {
 for (const config of allConfigs()) {
  const s = on(config), name = JSON.stringify(config), privacy = privacyPolicyHtml(config), terms = termsHtml(config);
  const jev = privacy.slice(privacy.indexOf('<strong>What Jev receives:</strong>'), privacy.indexOf('<strong>What Jev never receives:</strong>'));
  assert.equal(privacy.includes('<h3>When you challenge an account or serve as a juror</h3>'), s.challenges || s.practice, `${name}: challenge and juror section`);
  assert.equal(/The reason given in a challenge/.test(jev), s.challenges, `${name}: Jev receives challenge reasons`);
  assert.equal(/We do not store your reason/.test(privacy), s.challenges, name);
  assert.equal(/<strong>Juror tokens\.<\/strong>/.test(privacy), s.practice, `${name}: juror tokens`);
  const seats = policy.jury.seatsPerEmployer as Record<string, number | null>;
 assert.equal(/of the case and your token’s employer/.test(privacy), (s.jury && seats.mailbox != null) || (s.sandbox && seats.sandbox != null), `${name}: seat groups`);
 assert.equal(/HMAC-SHA-256 with a secret key\) of the case/.test(privacy), config.rateLimitKeyed === true && ((s.jury && seats.mailbox != null) || (s.sandbox && seats.sandbox != null)), `${name}: keyed seat groups`);
  assert.equal(/Challenge receipts \(no reasons, no text\)/.test(privacy), s.challenges, `${name}: challenge retention`);
  assert.equal(/Re-check decisions: the decision, the rules and the model/.test(privacy), s.challenges, `${name}: re-check retention`);
  assert.equal(/Jury seats and votes/.test(privacy), s.practice, `${name}: jury retention`);
  // Terms: only moderation-policy rules can be cited; the other rules go to legal@.
  assert.equal(/cannot be cited in a challenge/.test(terms), s.challenges, `${name}: citable rules`);
  assert.match(terms, /Report a breach of them to <a href="mailto:legal@/);
  assert.doesNotMatch(terms, /once it is active, the challenge process/);
  assert.equal(/You cannot yet look up a jury’s later decision/.test(terms), s.challenges, `${name}: challenger receipts`);
 }
});

// EU, EEA and UK sections (GDPR and UK GDPR, Digital Services Act, UK Online Safety Act).

const named = (rep: Representative) => rep.appointed && !!rep.name && !!rep.address;
/** The text of one h2 section of a rendered page, up to the next h2. */
const section = (html: string, id: string) => {
 const start = html.indexOf(`<h2 id="${id}">`);
 if (start < 0) return '';
 const end = html.indexOf('<h2 ', start + 1);
 return html.slice(start, end < 0 ? undefined : end);
};
/** The paragraph that starts with a bold label, e.g. "Points of contact (Articles 11 and 12)". */
const paragraph = (html: string, label: string) => {
 const start = html.indexOf(`<p><strong>${label}.</strong>`);
 return start < 0 ? '' : html.slice(start, html.indexOf('</p>', start));
};

test('legal: the EU, EEA and UK sections render in every configuration while the service is offered there', () => {
 const privacyHeadings = ['Who is responsible', 'Legal bases', 'Sensitive information', 'Your rights', 'Automated decisions', 'Transfers outside the EU, EEA and UK', 'Complaints and assessments'];
 const dsa = ['Points of contact (Articles 11 and 12)', 'Legal representative (Article 13)', 'Reporting illegal content (Article 16)', 'Statements of reasons (Article 17)', 'Complaints about our decisions (Article 20)', 'Out-of-court dispute settlement (Article 21)', 'Trusted flaggers (Article 22)', 'Transparency (Article 15)'];
 for (const config of allConfigs()) {
  const name = JSON.stringify(config), s = on(config), privacy = section(privacyPolicyHtml(config), 'eu-uk'), terms = section(termsHtml(config), 'eu-uk');
  assert.equal(privacy.length > 0, SERVES_EU_UK, `privacy ${name}`);
  assert.equal(terms.length > 0, SERVES_EU_UK, `terms ${name}`);
  if (!SERVES_EU_UK) continue;
  for (const heading of privacyHeadings) assert.ok(privacy.includes(`<h3>${heading}</h3>`), `privacy ${name}: ${heading}`);
  for (const heading of dsa) assert.ok(terms.includes(`<strong>${heading}.</strong>`), `terms ${name}: ${heading}`);
  for (const heading of ['Your consumer rights', 'Digital Services Act', 'UK Online Safety Act']) assert.ok(terms.includes(`<h3>${heading}</h3>`), `terms ${name}: ${heading}`);
  // Controller, special category data and its two cases, Article 11, Article 22, transfers and complaints.
  assert.ok(privacy.includes(`The controller of your personal data is ${OPERATOR_DESCRIPTION}`), name);
  assert.match(privacy, /special category data \(GDPR Article 9\)/);
  assert.match(privacy, /ask you not to include this kind of information about anyone else\. Our checks do not reliably catch it/);
  assert.doesNotMatch(privacy, /We rely on that explicit choice/, 'no explicit consent is claimed that the product does not ask for');
  if (CODE_FACTS.specialCategoryConsent) {
   assert.match(privacy, /Checking it is your explicit consent \(Article 9\(2\)\(a\)\)/);
   assert.match(privacy, /we store only whether you checked it, as a yes or no on the private intake record/);
  } else {
   assert.match(privacy, /The submission form does not yet ask for your explicit consent to sensitive information about yourself \(Article 9\(2\)\(a\)\)/);
   assert.doesNotMatch(privacy, /your explicit consent \(Article 9\(2\)\(a\)\) to that information/);
  }
  // The server-side support-resources checks are named, and their Article 9 condition is pending until counsel sets it.
  assert.equal(/<strong>Support-resources checks\.<\/strong>/.test(privacy), s.serverCrisis || s.selfHarm, `privacy ${name}: support-resources checks`);
  if ((s.serverCrisis || s.selfHarm) && !SUPPORT_CHECKS_SENSITIVE_DATA_BASIS) assert.match(privacy, /We have not yet confirmed which condition in Article 9 covers this/);
  assert.match(privacy, /Once it is published, you have (?:also )?made the information public yourself \(Article 9\(2\)\(e\)\)/);
  if (THIRD_PARTY_SENSITIVE_DATA_BASIS) assert.ok(privacy.includes(THIRD_PARTY_SENSITIVE_DATA_BASIS));
  else assert.match(privacy, /We have not yet confirmed which condition in Article 9/);
  assert.match(privacy, /GDPR Article 11 applies/);
  assert.match(privacy, /under Article 22/);
  assert.match(privacy, /<strong>Cloudflare<\/strong> states that/);
  assert.match(privacy, /Cloudflare also states that its customer data processing addendum/, 'the DPA sentence is attributed to Cloudflare');
  assert.match(privacy, /Information Commissioner’s Office/);
  assert.match(privacy, /where you live, where you work or where you think the infringement happened/);
  assert.match(privacy, /<a href="\/status">status page<\/a>/);
  // Automated decisions list the challenge steps whenever challenges are open.
  assert.equal(/The check of whether a challenge’s reason fits the rule it cites/.test(privacy), s.challenges, `privacy ${name}: challenge relevance`);
  assert.equal(/The re-check of a challenged account under the current policy, which can withhold a published account/.test(privacy), s.challenges, `privacy ${name}: challenge re-check`);
  // Consumer law overrides the Texas choice of law and venue; the UK Online Safety Act section names the reporting routes.
  assert.match(terms, /mandatory laws of the country where you live/);
  assert.match(terms, /user-to-user service under the Online Safety Act 2023/);
  assert.match(terms, /No organization, including an employer, gets a privileged outcome/);
  assert.match(terms, /contributions cannot be linked to a person and we have no contact details for them/);
  assert.ok(terms.includes(`You must be ${MINIMUM_AGE} or older`), name);
  // DSA scope is stated accurately, trusted flaggers get no priority, and a successful complaint has a stated remedy.
  assert.match(terms, /Micro and small enterprises are exempt from some of its articles/);
  assert.doesNotMatch(terms, /whether or not a particular provision applies/);
  assert.match(paragraph(terms, 'Trusted flaggers (Article 22)'), /under the same rules, standard and handling as every other notice/);
  assert.doesNotMatch(terms, /handled first/, 'the constitution gives no organization priority');
  assert.match(paragraph(terms, 'Complaints about our decisions (Article 20)'), /If a complaint shows that a decision was wrong, we fix the rule or the code for everyone/);
  // Receipts are always on the status page; appeals, the challenge route and counts follow their own switches.
  assert.match(paragraph(terms, 'Statements of reasons (Article 17)'), /<a href="\/status">status page<\/a> shows, for your capability, the contribution’s status and a receipt for each moderation decision/);
  assert.equal(/Appeals to a new jury are planned but not active/.test(terms), !s.practice && !s.juryPending, `terms ${name}: appeals`);
  assert.equal(/For real employers, appeals to a new jury are not active yet/.test(terms), s.sandbox && !s.jury && !s.juryPending, `terms ${name}: practice appeals`);
  assert.equal(/For real employers, juries and appeals are switched on, but one forms only when/.test(terms), s.juryPending, `terms ${name}: pending appeals`);
  assert.equal(/challenge it from the account itself/.test(terms), s.challenges, `terms ${name}: challenge route`);
  assert.equal(/with a challenge from the account/.test(terms), s.challenges, `terms ${name}: UK reporting route`);
  // Policy 0.6.0: counts that follow contributions are rounded like contribution counts (moderation.ts storedCount), refreshed daily.
  assert.match(paragraph(terms, 'Transparency (Article 15)'), /<a href="\/api\/moderation\/stats">\/api\/moderation\/stats<\/a>, refreshed once a UTC day\. Counts that follow contributions \([^)]*\) are shown as “&lt;25” from 1 to 24 and otherwise rounded down to a multiple of 25; any other count below 5 is shown as “&lt;5”/);
  assert.doesNotMatch(terms, /transparency page also publishes quarterly moderation counts/, 'the transparency page does not render moderation counts');
 }
 // Cross-references from the general sections.
 if (SERVES_EU_UK) {
  assert.match(privacyPolicyHtml(reviewConfig()), /<a href="#eu-uk">If you are in the EU, EEA or UK<\/a>/);
  assert.match(termsHtml(reviewConfig()), /see also <a href="#eu-uk">EU and UK users<\/a>/);
 }
});

test('legal: EU and UK duties are pending on the pages until brand.ts records them, and are labelled but not launch gates', () => {
 const privacy = privacyPolicyHtml(reviewConfig()), terms = termsHtml(reviewConfig()), items = legalOpenItems(), open = items.map(item => item.id);
 const representatives: [Representative, string, string, string][] = [
  [EU_REPRESENTATIVE, 'eu-representative', 'Representative in the EU', privacy],
  [UK_REPRESENTATIVE, 'uk-representative', 'Representative in the UK', privacy],
  [DSA_LEGAL_REPRESENTATIVE, 'dsa-legal-representative', 'Legal representative (Article 13)', terms],
 ];
 for (const [rep, id, label, html] of representatives) {
  assert.equal(open.includes(id), SERVES_EU_UK && !named(rep), id);
  if (!SERVES_EU_UK) continue;
  const at = html.indexOf(`<strong>${label}`);
  assert.ok(at >= 0, `${id} is mentioned`);
  const text = html.slice(at, html.indexOf('</', html.indexOf('</strong>', at) + 9));
  if (named(rep)) assert.ok(text.includes(rep.name!) && text.includes(rep.address!), `${id} is named once appointed`);
  else assert.match(text, /pending/, `${id} is shown as pending`);
 }
 const {dpia, ukIllegalContentRisk, ukChildrenAccess} = COMPLIANCE_ASSESSMENTS;
 assert.equal(open.includes('dpia'), SERVES_EU_UK && !dpia);
 assert.equal(open.includes('uk-online-safety-assessments'), SERVES_EU_UK && (!ukIllegalContentRisk || !ukChildrenAccess));
 assert.equal(open.includes('special-category-consent'), SERVES_EU_UK && !CODE_FACTS.specialCategoryConsent);
 assert.equal(open.includes('third-party-sensitive-data-basis'), SERVES_EU_UK && !THIRD_PARTY_SENSITIVE_DATA_BASIS);
 if (SERVES_EU_UK && !dpia) {
  assert.match(privacy, /We are preparing a data protection impact assessment \(GDPR Article 35\)[^.]*\. It is not complete yet/);
  assert.doesNotMatch(privacy, /completed a data protection impact assessment/);
 }
 if (SERVES_EU_UK && !ukChildrenAccess) assert.match(terms, /children’s access assessment under the Act (?:is|are) not yet complete/);
 if (SERVES_EU_UK && !ukIllegalContentRisk) assert.match(terms, /illegal content risk assessment[^.]* not yet complete/);
 if (!ukIllegalContentRisk && !ukChildrenAccess) assert.doesNotMatch(terms, /We completed our/);
 // D13: each is labelled as an EU, EEA and UK item in the review copies, but none blocks launch or appears in legalLaunchBlockers().
 const euUk = ['eu-representative', 'uk-representative', 'dsa-legal-representative', 'dpia', 'uk-online-safety-assessments', 'special-category-consent', 'third-party-sensitive-data-basis', 'support-checks-sensitive-data-basis'];
 for (const item of items) {
  assert.equal(item.euUk === true, euUk.includes(item.id), item.id);
  if (!euUk.includes(item.id)) continue;
  assert.equal(item.blocksLaunch, false, item.id);
  assert.ok(!legalLaunchBlockers().some(blocker => blocker.id === item.id), item.id);
  for (const file of legalMarkdownFiles(reviewConfig()).slice(0, 2)) assert.ok(file.content.includes(`**EU, EEA and UK.** ${item.detail}`), `${file.path}: ${item.id}`);
 }
});

test('legal: the owner’s telephone number is listed as a contact and as the DMCA agent’s number, with its provider disclosed', () => {
 assert.match(OPERATOR_PHONE, /^\+1 \d{3}-\d{3}-\d{4}$/);
 assert.equal(DMCA_AGENT.phone, OPERATOR_PHONE);
 for (const config of allConfigs()) for (const html of [privacyPolicyHtml(config), termsHtml(config)]) assert.ok(html.includes(`<li>Telephone: ${OPERATOR_PHONE}</li>`), JSON.stringify(config));
 assert.ok(accessibilityHtml().includes(`call ${OPERATOR_PHONE}`));
 const privacy = privacyPolicyHtml(reviewConfig()), terms = termsHtml(reviewConfig());
 assert.match(privacy, new RegExp(`<tr><th scope="row">[^<]+</th><td>Carries calls to ${OPERATOR_PHONE.replace('+', '\\+')}`), 'the telephone provider is in the providers table');
 // Not offered as the Digital Services Act point of contact until the owner confirms a staffed line.
 if (SERVES_EU_UK) assert.ok(!paragraph(terms, 'Points of contact (Articles 11 and 12)').includes(OPERATOR_PHONE), 'Article 12 contact is email and post');
 // Plain text only: legal links allow site paths, anchors, mailto: and https:// (no tel:).
 assert.doesNotMatch(terms + privacy, /href="tel:/);
});

test('legal: the version and changelog agree, and review drafts appear only in the review copies', () => {
 assert.equal(LEGAL_CHANGELOG[0]?.version, LEGAL_VERSION, 'the newest changelog entry is the current version');
 assert.ok(!LEGAL_CHANGELOG[0]?.draft, 'the current version is not a draft');
 assert.equal(new Set(LEGAL_CHANGELOG.map(c => c.version)).size, LEGAL_CHANGELOG.length);
 const html = privacyPolicyHtml(reviewConfig()), markdown = legalMarkdownFiles(reviewConfig());
 assert.ok(html.includes(`Version ${LEGAL_VERSION}, effective`));
 for (const change of LEGAL_CHANGELOG) {
  const row = new RegExp(`<tr><th scope="row">${change.version.replace(/\./g, '\\.')}</th><td>([^<]*)</td>`).exec(html)?.[1];
  if (change.draft) {
   assert.equal(row, undefined, `${change.version} is a draft and must not appear in the public version history`);
   for (const file of markdown) assert.ok(file.content.includes(`${change.version} (${change.summary})`), `${file.path} lists draft ${change.version}`);
  } else assert.equal(row, longDate(change.effective), change.version);
 }
});

// ---------------------------------------------------------------------------------------------------------------
// Trust pages (worker/src/pages.ts): every published count is defined, the covenant is versioned, and what the
// transparency and moderation pages say matches the code they describe.
// ---------------------------------------------------------------------------------------------------------------

test('trust pages: every moderation count, held reason and jury outcome has its definition or label', async () => {
 const {testEnv} = await import('./d1.ts');
 const {MODERATION_STAT_DEFINITIONS, HELD_LABELS, OUTCOME_LABELS, trustPage} = await import('../worker/src/pages.ts');
 const {moderationStats} = await import('../worker/src/moderation.ts');
 const {env} = testEnv();
 const stats = await moderationStats(env);
 assert.deepEqual(Object.keys(stats.counts).sort(), Object.keys(MODERATION_STAT_DEFINITIONS).sort(), 'a count without a definition would render an empty "What it counts" cell');
 for (const key of Object.keys(stats.heldByReason)) assert.ok(HELD_LABELS[key], `held reason ${key} has no label`);
 for (const key of Object.keys(stats.juryOutcomes)) assert.ok(OUTCOME_LABELS[key], `jury outcome ${key} has no label`);
 const html = await trustPage('moderation', env, 'test');
 for (const definition of Object.values(MODERATION_STAT_DEFINITIONS)) assert.ok(html.includes(definition.replace(/’/g, '’')), definition);
});

test('trust pages: the covenant is versioned with the legal go-live date and one history row per version', async () => {
 const {COVENANT, trustPage} = await import('../worker/src/pages.ts');
 const {testEnv} = await import('./d1.ts');
 // The covenant took effect when the legal pages were first served; later legal versions do not move it.
 assert.equal(COVENANT.effective, LEGAL_FIRST_SERVED);
 assert.equal(COVENANT.history[0]?.version, COVENANT.version, 'the newest history row is the current version');
 assert.equal(new Set(COVENANT.history.map(h => h.version)).size, COVENANT.history.length);
 const html = await trustPage('constitution', testEnv().env, 'test');
 assert.ok(html.includes(`Covenant version ${COVENANT.version}, effective`));
 for (const h of COVENANT.history) assert.match(html, new RegExp(`<th scope="row">${h.version.replace(/\./g, '\\.')}</th>`));
});

test('trust pages: the transparency page matches the archive format and the verify-deployment options it documents', async () => {
 const {trustPage} = await import('../worker/src/pages.ts');
 const {ARCHIVE_FORMAT} = await import('../worker/src/ledger.ts');
 const {ISSUANCE_POLICY} = await import('../shared/proof.ts');
 const {testEnv} = await import('./d1.ts');
 const html = await trustPage('transparency', testEnv().env, 'test');
 assert.ok(html.includes(`<code>${ARCHIVE_FORMAT}</code>`), 'the archive format named on the page is the one the archive job writes');
 const tool = read('tools/verify-deployment.mjs');
 for (const flag of ['--state', '--release-key']) {
  assert.ok(html.includes(flag), `the page documents ${flag}`);
  assert.match(tool, new RegExp(`option\\('${flag}'`), `tools/verify-deployment.mjs accepts ${flag}`);
 }
 // Registry wording: rows are never deleted by the application, but the page must not promise a complete history.
 assert.doesNotMatch(html, /every issuer key ever published/);
 assert.match(read('worker/src/ledger.ts'), /SELECT \* FROM trusted_issuers/, 'archives list the whole trusted_issuers registry');
 // Numbers in the verification limits table use thousands separators, from the issuance policy.
 for (const [, cap] of ISSUANCE_POLICY.mailboxCredentialsByHeadcount) if (cap >= 1000) assert.ok(html.includes(`<td>${String(cap).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</td>`), String(cap));
});

test('trust pages: the moderation page says how legal orders are handled while trustees are not active, and why a jury cannot form', async () => {
 const {trustPage} = await import('../worker/src/pages.ts');
 const {employersNeeded} = await import('../shared/policy.ts');
 const {testEnv} = await import('./d1.ts');
 // Fictional employers shown (SAMPLE_EMPLOYERS on, as locally): the practice-jury requirement is stated.
 const {env: base, publicDb} = testEnv(), env = {...base, SAMPLE_EMPLOYERS: 'on'} as typeof base;
 const html = await trustPage('moderation', env, 'test');
 // No TRUSTEE_KEYS in the test env: the exceptions section names the interim route and links the ledger.
 assert.match(html, /The process is not active: no trustee keys are configured[^<]*Until it is, we act on valid legal orders, and on other removals the law requires[^<]*through direct administrative access/);
 // RT-ABUSE-07: that access is never used for a content-rule judgment; those go through challenges.
 assert.match(html, /A report that an account breaks a content rule, and not the law, is decided by a challenge under the published rules, never by this route/);
 assert.match(html, /A person’s judgment that an account breaks a content rule is never a reason for such a removal/);
 assert.match(html, /<a href="\/legal-requests">legal requests ledger<\/a>/);
 assert.match(html, /The trustee process these principles rely on is not active yet/);
 const withTrustees = await trustPage('moderation', {...env, TRUSTEE_KEYS: JSON.stringify([])} as typeof env, 'test');
 assert.ok(withTrustees.length > 0);
 // With no sandbox juror keys in the test database, the reason names the requirement from the policy (other employers only
 // where the policy keeps jurors off their own employer's cases; the seat limit only where there is one), and says that
 // more keys cannot help while there are too few fictional employers.
 const samples = (publicDb.db.prepare("SELECT COUNT(*) AS n FROM companies WHERE kind='sample'").get() as {n: number}).n;
 const need = employersNeeded('sandbox', 'initial'), cap = seatsPerEmployer('sandbox'), excluded = ownEmployerExcluded('sandbox');
 const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
 const requirement = `a case needs juror keys of at least ${words[need]} ${excluded ? 'other ' : ''}fictional employer${need === 1 ? '' : 's'}${cap === null ? '' : ` under the ${words[cap]}-seat limit`}`;
 assert.ok(html.includes(`Practice juries for the fictional demonstration employers: switched on, but no practice jury can form right now: ${requirement}`), 'the requirement is stated from the policy');
 assert.equal(/so publishing more keys cannot change this until (?:more fictional employers are|a fictional employer is) added/.test(html), samples - (excluded ? 1 : 0) < need);
 assert.doesNotMatch(html, /not enough juror keys of other employers are published/, 'the old reason blamed missing keys');
 // Policy 0.7.0 (RT-B1): one fictional employer's keys staff any practice case and appeal, its own employer's included.
 if (!excluded && cap === null) {
  assert.ok(html.includes('a case needs juror keys of at least one fictional employer, and no fictional employer publishes them yet.'), 'the 0.7.0 requirement, with no keys published');
  assert.ok(html.includes('Appeals: none can form right now; an appeal needs juror keys of at least one fictional employer.'), 'the 0.7.0 appeal requirement');
  assert.doesNotMatch(html, /other fictional employer|counting the case’s own employer\. Appeals/, 'no 0.6.0 exclusion wording for practice juries');
 }
 // Every count agrees with its noun: never "one … employers" or "three … employer publishes".
 const status = /<p class="notice">(Juries for real employers[^]*?)<\/p>/.exec(html)?.[1] ?? '';
 assert.ok(status, 'the status line is rendered');
 assert.doesNotMatch(status, /\bone (?:other )?(?:fictional|real) employers\b/, 'singular count with a plural noun');
 assert.doesNotMatch(status, /\b(?:zero|two|three|four|five|six|seven|eight|nine|ten) (?:other )?(?:fictional|real) employer\b(?! (?:is|exists))/, 'plural count with a singular noun');
});

test('trust pages: /legal-requests says how to send a legal request (legal@ by email, the postal address, the terms and the privacy policy)', async () => {
 const {trustPage} = await import('../worker/src/pages.ts');
 const {testEnv} = await import('./d1.ts');
 const {env} = testEnv();
 const sendSection = (html: string) => /<h2 id="send">How to send a legal request<\/h2>([^]*?)(?=<h2|$)/.exec(html)?.[1] ?? '';
 // The page as served: challenges are open only while RATE_LIMIT_SECRET is set, and the section follows that switch.
 for (const [secret, open] of [[undefined, false], ['test-secret', true]] as const) {
  const html = await trustPage('legal-requests', {...env, RATE_LIMIT_SECRET: secret} as typeof env, 'test');
  const send = sendSection(html), name = `RATE_LIMIT_SECRET ${secret ? 'set' : 'unset'}`;
  assert.ok(send, `${name}: the section is rendered`);
  assert.ok(html.includes('<a href="#send">how to send a legal request</a>'), `${name}: the lede points to it`);
  assert.ok(send.includes(`to <a href="mailto:${CONTACT.legal}">${CONTACT.legal}</a> or by post to ${OPERATOR_DESCRIPTION}, ${OPERATOR_POSTAL_ADDRESS}.`), `${name}: legal@ as a mailto link, and the postal address addressed to the operator`);
  assert.ok(send.includes('<a href="/terms#legal-notices">Legal notices and court orders</a>'), `${name}: links the terms section`);
  assert.ok(send.includes('<a href="/privacy#legal-requests">Legal requests and disclosure</a>'), `${name}: links the privacy policy`);
  for (const address of [CONTACT.dmca, CONTACT.privacy]) assert.ok(send.includes(`<a href="mailto:${address}">${address}</a>`), `${name}: ${address}`);
  assert.equal(/is decided by a challenge under the published rules/.test(send), open, `${name}: challenges described as open only while they are`);
  assert.equal(/The in-product challenge process is not open/.test(send), !open, name);
  assert.match(send, /never a withdrawal capability/, `${name}: warns against sending a capability`);
  assert.equal(html.indexOf('<h2 id="send">'), html.lastIndexOf('<h2 id="send">'), `${name}: one section`);
 }
 // Every configuration: the section uses the terms' own sentence, and every link it makes is served and lands on a
 // section the linked page renders in that configuration.
 const index = read('worker/src/app.ts');
 const served = new Set(['/', ...sourceArray(index, 'SPA_PATHS'), ...sourceArray(index, 'TRUST_PAGES').map(page => `/${page}`)]);
 for (const config of allConfigs()) {
  const send = legalRequestsContactHtml(config), terms = termsHtml(config), privacy = privacyPolicyHtml(config), name = JSON.stringify(config);
  const first = /^<h2 id="send">[^<]*<\/h2><p>(.*?)<\/p>/.exec(send)?.[1] ?? '';
  assert.ok(first && section(terms, 'legal-notices').includes(`<p>${first} A notice about content you believe is illegal should include:</p>`), `${name}: the terms say where notices go in the same words`);
  assert.doesNotMatch(send, /\]\(|\*\*|undefined|\bnull\b|<script|\son\w+=/, `${name}: unrendered marker or leaked value`);
  for (const [, href] of send.matchAll(/href="([^"]*)"/g)) {
   assert.match(href!, /^(?:\/|mailto:)/, `${name}: href ${href}`);
   if (!href!.startsWith('/')) continue;
   const [path, anchor] = href!.split('#') as [string, string | undefined];
   assert.ok(served.has(path), `${name}: ${path} is linked but not served`);
   if (anchor) assert.ok((path === '/terms' ? terms : path === '/privacy' ? privacy : '').includes(`<h2 id="${anchor}">`), `${name}: ${href} has no such section`);
  }
 }
});

// ---------------------------------------------------------------------------------------------------------------
// Hardening (round 3 red team): who decides a removal, what the daily interest record names, and when a jury can form.
// ---------------------------------------------------------------------------------------------------------------

/** Rendered HTML as plain sentences, for checks that must hold for every sentence that mentions something. */
const sentences = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').split(/(?<=[.;:])\s+(?=[A-Z])/);

test('RT-ABUSE-07: a person decides removals only against the law; content-rule reports go through challenges', () => {
 for (const config of allConfigs()) {
  const s = on(config), name = JSON.stringify(config), privacy = privacyPolicyHtml(config), terms = termsHtml(config);
  const described = section(privacy, 'described');
  assert.doesNotMatch(privacy + terms, /where a rule is broken|where it breaks our rules/, `${name}: a person may not remove for a rule break`);
  assert.match(described, /a person reviews each one against the law, not against our content rules/, name);
  assert.match(described, /No one at the operator removes a contribution because they judge that it breaks a content rule/, name);
  // Direct access is named only next to what the law requires, never next to the content rules.
  for (const sentence of sentences(described)) if (/direct administrative access|trustee process/.test(sentence)) assert.match(sentence, /the law requires removal/, `${name}: ${sentence}`);
  assert.equal(/we will file the challenge for you through the same public process, with no priority, and send you its receipt/.test(described), s.challenges, `${name}: filing a challenge for a reporter`);
  assert.equal(/decided by the published challenge process instead: we can file the challenge for the sender/.test(section(terms, 'legal-notices')), s.challenges, `${name}: legal notices that only cite a policy rule`);
  assert.match(section(terms, 'legal-notices'), /A person decides a notice against the law, not against our content rules, and we remove a contribution only where the law requires it/);
  assert.match(section(terms, 'content-rules'), /we remove one for breaking these rules only where the law requires it/);
  if (SERVES_EU_UK) {
   const notices = paragraph(terms, 'Reporting illegal content (Article 16)');
   assert.match(notices, /A person reviews each notice sent by email and decides whether the content is illegal; no automated tool decides that/, name);
   assert.equal(/says only that a contribution breaks a rule in our moderation policy, and not the law, is handled as a challenge/.test(notices), s.challenges, `${name}: rule-only notices`);
  }
 }
});

test('RT-ABUSE-10: the daily question-interest record is disclosed as naming the employer and the standard question', () => {
 // The code: interest is de-duplicated per employer and standard question; the challenge budget per network only.
 assert.match(read('worker/src/app.ts'), /scope=`interest:\$\{evidence\.company\.id\}:\$\{id\}`/, 'if the interest scope changes, change the privacy text with it');
 assert.match(read('worker/src/app.ts'), /data\.countInterest&&/, 'the interest record is made only when the reader opts in');
 assert.match(read('worker/src/moderation.ts'), /dailyDigest\(env,request,'challenge',day\)/, 'the challenge budget record names no account, rule or employer');
 for (const config of allConfigs()) {
  const s = on(config), name = JSON.stringify(config), privacy = privacyPolicyHtml(config);
  const keyed = config.rateLimitKeyed === true;
  assert.equal(/For question interest, the purpose names the employer and the standard question, and the record is made only when you choose to share the topic/.test(privacy), keyed, name);
  assert.equal(/whether that network shared interest in a given standard question about a given employer that day/.test(privacy), keyed, name);
  assert.equal(/can remain in the databases’ recovery history for up to 30 days, where a court order could require us to recover it/.test(privacy), keyed, name);
  assert.equal(/the purpose \(for question interest, the employer and the standard question\)/.test(privacy), keyed, `${name}: retention row`);
  assert.equal(/For the challenge limit, the purpose is only “challenge”/.test(privacy), keyed && s.challenges, `${name}: challenge record`);
 }
 assert.equal(CODE_FACTS.recoveryDays, 30);
});

test('RT-D1: practice juries and appeals are described as deciding only when one can form', () => {
 for (const config of allConfigs()) {
  const s = on(config), name = JSON.stringify(config), privacy = privacyPolicyHtml(config), terms = termsHtml(config);
  assert.doesNotMatch(terms, /practice juries can decide cases about fictional sample employers/, `${name}: unconditional practice jury`);
  // The condition names other fictional employers only while the policy keeps practice jurors off their own employer's cases.
  const practiceJurors = ownEmployerExcluded('sandbox') ? 'enough jurors of other fictional employers' : 'enough jurors';
  if (s.sandbox && !s.jury && !s.juryPending) assert.ok(section(terms, 'jurors').includes(`Practice juries decide cases about fictional sample employers only when ${practiceJurors} can serve; the <a href="/moderation#juries">moderation page</a> says whether one can form now`), name);
  if (s.sandbox && s.juryPending) assert.ok(section(terms, 'jurors').includes(`Practice juries decide cases about fictional sample employers only when ${practiceJurors} can serve.`), name);
  if (s.juryPending) assert.match(section(terms, 'jurors'), /Juries for real employers are switched on, but one forms only when enough jurors[^;]* can serve, and none can yet/, name);
  // Every promise of an appeal carries the condition the code applies (appealState: juryCanForm(..., 'appeal')).
  for (const sentence of sentences(privacy + terms)) if (/can (?:then )?appeal once/.test(sentence)) assert.match(sentence, /when enough (?:jurors (?:of other (?:fictional )?employers )?)?can serve|enough can serve on an appeal/, `${name}: ${sentence}`);
 }
 assert.match(read('worker/src/moderation.ts'), /available:upheld\.length>0&&await juryCanForm\(env,upheld\[0\]!\.jury_class,row\.company_id,'appeal'\)/, 'an appeal is offered only when an appeal jury can form');
});

test('policy 0.7.0: the legal pages say whether a juror can sit on a case about their own employer, and which seats are limited, as moderation.ts applies it', () => {
 // The code the text describes: the draw keeps a juror off their token's employer only for a class with ownEmployerExcluded,
 // and a class with no seat limit records no seat group.
 const moderation = read('worker/src/moderation.ts');
 assert.match(moderation, /const excluded=ownEmployerExcluded\(juror\.jurorClass\)\?own\?\.id\?\?'':''/, 'the draw applies ownEmployerExcluded');
 assert.match(moderation, /cap===null\?\{group:null,cap:null\}/, 'no seat group without a seat limit');
 // Policy 0.8.0: every community-source token shares one seat group per case, and community keys never make a jury formable.
 assert.match(moderation, /if\(juror\.source==='community'\) return \{group:await keyedDigest\(env,`siwt-seat-v2:\$\{caseId\}:source=community`\),cap:communitySeatsPerCase\(\)\}/, 'community tokens share one capped seat group');
 assert.match(moderation, /for\(const k of await publicIssuerKeys\(env,'juror'\)\) if\(k\.source!=='community'\)/, 'only curated juror keys count toward forming a jury');
 const communitySeats = (policy.jury as {communitySeatsPerCase?: number}).communitySeatsPerCase;
 const seats = policy.jury.seatsPerEmployer as Record<'mailbox' | 'sandbox', number | null>;
 for (const config of allConfigs()) {
  const s = on(config), name = JSON.stringify(config), privacy = privacyPolicyHtml(config), terms = termsHtml(config);
  const serving = /<strong>Serving\.<\/strong>([^<]*)/.exec(privacy)?.[1] ?? '';
  assert.equal(!!serving, s.practice, `${name}: serving bullet`);
  if (!s.practice) continue;
  const classes: readonly ('mailbox' | 'sandbox')[] = [...(s.jury ? ['mailbox' as const] : []), ...(s.sandbox ? ['sandbox' as const] : [])];
  assert.equal(/never a case about your token’s employer/.test(serving), classes.every(c => ownEmployerExcluded(c)), `${name}: ${serving}`);
  assert.equal(/can be drawn for a case about the fictional employer it names/.test(serving), s.sandbox && !ownEmployerExcluded('sandbox'), `${name}: ${serving}`);
  if (s.jury) assert.equal(/A work-mailbox token is never drawn for a case about its own employer/.test(serving), s.sandbox && ownEmployerExcluded('mailbox') && !ownEmployerExcluded('sandbox'), `${name}: ${serving}`);
  // Practice seats: a seat-group sentence only with a limit, and the absence of a limit is disclosed with its consequence.
  assert.equal(/On a practice case|and on a practice case/.test(privacy), s.sandbox && seats.sandbox !== null, `${name}: practice seat group`);
  assert.equal(/Practice tokens have no seat limit, so one person holding several can fill several seats on a practice case/.test(serving), s.sandbox && seats.sandbox === null, `${name}: ${serving}`);
  assert.equal(/They have no seat limit, so one person can hold several seats on a practice case/.test(section(terms, 'jurors')), s.sandbox && seats.sandbox === null, name);
  if (communitySeats === 1 && s.jury) {
   assert.match(section(terms, 'jurors'), /count as one group whichever listing they name: together they fill at most one seat on a case, and those employers never count toward whether a jury can form/, name);
   assert.match(h2Section(privacy, 'jev'), /together they fill at most one seat on a case, and those employers never count toward whether a jury can form/, name);
   if (seats.mailbox !== null) assert.match(serving, /For a token of an employer added by the community, the hash is of the case and one group shared by all such tokens instead, so that together they fill at most one seat on a case/, name);
  }
  if (!ownEmployerExcluded('sandbox')) assert.doesNotMatch(privacy + terms, /other fictional employers/, `${name}: 0.6.0 exclusion wording`);
 }
 // A real-employer jury switched on that cannot form yet (the launch state) states the community rule too.
 for (const config of allConfigs().filter(c => on(c).juryPending)) {
  if (communitySeats !== 1) break;
  assert.match(h2Section(privacyPolicyHtml(config), 'jev'), /those employers never count toward whether a jury can form/, JSON.stringify(config));
  assert.match(section(termsHtml(config), 'jurors'), /those employers never count toward whether a jury can form/, JSON.stringify(config));
 }
 // The review copy counsel reads carries the same wording.
 const review = legalMarkdownFiles(reviewConfig()).map(f => f.content).join('\n');
 assert.doesNotMatch(review, /other fictional employers/);
 // Production has real-employer juries and no fictional employers: a juror never sits on a case about their own employer.
 assert.equal(/never a case about your token’s employer/.test(review), ownEmployerExcluded('mailbox'));
});

test('D14: the privacy policy says Global Privacy Control starts Live understanding off, as web/app.tsx does, and never that the signal does nothing', () => {
 const app = read('web/app.tsx');
 assert.match(app, /globalPrivacyControl!==true/, 'initialLive starts Live off under Global Privacy Control');
 assert.match(app, /if\(saved==='on'\)return true;if\(saved==='off'\)return false;/, 'a remembered choice takes precedence over the signal');
 for (const config of allConfigs()) {
  const privacy = privacyPolicyHtml(config), name = JSON.stringify(config), gpc = paragraph(privacy, 'Global Privacy Control');
  assert.doesNotMatch(privacy, /has nothing to opt you out of/, `${name}: contradicts the Search section`);
  assert.match(gpc, /when your browser sends it, Live understanding starts off/, name);
  assert.match(gpc, /If you switch Live understanding on or off yourself, that choice is remembered on your device and takes precedence/, name);
  assert.match(gpc, /The page reads the signal only in your browser/, name);
  assert.match(privacy, /it is on by default and starts off when your browser sends a Global Privacy Control signal/, `${name}: Search section`);
  assert.doesNotMatch(privacy, /turn on Live understanding/, `${name}: Live is on by default, so nobody has to turn it on`);
 }
});

test('RT-D1: the status line says a jury is switched on but cannot form, instead of calling it enabled', async () => {
 const {statusLine} = await import('../worker/src/pages.ts');
 const {employersNeeded} = await import('../shared/policy.ts');
 const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
 /** 'at least one fictional employer' / 'at least four other real employers', as staffable() in moderation.ts counts them. */
 const employers = (juryClass: 'sandbox' | 'mailbox', n: number) => `at least ${words[n]} ${ownEmployerExcluded(juryClass) ? 'other ' : ''}${juryClass === 'sandbox' ? 'fictional' : 'real'} employer${n === 1 ? '' : 's'}`;
 const configured = {...reviewConfig(), sampleEmployers: true, practiceJuriesEnabled: true, juryEnabled: false};
 const live = {juryEnabled: false, sandboxJuryEnabled: false, appealsEnabled: false, challengesEnabled: true, trusteeExceptionsEnabled: false, policyVersion: policy.version, policyDigest: 'x'};
 const none = statusLine(configured, live, null);
 assert.doesNotMatch(none, /enabled/, 'no switch is called enabled');
 assert.match(none, /Juries for real employers: off\./);
 assert.match(none, /Practice juries for the fictional demonstration employers: switched on, but no practice jury can form right now: a case needs juror keys of/);
 assert.ok(none.includes(`Appeals: none can form right now; an appeal needs juror keys of ${employers('sandbox', employersNeeded('sandbox', 'appeal'))}.`));
 // With both kinds switched on, each requirement keeps its own count, exclusion and grammar.
 const both = statusLine({...configured, juryEnabled: true}, live, {sandbox: {withKeys: 0, exist: 3}, mailbox: {withKeys: 2, exist: null}});
 assert.ok(both.includes(`an appeal needs juror keys of ${employers('mailbox', employersNeeded('mailbox', 'appeal'))}, or of ${employers('sandbox', employersNeeded('sandbox', 'appeal'))}.`), both);
 assert.ok(both.includes(`a case needs juror keys of ${employers('mailbox', employersNeeded('mailbox', 'initial'))} under the ${words[seatsPerEmployer('mailbox')!]}-seat limit, and two real employers publish them, counting the case’s own employer.`), both);
 if (!ownEmployerExcluded('sandbox')) {
  assert.ok(both.includes(`a case needs juror keys of ${employers('sandbox', employersNeeded('sandbox', 'initial'))}, and no fictional employer publishes them yet.`), both);
  assert.doesNotMatch(both, /other fictional employer/, 'policy 0.7.0: a practice jury may seat jurors of the case’s own fictional employer');
 }
 const noSamples = statusLine(configured, live, {sandbox: {withKeys: 0, exist: 0}, mailbox: {withKeys: 0, exist: null}});
 assert.match(noSamples, /and no fictional employer exists, so publishing more keys cannot change this until a fictional employer is added\./);
 const running = statusLine(configured, {...live, sandboxJuryEnabled: true, appealsEnabled: true}, null);
 assert.match(running, /switched on, and a practice jury can form right now\. Appeals: an appeal jury can form right now\./);
 const unknown = statusLine(configured, null, null);
 assert.match(unknown, /switched on\. Whether a practice jury can form right now is stated at <a href="\/api\/config">/);
 assert.doesNotMatch(unknown, /Appeals:/, 'without live status nothing is said about appeals');
 const off = statusLine({...configured, practiceJuriesEnabled: false}, live, null);
 assert.doesNotMatch(off, /Appeals:|switched on/);
 // Zero data (production): no fictional employers, so practice juries are not available rather than off or pending.
 const production = statusLine(reviewConfig(), {...live, juryEnabled: true, appealsEnabled: true}, null);
 assert.match(production, /Juries for real employers: switched on, and a real-employer jury can form right now\. Practice juries: not available, because this site shows no fictional demonstration employers\./);
 assert.doesNotMatch(production, /Practice juries for the fictional demonstration employers/);
});

test('policy 0.6.0: queued re-checks, one juror token set, /64 network keys and rounded counts are described as the code runs', async () => {
 // IPv6 clients are keyed by their /64 everywhere a per-network key is made.
 const {IPV6_PREFIX_GROUPS} = await import('../worker/src/network.ts');
 assert.equal(IPV6_PREFIX_GROUPS * 16, CODE_FACTS.ipv6PrefixBits);
 assert.match(read('worker/src/app.ts'), /siwt-limit-v1:\$\{scope\}:[^`]*\$\{requestClient\(request\)\}/, 'publisher limiter keys use the client network');
 assert.match(read('worker/src/app.ts'), /siwt-address-v1:\$\{requestClient\(request\)\}/, 'daily interest records use the client network');
 assert.match(read('worker/src/moderation.ts'), /siwt-address-v1:\$\{networkKey\(request\.headers\.get\('cf-connecting-ip'\)\)\}/, 'the challenge budget uses the client network');
 assert.match(read('worker/issuer.ts'), /const network=networkKey\(request\.headers\.get\('cf-connecting-ip'\)\)/, 'the verifier limiter uses the client network');
 const queued = typeof (policy.challenges as {queue?: unknown}).queue === 'string';
 if (queued) assert.match(read('worker/src/moderation.ts'), /INSERT OR IGNORE INTO challenge_queue\(id,public_id,rule_id,urgent,policy_version,policy_digest,relevance,period\)/, 'the queue stores no reason');
 const tokenSet = typeof (policy.jury as {tokens?: unknown}).tokens === 'string';
 if (tokenSet) assert.match(read('worker/issuer.ts'), /one set of up to \$\{JUROR_QUOTA\} juror tokens per employer each quarter/, 'the verifier email describes one set');
 for (const config of allConfigs()) {
  const s = on(config), name = JSON.stringify(config), privacy = privacyPolicyHtml(config), terms = termsHtml(config);
  if (s.challenges) {
   assert.equal(/try again later/.test(privacy + terms), !queued, `${name}: exhausted re-checks`);
   assert.equal(/it is queued with a receipt, and a scheduled job re-checks queued challenges/.test(privacy), queued, `${name}: queue described`);
   assert.equal(/Queued challenges: the account, the rule/.test(privacy), queued, `${name}: queue retention`);
   assert.match(privacy, /uses none of that daily budget|Challenges are limited per network|Cloudflare’s rate limiter limits challenges/, name);
  }
  if (s.practice) {
   assert.equal(/one set of up to 3 (?:juror )?tokens/.test(privacy + terms), tokenSet, `${name}: juror token set`);
   if (tokenSet) assert.doesNotMatch(privacy, /limits juror tokens to 3 per mailbox/, name);
  }
  assert.match(privacy, /For an IPv6 address, these keys use only its \/64 network prefix/, name);
 }
 const {trustPage} = await import('../worker/src/pages.ts');
 const {testEnv} = await import('./d1.ts');
 const html = await trustPage('moderation', testEnv().env, 'test');
 const text = (value: unknown) => typeof value === 'string' ? value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') : '';
 for (const value of [(policy as {publicStatistics?: string}).publicStatistics, (policy.challenges as {queue?: string}).queue, (policy.jury as {tokens?: string}).tokens, (policy.exceptions as {renewal?: string}).renewal]) if (value) assert.ok(html.includes(text(value)), value.slice(0, 60));
 assert.doesNotMatch(html, /updated by the scheduled job every 6 hours/);
});

// ---------------------------------------------------------------------------------------------------------------
// Public launch (owner decisions of 2026-09-23): version 1.2.0 of the legal pages, zero fictional data in production,
// real-employer publication in batches, employers added by the community, proof of work and the model-call budgets.
// ---------------------------------------------------------------------------------------------------------------

test('launch: legal version 1.2.0 takes effect on 2026-09-23, and review is recorded per version', () => {
 assert.equal(LEGAL_VERSION, '1.2.0');
 assert.equal(LEGAL_EFFECTIVE, '2026-09-23');
 assert.equal(LEGAL_FIRST_SERVED, '2026-09-22');
 const [current, previous] = LEGAL_CHANGELOG;
 assert.equal(current?.effective, LEGAL_EFFECTIVE);
 assert.equal(previous?.version, '1.1.0');
 assert.equal(previous?.effective, LEGAL_FIRST_SERVED, 'a published version keeps the date it took effect');
 for (const phrase of ['batches of at least five per employer', 'at least 25', 'Anyone can add an employer', 'proof-of-work', 'no longer has fictional sample employers', 'form only when enough jurors can serve'])
  assert.ok(current?.summary.includes(phrase), `the 1.2.0 history row mentions: ${phrase}`);
 // Counsel's approval is recorded for one exact version, so a later text change brings the draft notice back.
 assert.equal(LEGAL_REVIEWED, LEGAL_REVIEWED_VERSION === LEGAL_VERSION);
 assert.match(read('shared/brand.ts'), /export const LEGAL_REVIEWED: boolean = LEGAL_REVIEWED_VERSION === LEGAL_VERSION;/);
 // The review header says what the constant records, and never more: whose statement it rests on.
 const header = legalMarkdownFiles(reviewConfig())[0]!.content.split('\n# ')[0]!;
 if (LEGAL_REVIEWED) assert.match(header, /is recorded as approved by counsel \(LEGAL_REVIEWED_VERSION in shared\/brand\.ts, set on the owner’s statement\), so the live page carries no draft notice/);
 else assert.match(header, /\*\*Draft — pending attorney review\.\*\*/);
 assert.doesNotMatch(header, /Counsel reviewed this version/, 'the header states the record, not a review nobody here witnessed');
 // Until it is recorded, the review copies ask counsel about this version, including its one-day notice.
 const ids = legalOpenItems().map(item => item.id);
 assert.equal(ids.includes('counsel-review'), !LEGAL_REVIEWED);
 assert.equal(ids.includes('change-notice'), !LEGAL_REVIEWED);
 // The publication code keeps 1.1.0's promise itself: an account submitted before LEGAL_EFFECTIVE is batched only with
 // other such accounts, per employer, reporting period and verification type, at legacyBatchMin (at least 25).
 const submissions = read('worker/src/submissions.ts'), due = submissions.slice(submissions.indexOf('export async function publishDue'), submissions.indexOf('/** Most a batch'));
 assert.match(submissions, /const LEGACY_ROW='\(created_day IS NULL OR created_day<\?\)';/);
 assert.match(due, /GROUP BY company_id,verification_class,period HAVING COUNT\(\*\)>=\?`\)\.bind\(now,LEGAL_EFFECTIVE,legacyMin\)/, 'legacy groups need legacyMin, per employer, period and verification type');
 assert.match(due, /NOT \$\{LEGACY_ROW\}/, 'current batches never include a legacy account');
 assert.match(submissions, /export const legacyBatchMin=\(env:Pick<Env,'TESTIMONY_BATCH_MIN'>\)=>Math\.max\(policyVersions\['0\.7\.0'\]\.retention\.minimumBatch,policy\.retention\.legacyBatch\.minimumBatch,testimonyBatchMin\(env\)\);/);
 const legacy = (policy.retention as {legacyBatch?: {submittedBefore: string; minimumBatch: number}}).legacyBatch;
 assert.equal(legacy?.submittedBefore, LEGAL_EFFECTIVE, 'the policy restates the day publishDue applies');
 assert.equal(legacy?.minimumBatch, 25, 'legal 1.1.0 promised batches of at least 25');
 // So the notice question is for counsel only, and never blocks launch while the code keeps that batch.
 assert.deepEqual(legalLaunchBlockers().map(item => item.id), [], 'no launch blocker: contact mail arrives, and 1.1.0 contributions keep their batch in code');
 const notice = legalOpenItems().find(item => item.id === 'change-notice');
 if (notice) {
  assert.equal(notice.blocksLaunch, false);
  assert.match(notice.detail, /Contributions accepted under 1\.1\.0 keep the batch it promised: the publication code publishes an account submitted before September 23, 2026 only in a batch of at least 25 such accounts/);
 }
 // The pages say so wherever the batch is stated.
 for (const config of allConfigs()) {
  const privacy = privacyPolicyHtml(config), terms = termsHtml(config), name = JSON.stringify(config);
  const rule = `An account submitted before September 23, 2026, under the previous version of these documents, keeps the rule it was accepted under: it is published only in a batch of at least ${Math.max(25, config.testimonyBatch ?? 25)} accounts submitted before that day, for the same employer, reporting quarter and verification type, and never together with later accounts.`;
  assert.ok(h2Section(privacy, 'what-we-collect').includes(rule), `${name}: privacy`);
  assert.equal(h2Section(terms, 'service').includes(rule), !!config.realPublicationEnabled, `${name}: terms`);
 }
 assert.match(read('docs/operations.md'), /change-notice/, 'the runbook explains the item');
});

test('launch: the production review copy describes publication, juries, listings and proof of work as production runs them', async () => {
 const config = reviewConfig(), privacy = privacyPolicyHtml(config), terms = termsHtml(config), review = legalMarkdownFiles(config).map(f => f.content).join('\n');
 assert.doesNotMatch(privacy + terms, /Publication for real employers is paused/);
 assert.ok(terms.includes('only in a batch of at least 5 accepted accounts for the same employer and verification type'));
 assert.ok(privacy.includes('for groups with at least 25 published contributions, and each figure needs at least 25 answers'));
 assert.match(privacy, /A batch that small hides less than a large one/);
 assert.ok(terms.includes('There are no fictional or sample employers on the site.'));
 assert.doesNotMatch(privacy + terms, /fictional sample employers? (?:need|can be decided|have)|Sandbox credentials|practice jur/);
 assert.match(review, /practice juries for fictional employers not available/, 'the review header states the zero-data configuration');
 // Juries: switched on; the review copy is rendered for a jury that can form, and every promise names the condition.
 assert.match(privacy, /<strong>Human review\.<\/strong> A case held for a jury is decided by 7 randomly selected anonymous jurors[^.]*enough jurors of other employers can serve on that case/);
 // Listings: domain beside the name, community label, no endorsement, a correction route that never edits accounts.
 const listings = h2Section(terms, 'community-listings');
 assert.match(listings, /“Acme \(acme\.com\)”/);
 assert.match(listings, /says it was added by the community/);
 assert.match(listings, /A listing is not a statement by us about the employer, and we do not endorse it/);
 assert.match(listings, new RegExp(`email <a href="mailto:${CONTACT.legal}">`));
 assert.match(h2Section(terms, 'content-rules'), /When you add an employer, give the name the organization uses/);
 const adding = h2Section(privacy, 'adding-employers');
 assert.ok(adding.includes(`up to ${CODE_FACTS.employerNameMaxChars} characters`));
 assert.ok(adding.includes(`(${CODE_FACTS.dnsResolver})`));
 assert.ok(adding.includes(`at least ${Math.round(CODE_FACTS.domainPlausibility * 100)}% likely`));
 assert.match(adding, /A domain that is already listed, or whose parent domain is, cannot be listed again/);
 // Verification: accounts show the employer's domains as listed when read (evidence.ts attaches company.domains at read
 // time; no key id or domain is stored with a contribution), and a community-supplied domain, on a community listing or
 // attached to one of ours, proves control of that domain's mail only.
 assert.match(read('worker/src/evidence.ts'), /const domains=company\.domains;/);
 assert.doesNotMatch(read('worker/src/submissions.ts'), /key_id|keyId/, 'contributions record no key or domain; if they start to, show the author’s domain and change the text');
 assert.match(privacy, /readers see the domains listed for the employer when they read it, which are not necessarily the domain the author used/);
 assert.doesNotMatch(privacy + terms, /the mailbox was at one of them/);
 for (const html of [privacy, terms]) assert.match(html, /For an employer added by the community, or a domain someone added to one of our own listings, the domain was supplied by whoever added it/);
 assert.match(terms, /not that the domain belongs to the employer named/);
 // The attach rule as shared/domains.ts sharesSignificantToken applies it: an exact label, never a part of one.
 const {sharesSignificantToken} = await import('../shared/domains.ts');
 for (const domain of ['schwab.com', 'mail.schwab.com', 'charles-schwab.com']) assert.equal(sharesSignificantToken(domain, ['Charles Schwab']), true, domain);
 for (const domain of ['schwabmail.net', 'notschwab.net', 'schwab-careers.com', 'charles-schwab-corporate-email.com', 'schwab.attacker.com']) assert.equal(sharesSignificantToken(domain, ['Charles Schwab']), false, domain);
 assert.match(read('worker/src/community.ts'), /const attach=deterministicAttach&&check\.plausible!==null&&check\.plausible>=PLAUSIBLE_AT;/);
 assert.match(terms, /the domain’s own name is exactly a significant word of the employer’s name or of one of our known alternative names for it, or one of those names written as one word or with hyphens between its words/);
 assert.match(adding, /schwab\.com and charles-schwab\.com can be added to Charles Schwab, but schwabmail\.net, notschwab\.net, schwab-careers\.com, schwab\.attacker\.com or charles-schwab-corporate-email\.com cannot/);
 assert.doesNotMatch(privacy + terms, /shares a significant word/, 'the old, looser attach rule');
 // New listings: the domain carries the name, or Jev reads it as plausible at MATCH_AT; the other refusals exist in code.
 const community = read('worker/src/community.ts');
 assert.match(community, /if\(!carriesName&&!\(check\.plausible!==null&&check\.plausible>=MATCH_AT\)\)return json\(\{error:'domain_name_mismatch'\},422\);/);
 assert.match(community, /export const PLAUSIBLE_AT=\.85,NOT_A_NAME_AT=\.8,ABUSIVE_AT=\.5,MATCH_AT=\.3;/);
 assert.ok(adding.includes('Jev judges less than 30% likely to be the organization’s email domain are refused'));
 for (const code of ["return json({error:'name_already_listed',company:companyRef(sameName)},409)", "return json({error:'domain_belongs_to_listed',company:companyRef(claimed[0]!)},409)", "if(domainAbuseProblem(domain))return json({error:'domain_abusive'},422)", "if(check.domainAbusive>=ABUSIVE_AT)return json({error:'domain_abusive'},422)"]) assert.ok(community.includes(code), code);
 assert.match(adding, /a name with invisible characters or that mixes Latin, Cyrillic and Greek letters/);
 assert.match(adding, /each wider network \(an IPv4 \/24 or IPv6 \/48\) at most 15/);
 // Proof of work: in the browser, in a Web Worker, bound to the request, sending nothing about the person.
 assert.match(privacy, /solves a proof-of-work puzzle in a background thread \(a Web Worker\)/);
 assert.match(privacy, /starts with about 20 zero bits/);
 assert.match(privacy, /\['Proof-of-work answers'|<th scope="row">Proof-of-work answers<\/th><td>[^<]*<\/td><td>Not stored<\/td>/);
 // Budgets: listing checks are charged to the search budget (worker/inference-core.ts employerCheck).
 assert.match(read('worker/inference-core.ts'), /employerCheck[^]*?run\(env,'search'/);
 assert.ok(privacy.includes('45,000 calls for submitted searches and checks of new listings, 45,000 for Live understanding, 5,000 for screening, 4,000 for reading published accounts and 1,000 for challenge reasons'));
 // Live understanding stays on by default and starts off under Global Privacy Control.
 assert.match(privacy, /it is on by default and starts off when your browser sends a Global Privacy Control signal/);
});

test('launch: trust pages state the zero-data and publication settings of the deployment they are served from', async () => {
 const {trustPage, shellMeta} = await import('../worker/src/pages.ts');
 const {testEnv} = await import('./d1.ts');
 const {env: base} = testEnv();
 const production = {...base, SAMPLE_EMPLOYERS: 'off', REAL_PUBLICATION_ENABLED: 'true', TESTIMONY_BATCH_MIN: '5', JURY_ENABLED: 'true'} as typeof base;
 const transparency = await trustPage('transparency', production, 'test');
 assert.match(transparency, /Real-employer publication: enabled, with written accounts in batches of at least 5 per employer and verification type and survey figures for groups of at least 25\./);
 assert.match(transparency, /Fictional demonstration employers: none shown\./);
 assert.doesNotMatch(transparency, /Fictional sample employers have no cap/);
 assert.match(transparency, /<strong>Keys added after the release\.<\/strong>/);
 assert.match(transparency, /Practice juries: not available, because this site shows no fictional demonstration employers\./);
 const moderation = await trustPage('moderation', production, 'test');
 assert.doesNotMatch(moderation, /Seeded fictional sample accounts cannot be withheld/, 'no fixture rule where no fixtures are shown');
 // The policy's sandbox and practice sentences are annotated as not applying, and the practice count says why it stays put.
 const {NO_PRACTICE_NOTE, NO_PRACTICE_CASES} = await import('../worker/src/pages.ts');
 assert.ok(moderation.includes(`<p class="notice">${NO_PRACTICE_NOTE}</p>`), 'the practice note where no fictional employers are shown');
 if (/<th scope="row">Practice<\/th>/.test(moderation)) assert.ok(moderation.includes(NO_PRACTICE_CASES), 'the practice count definition');
 const local = await trustPage('moderation', {...base, SAMPLE_EMPLOYERS: 'on'} as typeof base, 'test');
 assert.ok(!local.includes(NO_PRACTICE_NOTE) && !local.includes(NO_PRACTICE_CASES), 'no such note where the fictional employers are shown');
 // Listing closed: the page names every requirement of community.ts listingOpen, not just two of them.
 assert.match(transparency, /Adding employers: closed\. It opens only while the main worker has the verifier and inference service bindings, the internal secret it shares with the verifier and the rate-limit secret, and one of them is missing\./);
 const listingOpenSource = read('worker/src/community.ts').match(/export const listingOpen=[^\n]*/)?.[0] ?? '';
 for (const requirement of ['env.VERIFIER', 'env.INTERNAL_TOKEN', 'env.INFERENCE', 'env.RATE_LIMIT_SECRET']) assert.ok(listingOpenSource.includes(requirement), `listingOpen still requires ${requirement}; keep the transparency page’s list in step`);
 const open = await trustPage('transparency', {...production, VERIFIER: {fetch: async () => new Response('{}')}, INFERENCE: {fetch: async () => new Response('{}')}, INTERNAL_TOKEN: 'x'.repeat(32), RATE_LIMIT_SECRET: 'x'} as unknown as typeof base, 'test');
 assert.match(open, /Adding employers: open to anyone\./);
 // Open Graph: a fictional employer is never described where fictional employers are hidden; a real employer's empty
 // record states the batch and survey minimums from the same functions publication uses.
 const hidden = await shellMeta(production, '/c/northwind-labs', new URLSearchParams());
 assert.doesNotMatch(hidden.title + hidden.description, /Northwind|fictional/);
 const shown = await shellMeta({...base, SAMPLE_EMPLOYERS: 'on'} as typeof base, '/c/northwind-labs', new URLSearchParams());
 assert.match(shown.title, /Northwind Labs \(fictional demonstration\)/);
 const stripe = await shellMeta(production, '/c/stripe', new URLSearchParams());
 if (stripe.title.startsWith('Stripe')) assert.match(stripe.description, /Written accounts appear in batches of at least 5 verified contributions, after screening and a random delay; survey figures need 25\./);
});

test('launch: the publisher checks credentials without contacting the verifier, and community keys are described as copied', () => {
 // The code: credentials.ts reads only the publisher's own trusted_issuers; community keys are copied at registration
 // (addEmployer) and by the scheduled job (communityHousekeeping), never when a credential arrives.
 const credentials = read('worker/src/credentials.ts'), community = read('worker/src/community.ts');
 assert.doesNotMatch(credentials, /env\.VERIFIER|VERIFIER\.fetch|syncCommunityKeys|registerWithVerifier/, 'checking a credential never reaches the verifier');
 assert.doesNotMatch(community, /syncForKeyId/);
 const callers = [...community.matchAll(/syncCommunityKeys\(env\)/g)].length;
 assert.ok(callers >= 1 && /export async function communityHousekeeping[^]*syncCommunityKeys\(env\)/.test(community), 'the scheduled job copies community keys');
 assert.match(read('worker/src/app.ts'), /communityHousekeeping/, 'the scheduled job runs it');
 for (const config of allConfigs()) {
  const privacy = privacyPolicyHtml(config), name = JSON.stringify(config);
  assert.match(privacy, /The publisher never contacts the verifier to check a credential: it checks the signature against the copy of the key it already holds/, name);
  assert.doesNotMatch(privacy, /fetches the verifier’s public key list|with one exception: when a credential names/, name);
 }
 for (const doc of ['docs/threat-model.md', 'docs/protocol-poewi.md', 'docs/hardening-roadmap.md', 'README.md']) assert.doesNotMatch(read(doc), /syncForKeyId|fetches the verifier's `\/keys` (?:once )?at that moment/, `${doc} describes a key fetch the code no longer makes`);
});

test('launch: daily email limits for community employers and takedown records are disclosed as the verifier applies them', async () => {
 const {COMMUNITY_EMAIL_LIMITS} = await import('../shared/proof.ts');
 const issuer = read('worker/issuer.ts');
 // The code: a community key's /start spends the employer's and the shared daily budget; over it the reply is the same.
 assert.match(issuer, /spend\(slug,COMMUNITY_EMAIL_LIMITS\.perEmployerPerDay\)\)\s*&&\s*!!\(await spend\('\*',COMMUNITY_EMAIL_LIMITS\.allCommunityPerDay\)\)/);
 assert.match(issuer, /const send=\(recent\?\.n\?\?0\)<3 && \(source!=='community' \|\| await communityEmailAllowed\(env,key\.companySlug,now\)\);/);
 assert.match(issuer, /DELETE FROM email_budget WHERE day<\?'\)\.bind\(new Date\(date\.getTime\(\)-86400000\)/, 'email counts are kept for today and yesterday only');
 assert.match(issuer, /INSERT INTO withdrawn_employers\(company_slug,domain,withdrawn_quarter\)/, 'a takedown records the slug, the domain and the quarter');
 assert.match(issuer, /FROM withdrawn_employers WHERE company_slug=\? OR domain=\?/, 'a withdrawn slug or domain cannot be registered again');
 assert.match(issuer, /DELETE FROM issuer_keys WHERE company_slug=\? AND source='community'/, 'a takedown deletes the community keys at once');
 const migration = read('db/verifier-migrations/0006_community_email_budget_and_withdrawals.sql');
 assert.match(migration, /CREATE TABLE IF NOT EXISTS email_budget \(\s*day TEXT NOT NULL,\s*scope TEXT NOT NULL,\s*sent INTEGER/, 'the email budget holds a day, a scope and a count');
 assert.match(migration, /CREATE TABLE IF NOT EXISTS withdrawn_employers \(\s*company_slug TEXT PRIMARY KEY,\s*domain TEXT,\s*withdrawn_quarter TEXT NOT NULL\s*\)/, 'a takedown record holds nothing about a person');
 const per = String(COMMUNITY_EMAIL_LIMITS.perEmployerPerDay).replace(/\B(?=(\d{3})+(?!\d))/g, ','), all = String(COMMUNITY_EMAIL_LIMITS.allCommunityPerDay).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
 for (const config of allConfigs()) {
  const privacy = privacyPolicyHtml(config), terms = termsHtml(config), name = JSON.stringify(config);
  const email = /<strong>What the email reveals\.<\/strong>([^<]*)/.exec(privacy)?.[1] ?? '';
  assert.ok(email.includes(`at most ${per} verification emails per UTC day for that employer, and ${all} per UTC day for all such employers together; over either limit, a request is answered in the same way and no email is sent, so anyone can use up an employer’s emails for the day, and a code requested after that may not arrive until the next UTC day`), `${name}: email limits`);
  assert.ok(h2Section(terms, 'community-listings').includes(`Verification emails for a domain added by the community are limited to ${per} per UTC day for that employer and ${all} per UTC day for all such employers together`), `${name}: terms email limits`);
  assert.match(h2Section(terms, 'verification'), /a code may not arrive until the next UTC day/, `${name}: verification section`);
  assert.match(privacy, /<th scope="row">Daily counts of verification emails sent for employers added by the community, per employer and in total \(no mailbox or address\)<\/th><td>Verifier database<\/td><td>Kept for the current and the previous UTC day/, `${name}: email count retention`);
  assert.match(privacy, /<th scope="row">Record of a listing whose domain was taken down after a correction: its page identifier, the domain and the quarter \(nothing about any person\)<\/th><td>Verifier database<\/td><td>No fixed limit/, `${name}: takedown retention`);
  assert.match(h2Section(privacy, 'adding-employers'), /the verifier keeps a record of the listing’s page identifier, the domain and the quarter so that they cannot be registered again/, name);
  assert.match(h2Section(terms, 'community-listings'), /Detaching a domain first takes it down at the verifier, which deletes the signing keys created for it, so no new credentials are issued for it, and keeps a record of the listing and the domain so that neither can be registered again/, name);
  // Keys are created at registration and for each new quarter (issuer.ts ensureCommunityKeys, ensureRegisteredKeys).
  assert.match(privacy, /When such a domain is registered, and again for each new quarter, the verifier creates that employer’s contribution and juror signing keys/, name);
 }
 assert.match(issuer, /try \{ await ensureCommunityKeys\(env,slug,domain,now\); \}/, 'keys are created at registration');
 assert.match(issuer, /await ensureRegisteredKeys\(env,date\)/, 'and by the scheduled job for a new quarter');
});

test('launch: listing corrections are described as the operator route, the verifier takedown and the public log apply them', async () => {
 // The code: POST /api/directory/correct needs ADMIN_TOKEN, renames, detaches or withdraws only what the community added,
 // withdraws only a listing with nothing published or waiting, takes the domain down at the verifier first, deletes the
 // publisher's key copies, and appends to the append-only public log; credentials.ts serves and accepts a community key
 // only while its employer has a registered community domain.
 const app = read('worker/src/app.ts'), community = read('worker/src/community.ts'), credentials = read('worker/src/credentials.ts');
 assert.match(app, /path==='\/api\/directory\/correct'&&request\.method==='POST'\) \{\n\s*if\(!await operator\(request,env\)\)return json\(\{error:'unauthorized'\},401\);/);
 assert.match(community, /if\(action==='rename'\) \{\n\s*if\(company\.origin!=='community'\)return \{status:409,body:\{error:'curated_listing'\}\};/);
 assert.match(community, /if\(await env\.INTAKE\.prepare\("SELECT 1 AS found FROM submissions WHERE company_id=\? AND status IN \('held','approved','publishing','published'\) LIMIT 1"\)/);
 assert.match(community, /const outcome=await withdrawAtVerifier\(env,slug\);/);
 assert.match(community, /env\.DB\.prepare\("DELETE FROM trusted_issuers WHERE company_slug=\? AND source='community'"\)\.bind\(slug\)/);
 assert.match(community, /await logCorrection\(env,g\.slug,'detach','verifier_withdrawn'\)/, 'a takedown made at the verifier is mirrored and logged');
 assert.match(credentials, /COALESCE\(t\.source,'curated'\)<>'community' OR EXISTS\(SELECT 1 FROM employer_domains d JOIN companies c ON c\.id=d\.company_id WHERE c\.slug=t\.company_slug AND d\.source='community' AND d\.registered=1\)/);
 const migration = read('db/migrations/0011_listing_corrections.sql');
 assert.match(migration, /CREATE TABLE IF NOT EXISTS listing_corrections \(\s*id TEXT PRIMARY KEY,\s*period TEXT NOT NULL,\s*action TEXT NOT NULL CHECK \(action IN \([^)]*\)\),\s*reason TEXT NOT NULL CHECK \(reason IN \([^)]*\)\),\s*target_digest TEXT NOT NULL\s*\);/, 'the log holds a kind, a reason, a quarter and a digest only');
 assert.match(migration, /BEFORE UPDATE ON listing_corrections BEGIN SELECT RAISE\(ABORT, 'append_only'\)/);
 assert.match(migration, /BEFORE DELETE ON listing_corrections BEGIN SELECT RAISE\(ABORT, 'append_only'\)/);
 for (const config of allConfigs()) {
  const privacy = privacyPolicyHtml(config), terms = termsHtml(config), name = JSON.stringify(config), listings = h2Section(terms, 'community-listings');
  assert.match(listings, /A person reviews each request, and only a person applies a correction: through a route that only we can use, with our administrator key, or by taking a domain down directly at the verifier/, name);
  assert.match(listings, /remove a community listing altogether, but only while nothing about it is published, held or waiting to be published/, name);
  assert.match(listings, /credentials issued with them and not yet used are no longer accepted/, name);
  assert.match(listings, /<a href="\/transparency#listing-corrections">transparency page<\/a>, with the kind of correction, the reason, the quarter and a digest of the listing’s page identifier, never its name or who asked/, name);
  assert.match(privacy, /<th scope="row">Public log of listing corrections: the kind of correction, the reason, the quarter and a digest of the listing’s page identifier \(no name, requester or text\)<\/th><td>Public database<\/td><td>Kept as a permanent public record; entries cannot be changed or deleted<\/td>/, name);
 }
 // The transparency page renders the log the terms point to, with its own anchor.
 const {trustPage} = await import('../worker/src/pages.ts');
 const {testEnv} = await import('./d1.ts');
 const {env, publicDb} = testEnv();
 const empty = await trustPage('transparency', env, 'test');
 assert.match(empty, /<h2 id="listing-corrections">Listing corrections<\/h2>/);
 assert.match(empty, /No listing has been corrected\./);
 publicDb.db.prepare("INSERT INTO listing_corrections(id,period,action,reason,target_digest) VALUES('lc_test','2026-Q3','detach','wrong_domain','digestvalue')").run();
 const logged = await trustPage('transparency', env, 'test');
 assert.match(logged, /<th scope="row">2026-Q3<\/th><td>Community-added domain detached<\/td><td>The domain is not the employer’s<\/td><td><code>digestvalue<\/code><\/td>/);
});
