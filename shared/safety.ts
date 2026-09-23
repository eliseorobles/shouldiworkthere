/**
 * Crisis-language check for the search composer and the contribution editor.
 *
 * Deterministic and on-device: a fixed phrase lexicon (English, plus a few Spanish phrases) matched with regular
 * expressions. This module imports nothing, performs no network or storage access, and logs nothing. A match only lets
 * the interface show a calm resource card to the person typing. It never blocks, edits, reports or scores the text,
 * it is not a moderation signal, and its result must not be stored or sent anywhere.
 *
 * It is not a risk assessment. It will miss many ways people describe distress, and it deliberately ignores common
 * workplace idioms ("killing it", "the deadline is killing me", "layoffs killed morale", "kill the project",
 * "shoot me an email", "career suicide", "killing myself for this company"). A self-harm phrase shows the card even
 * inside a comparison ("I'd rather kill myself than …", "I'd rather be dead than …", "I'd rather jump off a bridge
 * than …"), whatever follows "than": the card is gentle and never blocks, so a false positive costs little and a false
 * negative costs a lot.
 *
 * The same lexicon may also run on the publisher (CRISIS_RESOURCES_ENABLED) on text the person sends; that reply carries
 * resources, and the interface shows them with CRISIS_COPY.serverPrivacy, never with the on-device privacy line.
 */

export type CrisisKind = 'self_harm' | 'danger';
/** `about: 'someone_else'` marks self-harm language about another person ("my coworker threatened to kill himself"). */
export interface CrisisMatch {kind: CrisisKind; excerpt: string; about?: 'someone_else';}

/**
 * True: web/ renders the on-device crisis card in both the search composer (web/canvas/composer.tsx) and the
 * contribution editor (web/submit.tsx). The privacy policy describes the card only while this is true, and
 * tests/safety.test.ts checks that web/ imports this module whenever it is.
 */
export const CRISIS_CARD_ENABLED = true;

const SELF = String.raw`my\s*self`;
const OTHER_SELF = String.raw`(?:him|her|them)sel(?:f|ves)`;
// Effort idioms: "killing myself for this company", "killing myself trying to hit quota".
const EFFORT = String.raw`(?:for\s+(?:(?:this|that|the|a|my|our|their|his|her)\s+(?:company|job|team|role|project|boss|manager|org|client|clients|customers|startup|quarter|deadline|launch|release|place|firm|business|promotion|raise|bonus|paycheck|salary|product)|nothing|peanuts|them|years|months|weeks)|trying|working|over\s+(?:this|that|the)\s+(?:project|deadline|launch|release|quarter|job)|to\s+(?:make|get|hit|meet|finish|deliver|keep|ship|prove|please)|getting|making|hitting|meeting|finishing|delivering|laughing|at\s+(?:work|the\s+gym))`;
// Words that may sit between "myself" and an effort idiom: "I kill myself every quarter to hit quota".
const FILLER = String.raw`(?:\s+(?:every|each|single|all|day|days|night|nights|week|weeks|month|months|quarter|quarters|year|years|sprint|sprints|shift|shifts|literally|basically|just|really|daily|nightly|weekly|constantly|practically|already|again|lately|always|so|hard|here))`;
const NOT_EFFORT = String.raw`(?!${FILLER}{0,4}\s+${EFFORT}\b)`;
// Only for the progressive form: "killing myself at this job".
const NOT_PROGRESSIVE_EFFORT = String.raw`(?!${FILLER}{0,4}\s+at\s+(?:this|that|my|the|our)\s+(?:job|company|place|office|firm|startup)\b)`;
// Workplace injuries are not self-harm: "I keep hurting myself lifting boxes on the line".
const INJURY = String.raw`(?:off|out|some\s+slack|a\s+break|short|on|at|lifting|carrying|moving|with|while|when|using|operating|during|in\s+(?:a|the)\s+(?:fall|accident))`;
const DIE_IDIOMS = String.raw`(?:(?:of|from)\s+(?:embarrassment|shame|boredom|laughter|laughing|cringe)|on\s+(?:this|that|a|the)\s+hill|laughing|inside|on\s+the\s+inside|a\s+little)`;
const PERSON = String.raw`(?:him|her|them|you|y'all|everyone|everybody|someone|somebody|people|(?:all|each)\s+of\s+(?:them|you)|coworkers|co-workers|colleagues|(?:my|the|our|that|this|his|her|their)\s+(?:boss|manager|supervisor|director|co-?workers?|colleagues?|team(?:mates?)?|lead|ceo|founder|vp|hr\s+(?:rep|person|manager)|recruiter|employees|staff|whole\s+(?:team|office|department)))`;
const TARGET = String.raw`(?:me|us|my\s+family|${PERSON})`;
// "kill them with kindness", "attack my manager's proposal".
const NOT_HARM = String.raw`(?!'s\b|\s+with\s+kindness\b|\s+(?:an?\s+|a\s+quick\s+|over\s+)?(?:e-?mail|message|note|text|dm|line|invite|reminder|ping|slack|chat|question|link)s?\b)`;
// "shoot you a meeting invite", "shoot everyone a quick recap", "shoot them the deck".
const NOT_SENDING = String.raw`(?!'s\b|\s+(?:all\s+)?(?:an?|the|some|over|back|across|along|my|our|your)\b|\s+(?:quick\s+)?(?:e-?mail|message|note|text|dm|line|invite|reminder|ping|slack|chat|question|link|update|recap|summary)s?\b)`;
const HARM_VERB = String.raw`(?:kill|stab|murder|strangle|choke|beat\s+up|attack|hurt|poison)`;
const harmOn = (target: string) => String.raw`(?:${HARM_VERB}\s+${target}\b${NOT_HARM}|shoot\s+${target}\b${NOT_SENDING})`;
const I_INTEND = String.raw`\bi(?:'ll|'m\s+(?:going|gonna|planning|about)|\s+am\s+(?:going|gonna|planning|about)|\s+(?:will|want|wanna|plan|intend|swear\s+i'll|swear\s+i\s+will))\s+(?:to\s+)?`;
const WEAPON = String.raw`(?:gun|firearm|knife|weapon|rifle|pistol)`;
const PLACE = String.raw`(?:work|the\s+(?:office|building|warehouse|site|store|plant|meeting|floor|workplace))`;
const NEGATED = String.raw`(?<!\b(?:don't|do\s+not|didn't|did\s+not|never|not)\s+)`;
// A subject between "I" and "want to die" means someone else: "I had a patient who wanted to die at home".
const OWN_GAP = String.raw`(?:(?!\b(?:who|which|he|she|they|people|patients?|clients?|residents?|customers?|someone|somebody|everyone|everybody|nobody)\b)[^.!?\n]){0,30}?`;
const NOT_LIFE = String.raw`(?!'s\b|\s+(?:back|savings|insurance|story|stories|work|in\s+(?:a\s+)?(?:new|different)|into\s+my\s+own\s+hands|in\s+my\s+(?:own\s+)?hands)\b)`;
const NOT_OD = String.raw`(?!\s+on\s+(?:coffee|caffeine|espresso|sugar|energy\s+drinks|meetings|work|slack|e-?mails?|zoom|powerpoint|jargon|buzzwords)\b)`;
const INTENT = String.raw`(?:want(?:ed|s)?|wanna|urges?|tempted|thinking\s+(?:about|of)|thought\s+(?:about|of)|going|gonna|started|start|keep|kept|been|plan(?:ning|ned|s)?|tried|trying|try)`;
const SPANISH_NOT = String.raw`(?!\s+(?:trabajando|a\s+trabajar|estudiando|por\s+(?:el|este|mi|la|esta)\s+(?:trabajo|empresa|chamba|jefe|jefa)|de\s+(?:verg[üu]enza|risa|aburrimiento|pena)|en|aqu[ií]|ah[ií]|all[ií]|con|cerca|lejos)(?![a-záéíóúñ]))`;

type Rule = {kind: CrisisKind; pattern: RegExp; about?: 'someone_else'};
const rule = (kind: CrisisKind, source: string, about?: 'someone_else'): Rule => ({kind, pattern: new RegExp(source, 'gi'), ...(about ? {about} : {})});

const RULES: readonly Rule[] = [
 // Imminent danger to others, or to the writer from others.
 rule('danger', `${I_INTEND}${harmOn(PERSON)}`),
 rule('danger', String.raw`\b(?:threaten(?:ed|ing|s)?|(?:said|says|told\s+me)\s+(?:he|she|they)\s+(?:would|will|'d|was\s+going|were\s+going|is\s+going|are\s+going))\s+(?:to\s+)?${harmOn(TARGET)}`),
 rule('danger', String.raw`\b(?:pulled|pulling|pointed|pointing|waved|waving|drew)\s+(?:a|his|her|their)\s+${WEAPON}\b`),
 rule('danger', String.raw`\b(?:brought|bring|bringing)\s+(?:a|his|her|their)\s+(?:gun|firearm|rifle|pistol|weapon)\s+(?:to|into)\s+${PLACE}\b`),
 rule('danger', String.raw`\bshoot(?:ing)?\s+up\s+(?:the|this|our)\s+(?:office|building|place|workplace|warehouse|school|company|meeting|floor|plant|store)\b`),
 rule('danger', String.raw`\b(?:bomb|blow\s+up)\s+(?:the|this|our)\s+(?:office|building|workplace|warehouse|plant|store)\b`),
 // Suicidal ideation and self-harm about someone else ("my coworker threatened to kill himself").
 rule('self_harm', String.raw`\b(?:kill|kills|killed|killing)\s+${OTHER_SELF}\b${NOT_EFFORT}${NOT_PROGRESSIVE_EFFORT}`, 'someone_else'),
 rule('self_harm', String.raw`\b(?:threaten(?:ed|ing|s)?|${INTENT}|talk(?:s|ed|ing)?\s+about)\s+(?:to\s+)?(?:hurt|hurting|harm|harming|cut|cutting)\s+${OTHER_SELF}\b(?!\s+${INJURY}\b)`, 'someone_else'),
 rule('self_harm', String.raw`\b(?:take|taking|took|end|ending|ended)\s+(?:his|her|their)\s+own\s+life\b`, 'someone_else'),
 // Suicidal ideation and self-harm.
 rule('self_harm', String.raw`\b(?:kill|killed)\s+${SELF}\b${NOT_EFFORT}`),
 rule('self_harm', String.raw`\bkilling\s+${SELF}\b${NOT_EFFORT}${NOT_PROGRESSIVE_EFFORT}`),
 rule('self_harm', String.raw`\b(?:end|ending|ended|take|taking)\s+my\s+(?:own\s+)?life\b${NOT_LIFE}`),
 rule('self_harm', String.raw`\bi\s+(?:[a-z']+\s+){0,2}?took\s+my\s+(?:own\s+)?life\b${NOT_LIFE}`),
 rule('self_harm', String.raw`(?<!\b(?:career|political|professional|commercial|social|financial|corporate|reputational|brand)[\s-])\bsuicid(?:e|es|al|ality)\b(?!\s*(?:mission|missions|squad|door|doors|run|runs|drill|drills|prevention|awareness|(?:&|and)\s*crisis)\b)`),
 rule('self_harm', String.raw`\bi(?:'m|'ve|'d|\s+am|\s+have|\s+had)?\b${OWN_GAP}${NEGATED}\b(?:want(?:ed)?|wanna|wish(?:ed)?)\s+(?:to\s+)?die\b(?!\s+${DIE_IDIOMS})`),
 rule('self_harm', String.raw`\bwish(?:ed)?\s+i\s+(?:could|would|'d|was\s+going\s+to)\s+die\b(?!\s+${DIE_IDIOMS})`),
 rule('self_harm', String.raw`\bhope\s+i\s+(?:die|(?:don't|do\s+not|never)\s+wake\s+up)\b(?!\s+(?:${DIE_IDIOMS}|at|for|before|until|late|early|in\s+time)\b)`),
 rule('self_harm', String.raw`${NEGATED}\bwant(?:ed)?\s+to\s+be\s+dead\b`),
 rule('self_harm', String.raw`\b(?:wish(?:ed)?\s+i\s+(?:was|were)\s+dead|better\s+off\s+dead|rather\s+be\s+dead|better\s+off\s+if\s+i\s+(?:was|were)\s+dead|wish(?:ed)?\s+i\s+(?:had\s+)?never\s+been\s+born)\b`),
 rule('self_harm', String.raw`\b(?:everyone|everybody|my\s+(?:family|kids|children|wife|husband|partner)|the\s+world|they|people)\s+(?:would(?:\s+all)?\s+be|'d(?:\s+all)?\s+be|will\s+be|are|is)\s+better\s+off\s+without\s+me\b(?!\s+(?:on|in|at|as)\b)`),
 rule('self_harm', String.raw`\b(?:don't|do\s+not|didn't|did\s+not|no\s+longer)\s+want\s+to\s+(?:(?:be\s+alive|exist)(?:\s+anymore)?|live\s+anymore|keep\s+living|go\s+on\s+living)\b`),
 rule('self_harm', String.raw`\b(?:can't|cannot|can\s+not)\s+go\s+on\s+(?:anymore|any\s+longer)\b(?!\s+(?:with|at|in|working|doing|like)\b)`),
 rule('self_harm', String.raw`\b(?:no\s+reason\s+to\s+(?:live|go\s+on)|nothing\s+(?:left\s+)?to\s+live\s+for|(?:not|isn't|ain't)\s+worth\s+living|no\s+point\s+(?:in\s+)?(?:living|being\s+alive))\b`),
 rule('self_harm', String.raw`\bself[\s-]?(?:harm(?:ing|ed)?|injur(?:y|ing|e|ed))\b`),
 rule('self_harm', String.raw`\b(?:harm|harming|harmed)\s+${SELF}\b`),
 rule('self_harm', String.raw`\b${INTENT}\s+(?:to\s+)?hurt(?:ing)?\s+${SELF}\b(?!\s+${INJURY}\b)`),
 rule('self_harm', String.raw`\b${INTENT}\s+(?:to\s+)?(?:cut(?:ting)?|burn(?:ing)?)\s+${SELF}\b(?!\s+(?:off|out|some\s+slack|a\s+break|short|loose|free|on\s+(?:a|the))\b)`),
 rule('self_harm', String.raw`(?<!\brope\s+to\s)\b(?:hang|hanging|shoot|shooting|drown|drowning)\s+${SELF}\b(?!\s+in\s+the\s+foot\b)`),
 rule('self_harm', String.raw`\b(?:jump|jumping)\s+(?:off|from)\s+(?:a|the|my)\s+(?:bridge|building|roof|balcony|ledge|cliff)\b`),
 rule('self_harm', String.raw`\b(?:jump|jumping|step|stepping|throw\s+${SELF}|throwing\s+${SELF})\s+in\s+front\s+of\s+(?:a|the)\s+(?:train|bus|truck|car|subway)\b`),
 rule('self_harm', String.raw`\b(?:took|take|taking|thinking\s+about|thought\s+about)\s+an\s+overdose\b|\boverdos(?:e|ed|ing)\s+on\s+(?:pills|my\s+(?:meds|medication|pills))\b`),
 rule('self_harm', String.raw`\b(?:tried|trying|try|want(?:ed)?|wanna|going|gonna|plan(?:ning|ned)?|thinking\s+about|thought\s+about|about)\s+(?:to\s+)?overdos(?:e|ing)\b${NOT_OD}|\boverdosed\b${NOT_OD}`),
 rule('self_harm', String.raw`\bend(?:ing)?\s+it\s+all\b|\b(?:go\s+to\s+sleep|fall\s+asleep)\s+and\s+(?:never|not)\s+wake\s+up\b`),
 rule('self_harm', String.raw`(?:\bme\s+(?:quiero|voy\s+a)\s+(?:suicidar|matar)|\bsuicidarme|\bmatarme|\bquitarme\s+la\s+vida|\bme\s+quiero\s+morir|\bquiero\s+morir(?:me)?|\bno\s+quiero\s+vivir)(?![a-záéíóúñ])${SPANISH_NOT}`),
];

const MAX_SCAN = 20000, MAX_EXCERPT = 120;

/**
 * Returns the first crisis phrase found, or null. Danger to others (or to the writer from others) is reported before
 * self-harm when both appear, because emergency services come first in that card. The excerpt is the matched phrase
 * exactly as typed. Pure function: nothing is stored, sent or logged.
 */
export function detectCrisis(text: string): CrisisMatch | null {
 if (typeof text !== 'string' || !text.trim()) return null;
 const source = text.slice(0, MAX_SCAN);
 // Same-length substitutions only, so match offsets still point into the original text.
 const normalized = source.replace(/[‘’ʼ`]/g, "'").replace(/[‐‑‒–]/g, '-');
 for (const kind of ['danger', 'self_harm'] as const) {
  let best: {index: number; length: number; about?: 'someone_else'} | null = null;
  for (const {kind: ruleKind, pattern, about} of RULES) {
   if (ruleKind !== kind) continue;
   // The first match of each rule is enough: a later one can never start earlier.
   pattern.lastIndex = 0;
   const match = pattern.exec(normalized);
   pattern.lastIndex = 0;
   if (match && (!best || match.index < best.index)) best = {index: match.index, length: match[0].length, ...(about ? {about} : {})};
  }
  if (best) return {kind, excerpt: source.slice(best.index, best.index + best.length).trim().slice(0, MAX_EXCERPT), ...(best.about ? {about: best.about} : {})};
 }
 return null;
}

export interface CrisisResource {
 id: 'emergency' | '988' | 'findahelpline';
 region: 'Everywhere' | 'United States' | 'Outside the United States';
 name: string;
 detail: string;
 links: ReadonlyArray<{label: string; href: string}>;
}

/** Support resources shown by the crisis card. Plain data: rendering them sends nothing. */
export const CRISIS_RESOURCES: Readonly<Record<CrisisResource['id'], CrisisResource>> = {
 emergency: {
  id: 'emergency',
  region: 'Everywhere',
  name: 'Emergency services',
  detail: 'If you or someone else is in immediate danger, call your local emergency number now: 911 in the United States and Canada, 112 in the European Union and many other countries.',
  links: [{label: 'Call 911 (US and Canada)', href: 'tel:911'}, {label: 'Call 112 (EU and many other countries)', href: 'tel:112'}],
 },
 '988': {
  id: '988',
  region: 'United States',
  name: '988 Suicide & Crisis Lifeline',
  detail: 'Free and confidential, 24 hours a day. Call or text 988, or chat at 988lifeline.org. You can also contact it if you are worried about someone else.',
  links: [{label: 'Call 988', href: 'tel:988'}, {label: 'Text 988', href: 'sms:988'}, {label: 'Chat at 988lifeline.org', href: 'https://988lifeline.org'}],
 },
 findahelpline: {
  id: 'findahelpline',
  region: 'Outside the United States',
  name: 'Find A Helpline',
  detail: 'Find a free, confidential helpline in your country at findahelpline.com.',
  links: [{label: 'findahelpline.com', href: 'https://findahelpline.com'}],
 },
};

/**
 * Calm wording for the card. `privacy` is exact for the on-device check only: it runs on this device and has no other
 * effect. `server` and `serverPrivacy` are for resources that a server reply carried (the publisher's phrase check when
 * CRISIS_RESOURCES_ENABLED is set, or Jev's optional self-harm answer during screening when SELF_HARM_SCREENING is set):
 * that text did reach the server, so the on-device line would be false there.
 */
export const CRISIS_COPY: Readonly<Record<CrisisKind | 'someone_else' | 'server', {heading: string; body: string}> & {privacy: string; serverPrivacy: string}> = {
 self_harm: {
  heading: 'You don’t have to go through this alone.',
  body: 'If you are thinking about suicide or hurting yourself, you can talk to someone right now.',
 },
 someone_else: {
  heading: 'If you are worried about someone, you can get support too.',
  body: 'Crisis lines also help people who are worried about someone else. If they may be in immediate danger, contact emergency services.',
 },
 danger: {
  heading: 'If someone is in danger, get help now.',
  body: 'If you or someone else could be hurt, contact emergency services first.',
 },
 server: {
  heading: 'Support is here if you need it.',
  body: 'If you are thinking about suicide or hurting yourself, or someone could be in danger, you can talk to someone right now.',
 },
 privacy: 'This note comes from a check that runs only on this device. Nothing about it is stored, sent or reported, and it does not change what you can write or submit.',
 serverPrivacy: 'This note was added by a check of the text you sent to our server. We do not store, log or report anything about it, and it does not affect screening, publication or search results.',
};

/** The heading and body for a match. */
export function crisisCopyFor(match: CrisisMatch): {heading: string; body: string} {
 return match.kind === 'danger' ? CRISIS_COPY.danger : match.about === 'someone_else' ? CRISIS_COPY.someone_else : CRISIS_COPY.self_harm;
}

/** Resources in the order the card shows them: emergency services first when someone may be in danger. */
export function crisisResourcesFor(kind: CrisisKind): CrisisResource[] {
 const {emergency, findahelpline} = CRISIS_RESOURCES, lifeline = CRISIS_RESOURCES['988'];
 return kind === 'danger' ? [emergency, lifeline, findahelpline] : [lifeline, findahelpline, emergency];
}
