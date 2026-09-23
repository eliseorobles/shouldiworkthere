/**
 * Work-email domain rules for listing an employer (owner decision 4, 2026-09-23). Pure and dependency-free, so the
 * browser can pre-check a domain with exactly the rules the main worker applies. The worker additionally requires MX
 * records (DNS over HTTPS), a proof of work and a per-client daily allowance, which cannot be checked here.
 *
 * A listing names one work-mail domain. It must be a valid public hostname, not a free-mail or disposable-mail provider
 * (or a subdomain of one), not a public suffix on its own (co.uk), not a reserved or special-use name, and not this
 * site's own domain. The lists are curated and deliberately conservative: a provider missing here is still refused if
 * it has no MX records, and a listing never proves anything about a contributor.
 */

export const DOMAIN_MAX_LENGTH = 253, DOMAIN_LABEL_MAX = 63;

/**
 * Free-mail providers: anyone can open a mailbox there, so a mailbox proves nothing about an employer. Matched as the
 * whole domain or any subdomain of it.
 */
export const FREE_MAIL_DOMAINS: readonly string[] = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'passport.com',
  'windowslive.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'aol.com', 'aim.com', 'icloud.com', 'me.com', 'mac.com',
  'privaterelay.appleid.com', 'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me', 'tutanota.com', 'tutanota.de',
  'tutamail.com', 'tuta.io', 'tuta.com', 'keemail.me', 'fastmail.com', 'fastmail.fm', 'hey.com', 'duck.com', 'zoho.com',
  'zohomail.com', 'zohomail.eu', 'mail.com', 'email.com', 'usa.com', 'post.com', 'gmx.com', 'gmx.net', 'gmx.de', 'gmx.at',
  'gmx.ch', 'gmx.us', 'web.de', 'freenet.de', 't-online.de', 'posteo.de', 'posteo.net', 'mailbox.org', 'yandex.com',
  'yandex.ru', 'ya.ru', 'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'rambler.ru', 'ukr.net', 'qq.com', 'foxmail.com',
  '163.com', '126.com', 'yeah.net', 'sina.com', 'sina.cn', 'sohu.com', 'aliyun.com', 'naver.com', 'daum.net',
  'hanmail.net', 'kakao.com', 'rediffmail.com', 'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net', 'sfr.fr', 'neuf.fr',
  'libero.it', 'virgilio.it', 'tiscali.it', 'alice.it', 'seznam.cz', 'centrum.cz', 'wp.pl', 'o2.pl', 'onet.pl', 'interia.pl',
  'op.pl', 'btinternet.com', 'sky.com', 'virginmedia.com', 'ntlworld.com', 'talktalk.net', 'blueyonder.co.uk',
  'att.net', 'sbcglobal.net', 'bellsouth.net', 'comcast.net', 'verizon.net', 'cox.net', 'charter.net', 'earthlink.net',
  'optonline.net', 'frontier.com', 'windstream.net', 'juno.com', 'netzero.net', 'shaw.ca', 'sympatico.ca',
  'bell.net', 'telus.net', 'bigpond.com', 'bigpond.net.au', 'optusnet.com.au', 'iinet.net.au', 'xtra.co.nz', 'hushmail.com',
  'mailfence.com', 'runbox.com', 'disroot.org', 'riseup.net', 'startmail.com', 'countermail.com', 'lavabit.com',
  'inbox.com', 'mail2world.com', 'lycos.com', 'excite.com', 'myself.com', 'consultant.com', 'engineer.com', 'uol.com.br',
  'bol.com.br', 'terra.com.br', 'ig.com.br', 'yahoo.com.br', 'hotmail.com.br', 'outlook.com.br', 'prodigy.net.mx',
  'passmail.net', 'passinbox.com', 'simplelogin.com', 'simplelogin.fr', 'aleeas.com', 'slmail.me', 'anonaddy.com',
  // Anyone can sign up at these too (review of 2026-09-23): the cock.li family, Czech, Slovak, Latvian and Bulgarian
  // portals, Zoho's regional free mail, Firefox Relay aliases and a few Canadian and British ISPs.
  'cock.li', 'cock.lu', 'cock.email', 'airmail.cc', 'firemail.cc', 'memeware.net', 'cocaine.ninja', 'waifu.club',
  '420blaze.it', 'tfwno.gf', 'goat.si', 'redchan.it', 'email.cz', 'post.cz', 'centrum.sk', 'azet.sk', 'inbox.lv', 'abv.bg',
  'zoho.in', 'zoho.eu', 'zohomail.in', 'mozmail.com', 'rogers.com', 'videotron.ca', 'btopenworld.com', 'tiscali.co.uk',
];
/**
 * Providers with a free-mail domain under many country suffixes (yahoo.co.uk, hotmail.fr, outlook.de, gmx.co.uk...):
 * the first label of the registrable name.
 */
export const FREE_MAIL_LABELS: readonly string[] = ['gmail', 'googlemail', 'yahoo', 'ymail', 'hotmail', 'outlook', 'live', 'msn', 'aol', 'icloud', 'gmx', 'yandex', 'protonmail', 'tutanota', 'zohomail', 'wanadoo', 'rediffmail'];
/** Disposable or throwaway mailbox providers. Matched as the whole domain or any subdomain of it. */
export const DISPOSABLE_DOMAINS: readonly string[] = [
  'mailinator.com', 'mailinator.net', 'mailinator2.com', 'notmailinator.com', 'guerrillamail.com', 'guerrillamail.net',
  'guerrillamail.org', 'guerrillamail.biz', 'guerrillamail.de', 'guerrillamail.info', 'guerrillamailblock.com',
  'sharklasers.com', 'grr.la', 'pokemail.net', 'spam4.me', '10minutemail.com', '10minutemail.net', '10minutemail.co.uk',
  '20minutemail.com', 'temp-mail.org', 'temp-mail.io', 'tempmail.com', 'tempmail.net', 'tempmail.dev', 'tempmailo.com',
  'tempmail.plus', 'tempail.com', 'tempr.email', 'temporary-mail.net', 'throwawaymail.com', 'yopmail.com', 'yopmail.fr',
  'yopmail.net', 'trashmail.com', 'trashmail.de', 'trashmail.net', 'trashmail.io', 'trash-mail.com', 'wegwerfmail.de',
  'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'mintemail.com', 'mohmal.com',
  'emailondeck.com', 'fakeinbox.com', 'spamgourmet.com', 'mytemp.email', 'burnermail.io', '33mail.com', 'anonaddy.me',
  'addy.io', 'mailsac.com', 'inboxkitten.com', 'moakt.com', 'discard.email', 'emailfake.com', 'generator.email',
  'harakirimail.com', 'mail.tm', 'mail.gw', '1secmail.com', '1secmail.org', '1secmail.net', 'byom.de', 'dropmail.me',
  'mailcatch.com', 'mailexpire.com', 'jetable.org', 'spambox.us', 'spamex.com', 'mvrht.com', 'mailpoof.com',
  'getairmail.com', 'fexbox.org', 'emltmp.com', 'tmpmail.org', 'tmpmail.net', 'minuteinbox.com', 'mailforspam.com',
  'eyepaste.com', 'incognitomail.com', 'mail-temp.com', 'tempinbox.com', 'dodgit.com', 'mailmetrash.com', 'spamfree24.org',
  'emailtemporanea.net', 'crazymailing.com', 'luxusmail.org', 'fakemail.net', 'mailto.plus', 'rover.info', 'inboxbear.com',
  'tempmailaddress.com', 'mailnull.com', 'spamherelots.com', 'binkmail.com', 'bobmail.info', 'chammy.info', 'devnullmail.com',
  'letthemeatspam.com', 'mailinater.com', 'safetymail.info', 'sogetthis.com', 'spamhereplease.com', 'thisisnotmyrealemail.com',
  'tradermail.info', 'veryrealemail.com', 'zippymail.info', 'suremail.info', 'mailtemp.net', 'emailtemp.org', 'tempemail.net',
  // Added in review (2026-09-23): tempmail.lol, the fakemailgenerator family and Yopmail's alternate domains.
  'tempmail.lol', 'tmail.ws', 'tmpbox.net', 'tmails.net', 'emailnax.com', '10mail.org', 'spamdecoy.net', 'mail7.io',
  'emlpro.com', 'emlhub.com', 'zetmail.com', 'trbvm.com', 'fakemailgenerator.com', 'armyspy.com', 'cuvox.de', 'dayrep.com',
  'einrot.com', 'fleckens.hu', 'gustr.com', 'jourrapide.com', 'rhyta.com', 'superrito.com', 'teleworm.us', 'cool.fr.nf',
  'jetable.fr.nf', 'courriel.fr.nf', 'moncourrier.fr.nf', 'monemail.fr.nf', 'monmail.fr.nf', 'nospam.ze.tc', 'nomail.xl.cx',
  'mega.zik.dj', 'speed.1s.fr',
];
/**
 * Public suffixes that are not registrable names on their own (a domain equal to one of these is refused). A small
 * curated subset of the Public Suffix List: the multi-label country suffixes people commonly use.
 */
export const PUBLIC_SUFFIXES: readonly string[] = [
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'ac.uk', 'gov.uk', 'nhs.uk', 'com.au', 'net.au', 'org.au',
  'edu.au', 'gov.au', 'co.nz', 'org.nz', 'net.nz', 'govt.nz', 'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'co.kr',
  'or.kr', 'go.kr', 'com.br', 'net.br', 'org.br', 'gov.br', 'com.mx', 'org.mx', 'gob.mx', 'com.ar', 'com.co', 'com.pe',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'com.hk', 'org.hk', 'com.tw', 'org.tw', 'com.sg', 'org.sg', 'gov.sg', 'com.my',
  'co.in', 'firm.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'co.za', 'org.za', 'gov.za', 'co.il', 'org.il', 'ac.il',
  'com.tr', 'org.tr', 'gov.tr', 'com.eg', 'com.sa', 'com.pk', 'com.ng', 'co.ke', 'com.ph', 'co.id', 'or.id', 'co.th',
  'in.th', 'com.vn', 'com.ua', 'org.ua', 'com.pl', 'co.at', 'or.at', 'com.es', 'com.pt', 'com.gr', 'com.ru',
];
/** Top-level names reserved or used only on private networks (RFC 2606, RFC 6761, RFC 6762, RFC 7686, ICANN .internal). */
export const RESERVED_TLDS: readonly string[] = ['test', 'example', 'invalid', 'localhost', 'local', 'internal', 'onion', 'arpa', 'lan', 'home', 'corp', 'localdomain', 'intranet', 'private'];
/** Reserved second-level names (RFC 2606) and this site's own domains, which never name an employer listing. */
export const RESERVED_DOMAINS: readonly string[] = ['example.com', 'example.net', 'example.org', 'shouldiworkthere.com', 'verify-mail.shouldiworkthere.com'];

export type DomainProblem = 'domain_invalid' | 'domain_reserved' | 'domain_public_suffix' | 'domain_free_mail' | 'domain_disposable';

/** What a person types, as a domain: trimmed, lowercased, a leading '@' and trailing dots removed. */
export function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^@+/, '').replace(/\.+$/, '');
}
const within = (domain: string, list: readonly string[]) => list.some(d => domain === d || domain.endsWith(`.${d}`));
/** The public suffix a domain ends with: a listed multi-label suffix, or else its last label. */
export function publicSuffix(domain: string): string {
  const labels = domain.split('.');
  for (let i = 1; i < labels.length; i++) { const tail = labels.slice(i).join('.'); if (PUBLIC_SUFFIXES.includes(tail)) return tail; }
  return labels.at(-1) ?? '';
}
/** The labels in front of the public suffix, the registrable label last ('mail.schwab.com' → ['mail', 'schwab']). */
export function ownLabels(domain: string): string[] {
  const suffix = publicSuffix(domain);
  return domain.slice(0, Math.max(0, domain.length - suffix.length - 1)).split('.').filter(Boolean);
}
/** The registrable domain: its label in front of the public suffix, and the suffix ('mail.schwab.com' → 'schwab.com'). */
export function registrableDomain(domain: string): string {
  const label = ownLabels(domain).at(-1);
  return label ? `${label}.${publicSuffix(domain)}` : domain;
}
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
/**
 * Why a (normalized) domain cannot name a listing, or null. Syntax: ASCII letters, digits and hyphens (an IDN in its
 * xn-- form), at least two labels, labels of 1–63 characters without leading or trailing hyphens, at most 253
 * characters, an alphabetic (or xn--) top-level label, and no IP address.
 */
export function domainProblem(domain: string): DomainProblem | null {
  if (!domain || domain.length > DOMAIN_MAX_LENGTH || !/^[a-z0-9.-]+$/.test(domain)) return 'domain_invalid';
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(l => !LABEL.test(l))) return 'domain_invalid';
  const tld = labels.at(-1)!;
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return 'domain_invalid';
  if (labels.some(l => /^xn--/.test(l) && l.length < 5)) return 'domain_invalid';
  if (RESERVED_TLDS.includes(tld) || within(domain, RESERVED_DOMAINS)) return 'domain_reserved';
  if (PUBLIC_SUFFIXES.includes(domain) || ownLabels(domain).length === 0) return 'domain_public_suffix';
  if (within(domain, DISPOSABLE_DOMAINS)) return 'domain_disposable';
  const registrable = ownLabels(domain).at(-1)!;
  if (within(domain, FREE_MAIL_DOMAINS) || FREE_MAIL_LABELS.includes(registrable)) return 'domain_free_mail';
  return null;
}
/** Words that say nothing about which organization a name or a domain label means. */
export const GENERIC_TOKENS: readonly string[] = ['the', 'and', 'of', 'for', 'inc', 'incorporated', 'llc', 'llp', 'ltd', 'limited', 'plc', 'co', 'corp', 'corporation', 'company', 'companies', 'group', 'holding', 'holdings', 'gmbh', 'ag', 'sa', 'sas', 'srl', 'spa', 'bv', 'nv', 'ab', 'as', 'oy', 'pte', 'pty', 'kk', 'technologies', 'technology', 'tech', 'systems', 'solutions', 'services', 'service', 'international', 'intl', 'global', 'worldwide', 'labs', 'lab', 'partners', 'bank', 'financial', 'capital', 'industries', 'enterprises', 'america', 'american', 'united', 'national', 'digital', 'software', 'health', 'mail', 'email', 'mx', 'smtp', 'www', 'web', 'online', 'net', 'app', 'apps', 'hq', 'us', 'usa', 'uk', 'eu', 'corporate', 'careers', 'jobs', 'team', 'staff', 'employees', 'office'];
/** Lowercase letter-and-digit tokens of a name, generic words and words shorter than 3 characters left out. */
export function significantTokens(name: string): string[] {
  const words = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean);
  const kept = words.filter(w => w.length >= 3 && !GENERIC_TOKENS.includes(w));
  // The whole name run together ("Wells Fargo" → "wellsfargo"), and without its generic words, also count.
  const joined = [words.join(''), words.filter(w => !GENERIC_TOKENS.includes(w)).join('')].filter(t => t.length >= 4);
  return [...new Set([...kept, ...joined])];
}
/** The registrable label of a domain with its hyphens removed: 'mail.wells-fargo.com' → 'wellsfargo'. */
export function domainLabelKey(domain: string): string {
  return (ownLabels(domain).at(-1) ?? '').replace(/-/g, '');
}
/** A name or alias as one run of lowercase letters and digits, accents removed ('Wells Fargo' → 'wellsfargo'). */
export const compactName = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** A name's lowercase words, accents removed and '&' read as 'and' ('Wells Fargo & Co.' → wells, fargo, and, co). */
const nameWords = (name: string) => name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean);
/**
 * Every exact form a registrable label may take to name this name or alias: its significant words, the whole name run
 * together or joined by hyphens at its own word breaks (with and without its generic words), and the name compacted
 * ('Wells Fargo' → wells, fargo, wellsfargo, wells-fargo). A hyphen is accepted only where the name has a word break, so
 * 'sch-wab' is not 'schwab'.
 */
export function exactLabelKeys(name: string): Set<string> {
  const words = nameWords(name), core = words.filter(w => !GENERIC_TOKENS.includes(w));
  const joined = [words, core].filter(w => w.length > 1).flatMap(w => [w.join(''), w.join('-')]);
  return new Set([...significantTokens(name), compactName(name), ...joined].filter(k => k.length >= 2));
}
/**
 * The deterministic half of attaching a domain to an existing listing (owner decision 4): the primary label of the
 * domain's REGISTRABLE name (the label left of its public suffix, so 'schwab.co.uk' → 'schwab'; never a subdomain
 * label) is EXACTLY one of the employer's significant words, its whole name run together or hyphenated at its own word
 * breaks (with or without its generic words), or one of its curated aliases in the same forms. Nothing else counts: no
 * containment, no extra words, no stray hyphen, no subdomain label. 'schwab.com', 'mail.schwab.com' and
 * 'charles-schwab.com' match Charles Schwab; 'schwab.attacker.com', 'notschwab.com', 'schwab-careers.com',
 * 'sch-wab.com', 'schwabmail.net' and 'charles-schwab-corporate-email.com' do not; 'gs.com' matches Goldman Sachs only if
 * 'gs' is an alias. A suffix missing from PUBLIC_SUFFIXES makes its own label the registrable one ('schwab.us.com' →
 * 'us'), which fails closed. A domain that passes still needs Jev's reading at PLAUSIBLE_AT (community.ts), because a
 * label can equal a word of the name on another suffix ('schwab.co') or be a common word ('charles.com').
 */
export function sharesSignificantToken(domain: string, names: readonly string[]): boolean {
  const label = ownLabels(normalizeDomain(domain)).at(-1) ?? '';
  if (label.length < 2 || GENERIC_TOKENS.includes(label) || GENERIC_TOKENS.includes(label.replace(/-/g, ''))) return false;
  return names.some(n => exactLabelKeys(n).has(label));
}
/** Words that start a domain label without naming anyone ('getacme', 'tryacme', 'joinacme'). */
const LABEL_PREFIXES: readonly string[] = ['get', 'try', 'use', 'join', 'go', 'my', 'hello', 'we', 'its', 'our', 'team', 'work', 'official', 'the'];
/** Every form of a domain label with generic words peeled off its start or end: 'getacmehq' → getacmehq, acmehq, getacme, acme. */
export function labelVariants(label: string): string[] {
  const affixes = [...new Set([...GENERIC_TOKENS, ...LABEL_PREFIXES])].filter(a => a.length >= 2);
  const seen = new Set([label]), queue = [label];
  while (queue.length && seen.size < 64) {
    const current = queue.shift()!;
    for (const affix of affixes) for (const next of [current.startsWith(affix) ? current.slice(affix.length) : '', current.endsWith(affix) ? current.slice(0, -affix.length) : '']) {
      if (next.length >= 2 && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return [...seen];
}
/** Initials of a name's words, 'and', 'of', 'the' and 'for' left out ('Procter & Gamble' → 'pg'); '' below two letters. */
export function nameInitials(name: string): string {
  const words = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(w => w && !['and', 'of', 'the', 'for'].includes(w));
  const initials = words.map(w => w[0]).join('');
  return words.length >= 2 && initials.length >= 2 ? initials : '';
}
/**
 * Whether a new listing's domain plainly belongs to the name it is listed under, deterministically (review of
 * 2026-09-23: without this, anyone could list 'Acme Holdings' with wellsfargo.com and hold that domain). The registrable
 * label, hyphens removed and with generic words peeled off either end, equals one of the name's significant words, the
 * name run together (with or without its generic words), or the name's initials: acme-widgets.io and getacmehq.com for
 * Acme Widgets, pg.com for Procter & Gamble, ibm.com for International Business Machines. When it does not, the worker
 * asks Jev instead (bwater.com for Bridgewater Associates).
 */
export function nameMatchesDomain(domain: string, name: string): boolean {
  const label = domainLabelKey(domain);
  if (label.length < 2) return false;
  const initials = nameInitials(name);
  const keys = new Set([...significantTokens(name), compactName(name), ...(initials ? [initials] : [])].filter(k => k.length >= 2));
  return labelVariants(label).some(v => keys.has(v));
}
