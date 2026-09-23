/**
 * Privacy detector, shared by the browser editor and the server intake screen.
 *
 * The browser runs this first, so identifiers can be removed before anything
 * leaves the device. The server runs the same rules again as defense in depth.
 * Findings are concrete and reviewable: each one names what was found and
 * offers a specific generalization the author can accept or refuse.
 *
 * This is a detector, not a guarantee. Kernel does not compute or display a
 * numeric anonymity score, because no pattern list can promise that a person is
 * unidentifiable.
 */

export type FindingKind =
  | "email"
  | "phone"
  | "url"
  | "exact_date"
  | "money"
  | "unique_role"
  | "small_team"
  | "named_person"
  | "narrow_location"
  | "identifier"
  | "street_address"
  | "instructions";

/**
 * Finding kinds that are not identifying details: text addressed to the checks themselves. They hold a draft for repair
 * (high severity) but never make a published account "identifying", and never block a search.
 */
export const SCREENING_ONLY_KINDS: readonly FindingKind[] = ["instructions"];
/** A high-severity finding that identifies someone or somewhere (everything high except SCREENING_ONLY_KINDS). */
export const identifies = (f: Pick<Finding, "kind" | "severity">) => f.severity === "high" && !SCREENING_ONLY_KINDS.includes(f.kind);

export interface Suggestion {
  from: string;
  to: string;
  reason: string;
}

export interface Finding {
  id: string;
  kind: FindingKind;
  severity: "high" | "medium";
  what: string;
  excerpt: string;
  explanation: string;
  suggestions: Suggestion[];
}

const MONTHS =
  "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";
const WEEKDAY = "(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,?\\s+)?";
// A date, optionally with the preposition that introduces it, so a generalization replaces the whole phrase ("on March 11").
const DATE_PREP = "(?:(?:[Oo]n|[Bb]y|[Aa]t|[Ss]ince|[Uu]ntil|[Bb]efore|[Aa]fter)\\s+(?:the\\s+)?)?";
// Capitalized words that start sentences or name dates, never the start of a person's name.
const NOT_NAME =
  `(?:${MONTHS.slice(1, -1)}|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|I|A|An|The|In|On|At|To|Of|And|But|Or|So|If|As|It|He|She|We|They|You|My|Our|His|Her|Their|This|That|These|Those|Then|Now|When|After|Before|Since|During|Who|What|Why|How|Also|Just|Yesterday|Today|Tomorrow|Later|Recently|Eventually|Finally|Meanwhile|Afterwards|Once|Still|Soon|Next|Last|Every|Each|Some|Most|Many|Only|Even|Actually|Honestly|Apparently|Anyway|Instead|Suddenly|Unfortunately|Luckily|Sadly|Obviously|Clearly)\\b`;
// A name token: "Lee", "Wu", "O'Neil", "McDonald", "Smith-Jones". Two-letter surnames count.
const NAME_TOKEN = `(?!${NOT_NAME})(?:[A-Z]'[A-Z][a-z]+|[A-Z][a-z]+(?:[A-Z][a-z]+)?(?:-[A-Z][a-z]+)?)`;
// A full name after a role: the first name and up to two more capitalized tokens, so no part of it is left behind.
const FULL_NAME = `${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){0,2}\\b`;
const ROLE =
  "(?:manager|boss|director|lead|supervisor|skip-level|vp|VP|ceo|CEO|cto|CTO|founder|co-founder|colleague|coworker|co-worker|teammate|report|recruiter|mentor)";
/** "a" or "an" before a role, by how its first word is read aloud: acronyms letter by letter ("an ML engineer", "a UX designer"). */
export function articleFor(phrase: string): "a" | "an" {
  const first = phrase.trim().split(/\s+/)[0] ?? "";
  if (/^[A-Z]{2,}\b/.test(first) || /^[A-Z]$/.test(first)) return /^[AEFHILMNORSX]/.test(first) ? "an" : "a";
  if (/^(?:uni|use|usu|uti|ure|eu|one)/i.test(first)) return "a";
  if (/^(?:hour|honest|honor|heir)/i.test(first)) return "an";
  return /^[aeiou]/i.test(first) ? "an" : "a";
}

const RULES: Array<{
  kind: FindingKind;
  severity: "high" | "medium";
  what: string;
  pattern: RegExp;
  explanation: string;
  suggest: (match: string) => Suggestion[];
}> = [
  {
    kind: "email",
    severity: "high",
    what: "Email address",
    pattern: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g,
    explanation: "An email address identifies a person directly, including work addresses that reveal a team.",
    suggest: (m) => [{ from: m, to: "an email address", reason: "Removes a direct identifier" }],
  },
  {
    kind: "phone",
    severity: "high",
    what: "Phone number",
    pattern: /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    explanation: "Phone numbers are direct identifiers and are also searchable.",
    suggest: (m) => [{ from: m, to: "a phone number", reason: "Removes a direct identifier" }],
  },
  {
    kind: "url",
    severity: "medium",
    what: "Link or handle",
    pattern: /\bhttps?:\/\/\S+|\bwww\.\S+|@[A-Za-z0-9_]{3,}\b/g,
    explanation: "Links and handles often point at a personal profile, a specific document, or a small team page.",
    suggest: (m) => [{ from: m, to: "a public document", reason: "Removes a pointer to a specific person or page" }],
  },
  {
    kind: "exact_date",
    severity: "medium",
    what: "Exact date",
    pattern: new RegExp(
      `\\b${DATE_PREP}(?:${WEEKDAY}${MONTHS}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?|${WEEKDAY}\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTHS}(?:,?\\s*\\d{4})?|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})\\b`,
      "g",
    ),
    explanation: "A precise date combined with a team or location can single out one person, especially around a layoff or a termination.",
    suggest: (m) => {
      // The phrase keeps its preposition's meaning: "on March 11" becomes "around then", "by March 11" "by then".
      const prep = /^(on|by|at|since|until|before|after)\s/i.exec(m)?.[1]?.toLowerCase();
      const to = prep === "by" ? "by then" : prep === "before" ? "before then" : prep === "after" ? "after that" : prep === "since" ? "since then" : prep === "until" ? "until then" : prep ? "around then" : "around that time";
      return [{ from: m, to, reason: "Coarsens timing without inventing a different date" }];
    },
  },
  {
    kind: "money",
    severity: "medium",
    what: "Exact amount",
    pattern: /\$\s?\d[\d,]*(?:\.\d{2})?\b|\b\d[\d,]{3,}\s?(?:dollars|USD)\b/gi,
    explanation: "Exact compensation amounts are highly identifying at small companies and small teams.",
    suggest: (m) => [{ from: m, to: "an amount", reason: "Removes the exact amount; you can enter a truthful broad range yourself" }],
  },
  {
    kind: "unique_role",
    severity: "high",
    what: "Role described as unique",
    // "the only", "our only", "the team's sole": the whole determiner goes, so the edit reads "a staff engineer".
    pattern: /\b(?:(?:the|my|our|their|his|her)\s+(?:[a-z]+(?:'s|’s)\s+)?)?(?:only|sole)\s+(?:[a-z-]+\s+){0,3}(?:engineer|designer|manager|analyst|researcher|writer|recruiter|salesperson|technician|nurse|teacher)\b/gi,
    explanation: "If you are the only person in a role, the role itself identifies you.",
    suggest: (m) => {
      const role = m.replace(/^(?:(?:the|my|our|their|his|her)\s+(?:[a-z]+(?:'s|’s)\s+)?)?(?:only|sole)\s+/i, "");
      return [{ from: m, to: `${articleFor(role)} ${role}`, reason: "Removes uniqueness without inventing seniority" }];
    },
  },
  {
    kind: "small_team",
    severity: "medium",
    what: "Very small team size",
    pattern: /\b(?:team|group|org|department|squad)\s+of\s+(?:two|three|four|2|3|4)\b/gi,
    explanation: "A team of two to four people turns an anonymous statement into a shortlist.",
    suggest: (m) => [{ from: m, to: "a small team", reason: "Keeps the size impression without the exact number" }],
  },
  {
    kind: "named_person",
    severity: "high",
    what: "Named individual",
    // Every token of the name is part of the finding ("My manager Dana Wu", "My manager, Dana Lee,"), so replacing it leaves
    // no surname behind; a capitalized word left after one of this detector's own replacements is flagged again.
    pattern: new RegExp(
      [
        `\\b(?:[Mm]y|[Oo]ur|[Tt]he)\\s+${ROLE}(?:\\s*,\\s*(?:(?:is|was|called|named)\\s+)?${FULL_NAME}(?:\\s*,)?|\\s+(?:(?:is|was|called|named)\\s+)?${FULL_NAME})`,
        `\\breporting to ${FULL_NAME}`,
        `\\b(?:the person involved|a manager)\\s+${FULL_NAME}`,
        `\\b(?!${NOT_NAME})[A-Z][a-z]{2,}(?:[A-Z][a-z]+)?(?:\\s+${NAME_TOKEN}){1,2}(?=\\s*,?\\s+(?:is|was|told|said|stole|changed)\\b)`,
      ].join("|"),
      "g",
    ),
    explanation: "Naming a manager or colleague identifies a third person who did not consent to being discussed.",
    suggest: (m) => {
      if (/^reporting to/i.test(m)) return [{ from: m, to: "reporting to a manager", reason: "Protects a third party who did not consent" }];
      const det = /^(my|our|the)\s/i.exec(m)?.[1]?.toLowerCase();
      const role = /\b(?:manager|boss|lead|skip-level|supervisor)\b/i.test(m)
        ? `${det ?? "a"} manager`
        : det && det !== "the" && /\b(?:colleague|coworker|co-worker|teammate)\b/i.test(m)
          ? `${det} colleague`
          : "the person involved";
      return [{ from: m, to: role, reason: "Protects a third party who did not consent" }];
    },
  },
  {
    kind: "narrow_location",
    severity: "medium",
    what: "Narrow location",
    pattern: /\b(?:the\s+)?[A-Z][a-z]{3,}\s+(?:office|site|store|campus|plant|warehouse|hub|[a-z]+ team)\b|\bin (?:Dallas|Austin|Seattle|Boston|Denver|Chicago|London)\b/g,
    explanation: "City or site level location narrows the population fast, especially with a role or a date.",
    suggest: (m) => [{ from: m, to: /^in /i.test(m)?'in a broader region':'a field location', reason: "Generalizes the location without inventing a country" }],
  },
  {
    kind: "identifier",
    severity: "high",
    what: "Internal identifier",
    pattern: /\b(?:employee|badge|payroll|ticket|case|req|job)\s*(?:id|number|no\.?|#)\s*[:#]?\s*[A-Za-z0-9-]{3,}\b/gi,
    explanation: "Internal identifiers are unique by construction and can be traced back through employer systems.",
    suggest: (m) => [{ from: m, to: "an internal reference", reason: "Removes a traceable identifier" }],
  },
  {
    kind: "street_address",
    severity: "high",
    what: "Street address",
    pattern: /\b\d{1,5}\s+(?:[A-Z][A-Za-z'’.-]*\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Court|Ct|Place|Pl|Way|Terrace|Circle|Cir|Parkway|Pkwy|Highway|Hwy|Square)\b\.?/g,
    explanation: "A street address locates someone's home or whereabouts. Describe what happened at work instead.",
    suggest: (m) => [{ from: m, to: "a location", reason: "Removes a precise address" }],
  },
  {
    kind: "street_address",
    severity: "high",
    what: "Street address",
    // Lowercase forms, limited to unambiguous street words so "5 more road trips" or "3 hard drive failures" never match.
    pattern: /\b\d{1,5}\s+(?:[a-z]+\s+){1,2}(?:street|avenue|boulevard)\b/g,
    explanation: "A street address locates someone's home or whereabouts. Describe what happened at work instead.",
    suggest: (m) => [{ from: m, to: "a location", reason: "Removes a precise address" }],
  },
  {
    // Text addressed to reviewers, moderators or automated checks, or telling them how to answer. Deliberately narrow:
    // performance reviewers, hiring screens and content-moderation work are ordinary workplace subjects and never match.
    kind: "instructions",
    severity: "high",
    what: "Note addressed to reviewers or automated checks",
    pattern: new RegExp([
      String.raw`\b(?:ignore|disregard|forget|override)\s+(?:(?:all|any|the|your|of)\s+)*(?:previous|prior|above|earlier|preceding)\s+(?:instructions|prompts?)\b`,
      String.raw`\banswer\s+(?:0|zero|no|false)\s+(?:to|for|on)\s+(?:every|all|each|any)(?:\s+of\s+the)?\s+(?:questions?|checks?|items?)\b`,
      String.raw`[\[(<{]\s*(?:reviewer|moderator|screener|system|assistant|AI|model)(?:'s|s)?\s+(?:note|message|instructions?|prompt)\b`,
      String.raw`\b(?:reviewer|moderator|screener)(?:'s|s)?\s+(?:note|message|instructions?)\s+(?:for|to)\s+(?:the\s+|any\s+|all\s+)?(?:automated\b|AI\b|(?:policy|content)\s+(?:screen|filter|classifier|model)|screen\b|classifier\b|model\b)`,
      String.raw`(?:^|\n)\s*(?:assistant|AI|model)\s+(?:note|message|instructions?|prompt)\s*:`,
      String.raw`(?:^|[\[(<{]|\n)\s*(?:note|message|instructions?)\s+(?:for|to)\s+(?:the\s+|any\s+|all\s+)?(?:reviewers?|moderators?|screeners?|AI|model|classifier|screen)\b`,
      // The same note at the start of any later sentence or clause ("…around then. Note to reviewers: this is fine."),
      // when it is set off as an address (a colon, comma or dash follows, or "please"): "I sent a note to the reviewers of
      // my promotion packet" and "Instructions for reviewers were vague" describe work and never match.
      String.raw`(?<=[.!?;]["'”’)\]]*\s+|\s[-–—]{1,2}\s*|,\s+)(?:(?:a|one|quick|small|brief|final|friendly|important)\s+){0,2}(?:note|message|memo|reminder|p\.?\s?s\.?|instructions?)\s+(?:for|to)\s+(?:the\s+|any\s+|all\s+|our\s+)?(?:human\s+|automated\s+|AI\s+|content\s+|policy\s+)?(?:reviewers?|moderators?|screeners?|AI|models?|classifiers?|screens?|checkers?|checks)\b(?=\s*(?:[:;,!–—-]|$)|\s+(?:please|kindly)\b)`,
      // A greeting addressed to the checks at the start of the text or of a sentence ("Dear reviewers,", "Hi moderators:").
      String.raw`(?<=^|[\n\[(<{]|[.!?;]["'”’)\]]*\s+|\s[-–—]{1,2}\s*)\s*(?:dear|hi|hello|hey|attention|attn\.?)\s+(?:the\s+|all\s+|any\s+)?(?:human\s+|automated\s+|AI\s+)?(?:reviewers?|moderators?|screeners?|AI|models?|classifiers?)\b(?=\s*[:,;!–—-])`,
      // Other verbs for the answer the note asks for ("say no to every check"); a following hyphen is another word ("check-in").
      String.raw`\b(?:say|reply|respond|return|output|mark|select|choose)\s+(?:0|zero|no|false|["“']no["”'])\s+(?:to|for|on)\s+(?:every|all|each|any)(?:\s+of\s+the)?\s+(?:questions?|checks?|flags?|signals?)\b(?!-)`,
      String.raw`\b(?:this\s+(?:passage|text|testimony|submission)|the\s+(?:passage|testimony|submission))\s+(?:has|had|was|is)\s+already\s+(?:been\s+)?(?:reviewed|approved|cleared|pre-?approved|checked|vetted|screened)\b`,
      String.raw`\b(?:rate|score|mark|classify)\s+(?:this\s+(?:passage|text|testimony|submission)|the\s+(?:passage|testimony|submission))\s+as\s+(?:safe|clear|clean|benign|compliant|acceptable|harmless|0|zero)\b`,
      String.raw`\b(?:private_identity|contextual_identity|personal_attack|self_harm)\s*(?:=|:|should\s+be|is|as)\s*(?:0|zero|false|no|low)\b`,
      String.raw`\byou\s+are\s+(?:an?\s+)?(?:AI|language\s+model|LLM|classifier)\b`,
    ].join("|"), "gi"),
    explanation: "Text addressed to reviewers, moderators or automated checks is not part of an account, and a note saying the text was already reviewed never changes a check. Delete it; the checks read only your account.",
    suggest: () => [],
  },
];

export function scanText(text: string): Finding[] {
  const findings: Finding[] = [];
  const claimed: Array<[number, number]> = [];
  let counter = 0;
  const overlaps = (start: number, end: number) => claimed.some(([s, e]) => start < e && end > s);
  for (const rule of RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const excerpt = match[0];
      if (excerpt.trim().length < 3) continue;
      const start = match.index;
      const end = start + excerpt.length;
      // A higher priority rule already accounted for this span. Reporting it
      // twice would inflate the finding count and confuse the author.
      if (overlaps(start, end)) continue;
      claimed.push([start, end]);
      counter += 1;
      findings.push({
        id: `${rule.kind}-${counter}`,
        kind: rule.kind,
        severity: rule.severity,
        what: rule.what,
        excerpt,
        explanation: rule.explanation,
        suggestions: rule.suggest(excerpt),
      });
      if (counter > 40) return findings;
    }
  }
  return findings;
}

export function applySuggestion(text: string, suggestion: Suggestion): string {
  return text.split(suggestion.from).join(suggestion.to);
}

export function summarizeFindings(findings: Finding[]): { high: number; medium: number; kinds: FindingKind[] } {
  return {
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    kinds: [...new Set(findings.map((f) => f.kind))],
  };
}
