export const BRAND = 'Should I Work There';
export const CANONICAL_ORIGIN = 'https://shouldiworkthere.com';

/*
 * Legal operator. These values appear ONLY in legal text: the privacy policy, the terms of use, legal notices (including
 * where to send them on /legal-requests) and the accessibility contact, all rendered by worker/src/legal.ts. They are
 * never product branding; the product brand is BRAND. Change the operator here and every legal page follows.
 */
export const OPERATOR_LEGAL_NAME = 'Robles Consulting LLC';
export const OPERATOR_JURISDICTION = 'Texas';
export const OPERATOR_ENTITY_TYPE = 'limited liability company';
/** "Robles Consulting LLC, a Texas limited liability company" */
export const OPERATOR_DESCRIPTION = `${OPERATOR_LEGAL_NAME}, a ${OPERATOR_JURISDICTION} ${OPERATOR_ENTITY_TYPE}`;
export const GOVERNING_LAW = 'the State of Texas, USA';
export const VENUE = 'the state and federal courts located in the State of Texas, USA';
/** Legal contact addresses. Mail to them is received only once CONTACT_MAIL.routingEnabled and forwardingVerified are both true. */
export const CONTACT = {
 privacy: 'privacy@shouldiworkthere.com',
 legal: 'legal@shouldiworkthere.com',
 dmca: 'dmca@shouldiworkthere.com',
} as const;
export const MINIMUM_AGE = 18;

/*
 * Facts only the owner can supply. Until each is filled in, the legal pages say plainly that it is pending, and
 * legalOpenItems() in worker/src/legal.ts lists it, so the pages are never served with a statement that is not true.
 * Of these, only contact mail that does not arrive blocks launch (worker/src/legal.ts also blocks on version 1.2.0's
 * notice question while the publication code would give contributions accepted under 1.1.0 a smaller batch than that
 * version promised); the owner decided on 2026-09-22 (D13) that the model provider's facts, the DMCA registration and the
 * EU, EEA and UK items below are follow-ups, not launch blockers.
 */
/**
 * How mail to CONTACT reaches us: Cloudflare Email Routing forwards it to a mailbox hosted by mailboxProvider.
 * routingEnabled: Email Routing is switched on for the domain (MX records exist). forwardingVerified: a test message
 * sent to each of privacy@, legal@ and dmca@ arrived in the destination mailbox. Both must be true before launch.
 */
export const CONTACT_MAIL: Readonly<{routingEnabled: boolean; forwardingVerified: boolean; mailboxProvider: string | null; mailboxTransfer: string | null}> = {
 // Observed in public DNS on 2026-09-22: MX route1-3.mx.cloudflare.net and SPF "v=spf1 include:_spf.mx.cloudflare.net ~all".
 routingEnabled: true,
 // MX records alone do not show that the per-address rules exist or that the destination is verified, so this is true
 // only after a test message to each of privacy@, legal@ and dmca@ arrived: done 2026-09-22 (delivered to the operator mailbox).
 forwardingVerified: true,
 // Destination mailbox confirmed by the owner on 2026-09-22.
 mailboxProvider: 'Google LLC (Google Workspace, United States)',
 // The safeguard for EU, EEA and UK personal data in that mailbox, as the provider states it (policies.google.com/privacy/frameworks, read 2026-09-22).
 mailboxTransfer: 'Google states that Google LLC is certified under the EU-U.S. Data Privacy Framework and the UK Extension to it, and that it uses standard contractual clauses where they are required, including in its contracts for Google Workspace.',
};
/** Postal address for legal notices and correspondence (a private mailbox; no staffed office). */
export const OPERATOR_POSTAL_ADDRESS = '100 Plaza Pl, Ste 300, PMB 58, Northlake, TX 76226, USA';
/**
 * The registered agent for service of process, if the owner wants it named on the legal pages. Null: not named, and
 * legalOpenItems() lists the question for the owner and counsel (the pages give only the postal address above).
 */
export const REGISTERED_AGENT: Readonly<{name: string | null; address: string | null}> = {name: null, address: null};
/**
 * Contact telephone, given by the owner on 2026-09-22. Listed with the contact addresses on every legal page and as the
 * DMCA agent's number. Plain text: legal links allow no tel:.
 */
export const OPERATOR_PHONE = '+1 940-240-8554';
/**
 * The company that carries calls to OPERATOR_PHONE (and stores any voicemail). Null fields are unconfirmed: the privacy
 * policy lists the provider by category until it is named. transfer: complete sentences, once confirmed, giving the
 * safeguard for EU, EEA and UK personal data it handles.
 */
export const TELEPHONE_PROVIDER: Readonly<{name: string | null; transfer: string | null}> = {name: null, transfer: null};
/** TypeSafe, which runs the Jev model. Null fields are unconfirmed and are described as unconfirmed. */
export const MODEL_PROVIDER: Readonly<{name: string; legalName: string | null; location: string | null; handling: string | null; transfer: string | null}> = {
 name: 'TypeSafe',
 legalName: null,
 // Country or countries where TypeSafe processes inputs.
 location: null,
 // Complete sentences, once confirmed: how long TypeSafe keeps inputs, whether it trains on them, and the agreement.
 handling: null,
 // Complete sentences, once confirmed: the safeguard for EU, EEA and UK personal data sent to TypeSafe, such as an
 // adequacy decision, Data Privacy Framework certification, or standard contractual clauses in its agreement with us.
 transfer: null,
};
/** Designated DMCA agent (17 U.S.C. 512(c)(2)). Fill in once registered with the US Copyright Office. */
export const DMCA_AGENT: Readonly<{registered: boolean; name: string | null; postalAddress: string | null; phone: string | null}> = {
 registered: false,
 // A position may be designated under 37 CFR 201.38. Set registered to true once the Copyright Office registration exists.
 name: 'Designated Copyright Agent',
 postalAddress: OPERATOR_POSTAL_ADDRESS,
 phone: OPERATOR_PHONE,
};

/*
 * EU, EEA and UK. The owner decided on 2026-09-22 that the service is offered to people there. While SERVES_EU_UK is
 * true, the privacy policy and the terms carry sections for the GDPR and UK GDPR, the Digital Services Act and the UK
 * Online Safety Act, and legalOpenItems() lists the appointments and assessments below, labelled euUk, until they
 * exist. The owner decided on 2026-09-22 (D13) that none of them blocks launch: the pages say each is pending or not yet
 * complete, and they are owner and counsel follow-ups. Record each here as soon as it exists.
 */
export const SERVES_EU_UK: boolean = true;
/** A representative the operator appoints. Until appointed is true and name and address are filled in, the pages say the appointment is pending. */
export interface Representative {appointed: boolean; name: string | null; address: string | null; email: string | null;}
/** GDPR Article 27 representative in the EU. */
export const EU_REPRESENTATIVE: Readonly<Representative> = {appointed: false, name: null, address: null, email: null};
/** UK GDPR Article 27 representative in the UK. */
export const UK_REPRESENTATIVE: Readonly<Representative> = {appointed: false, name: null, address: null, email: null};
/** Digital Services Act Article 13 legal representative in an EU member state (it may be the same firm as EU_REPRESENTATIVE). */
export const DSA_LEGAL_REPRESENTATIVE: Readonly<Representative> = {appointed: false, name: null, address: null, email: null};
/**
 * Assessments the owner is preparing: each is the ISO date it was completed, or null while it is not complete. The
 * pages never say an assessment is done while its value is null.
 */
export const COMPLIANCE_ASSESSMENTS: Readonly<{dpia: string | null; ukIllegalContentRisk: string | null; ukChildrenAccess: string | null}> = {
 // GDPR Article 35 data protection impact assessment: being prepared.
 dpia: null,
 // UK Online Safety Act 2023 illegal content risk assessment.
 ukIllegalContentRisk: null,
 // UK Online Safety Act 2023 children's access assessment.
 ukChildrenAccess: null,
};
/**
 * Special category data (GDPR Article 9) about someone other than the author, published despite the content rules:
 * the Article 9 condition, or the national freedom-of-expression exemption (GDPR Article 85; in the UK, the Data
 * Protection Act 2018), that counsel confirms covers it. One or two complete sentences. Null until counsel chooses; the
 * privacy policy then says it is not yet confirmed.
 */
export const THIRD_PARTY_SENSITIVE_DATA_BASIS: string | null = null;
/**
 * The server-side support-resources checks (the publisher's crisis phrase check, CRISIS_RESOURCES_ENABLED, and Jev's
 * optional self-harm question during screening, SELF_HARM_SCREENING) handle text that may reveal the author's health,
 * only to offer support resources, and store nothing. The Article 9 condition counsel confirms for them, in one or two
 * complete sentences. Null until counsel chooses; while either check is on, the privacy policy says it is not yet
 * confirmed and legalOpenItems() lists it as an EU, EEA and UK item for counsel (not a launch blocker, D13).
 */
export const SUPPORT_CHECKS_SENSITIVE_DATA_BASIS: string | null = null;

/** Shared version of the privacy policy, terms of use and accessibility statement. Bump with every published change. */
export const LEGAL_VERSION = '1.2.0';
/**
 * ISO date (UTC) the current LEGAL_VERSION took effect. It must not be earlier than the day the pages are first
 * served: set it to the real publication date when the routes go live.
 */
export const LEGAL_EFFECTIVE = '2026-09-23';
/** The day the legal pages (version 1.1.0) and the covenant were first served. Fixed: later versions never move it. */
export const LEGAL_FIRST_SERVED = '2026-09-22';
/**
 * The exact LEGAL_VERSION recorded as approved by counsel, or null. While it equals LEGAL_VERSION the live legal pages
 * carry no draft notice; a later version (any text change after the pages are first served bumps LEGAL_VERSION) brings
 * the notice back until it is recorded again.
 *
 * '1.2.0' by the owner's decision of 2026-09-23. The owner stated in the launch session (2026-09-22/23, relayed to the
 * agent that made this edit by the launch workflow) that counsel had said the terms were good, and asked for them to be
 * published without the draft notice. That is the owner's statement, recorded as given: no counsel sign-off document is
 * in this repository, and the 1.2.0 text was corrected again on 2026-09-23 after that statement (the daily email limits
 * of community employers, the shared jury seat of community employers, the domain-attach rule, the listing correction
 * process, and 1.1.0 contributions keeping their batch of 25). If counsel has not approved the text now in docs/legal,
 * set this back to null before deploying.
 */
export const LEGAL_REVIEWED_VERSION: string | null = '1.2.0';
/**
 * LEGAL_VERSION is recorded as approved by counsel (LEGAL_REVIEWED_VERSION). While false, every live legal page (privacy
 * policy, terms of use, accessibility statement) shows a visible "Draft — pending attorney review" notice, and the review
 * copies in docs/legal say the same.
 */
export const LEGAL_REVIEWED: boolean = LEGAL_REVIEWED_VERSION === LEGAL_VERSION;
/**
 * draft: a review version that was replaced before the pages were first served. Drafts are listed only in the review
 * copies in docs/legal, never in the public version history.
 */
export interface LegalChange {version: string; effective: string; summary: string; draft?: boolean;}
/** Newest first. Every published version stays listed, and so does every review draft counsel may have seen. */
export const LEGAL_CHANGELOG: readonly LegalChange[] = [
 {
  version: '1.2.0',
  effective: LEGAL_EFFECTIVE,
  summary: 'Describes the service as it opens to the public. Accounts about real employers are published: written accounts in batches of at least five per employer after screening and a random delay, and questionnaire figures only for groups of at least 25. Accounts submitted before this version took effect keep the batch of at least 25 that version 1.1.0 promised. Anyone can add an employer with its work-email domain; listings show the domain, say they were added by the community, are not endorsed by us, and can be corrected on request, with each correction recorded in a public log (new section “Employers added by the community”). A proof-of-work step, computed in your browser, now comes before verification emails, juror tokens and new listings, and verification emails for employers added by the community have daily limits. The live site no longer has fictional sample employers, or the practice features built on them. Anonymous juries for real employers are switched on and form only when enough jurors can serve; juror tokens of employers added by the community share one seat per case and never make a jury formable. Updates the daily model-call limits.',
 },
 {
  version: '1.1.0',
  effective: LEGAL_FIRST_SERVED,
  summary: 'First published version of the privacy policy, terms of use and accessibility statement. It names the operator and how to contact us, explains how the system is divided, lists what we keep, for how long and which providers process it, sets Texas law and venue and the 18+ requirement, and includes sections for people in the EU, EEA and UK under the GDPR and UK GDPR, the Digital Services Act and the UK Online Safety Act.',
 },
 {
  version: '1.0.0',
  // The date it was drafted; it was never served.
  effective: '2026-09-22',
  draft: true,
  summary: 'First versioned privacy policy, terms of use and accessibility statement. Names the legal operator and contacts, lists retention limits and service providers, sets Texas law and venue and the 18+ requirement, and keeps the privacy architecture explanation.',
 },
];

/** Links every page footer carries (L8). */
export const LEGAL_LINKS: readonly {href: string; label: string}[] = [
 {href: '/privacy', label: 'Privacy'},
 {href: '/terms', label: 'Terms'},
 {href: '/accessibility', label: 'Accessibility'},
 {href: '/legal-requests', label: 'Legal requests'},
];
