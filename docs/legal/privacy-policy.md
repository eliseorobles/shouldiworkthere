<!-- Generated from worker/src/legal.ts. Make agreed changes there and regenerate; the live page renders the same source. -->

> This is the review copy of the live page. Version 1.2.0 is recorded as approved by counsel (LEGAL_REVIEWED_VERSION in shared/brand.ts, set on the owner’s statement), so the live page carries no draft notice.
>
> Rendered for the current configuration: real-employer publication enabled, with written accounts in batches of at least 5; real-employer juries active (a jury forms when enough jurors can serve); fictional sample employers not shown; practice juries for fictional employers not available; adding employers open to anyone; in-product challenges open; trustee exceptions not active; crisis card shown; publisher rate-limit hash keyed; server crisis resources on; self-harm screening question on. Passages that change with these switches are selected in `worker/src/legal.ts`.
>
> Open items (owner facts in `shared/brand.ts`). The owner decided on September 22, 2026 that the model provider’s facts, the DMCA registration and the EU, EEA and UK items do not block launch. The pages never present an open item as resolved.
> - TypeSafe's legal entity, processing location, retention of inputs, training use, data processing agreement and safeguard for transfers of EU, EEA and UK personal data are not confirmed. The privacy policy says so.
> - The company that carries calls to +1 940-240-8554 (and stores any voicemail) is not named, and the safeguard for EU, EEA and UK personal data it handles is not stated. The privacy policy lists it by category until it is.
> - The DMCA designated agent is not registered with the US Copyright Office, and its name, postal address and telephone number are not published.
> - The pages give only a private mailbox (PMB) as the postal address for legal notices; no registered agent or street address for service of process is named. Decide with counsel whether to name one (REGISTERED_AGENT).
> - **EU, EEA and UK.** No representative in the EU under GDPR Article 27 is appointed. The privacy policy says the appointment is pending. The Article 27(2) exception is unlikely to cover continuous processing that can include special category data.
> - **EU, EEA and UK.** No representative in the UK under UK GDPR Article 27 is appointed. The privacy policy says the appointment is pending.
> - **EU, EEA and UK.** No legal representative in the EU under Digital Services Act Article 13 is appointed; the Act has no size exemption for it. The terms say the appointment is pending. Once one is, add an official language of its member state to the languages we use with authorities (Article 11).
> - **EU, EEA and UK.** The data protection impact assessment (GDPR Article 35) is being prepared and is not complete. Article 35(1) requires it before the processing starts. The privacy policy says it is in preparation.
> - **EU, EEA and UK.** The UK Online Safety Act illegal content risk assessment and children’s access assessment are not complete. A new user-to-user service completes them before UK users can access it. The terms say they are not yet complete.
> - **EU, EEA and UK.** Counsel has not chosen the Article 9 condition, or the national freedom-of-expression exemption (GDPR Article 85; UK Data Protection Act 2018), for sensitive information about other people that is published despite the content rules. Set THIRD_PARTY_SENSITIVE_DATA_BASIS. The privacy policy says it is not yet confirmed.
> - **EU, EEA and UK.** Counsel has not confirmed the Article 9 condition for the server’s support-resources checks (the publisher’s crisis phrase check and Jev’s optional self-harm question during screening), which handle text that may reveal the author’s health only to offer support resources and store nothing. Set SUPPORT_CHECKS_SENSITIVE_DATA_BASIS. The privacy policy says it is not yet confirmed.
>
> Review drafts that were never published, and are not listed in the public version history: 1.0.0 (First versioned privacy policy, terms of use and accessibility statement. Names the legal operator and contacts, lists retention limits and service providers, sets Texas law and venue and the 18+ requirement, and keeps the privacy architecture explanation.)

# Privacy policy

What Should I Work There collects, where it goes, how long it stays and what you can do about it. This policy describes the running system, including its limits.

Version 1.2.0, effective September 23, 2026.

## Who we are

Should I Work There, at shouldiworkthere.com and verify.shouldiworkthere.com, is operated by Robles Consulting LLC, a Texas limited liability company (“we”, “us”). We decide how the personal data described here is used and are responsible for it.

- Privacy questions and requests: [privacy@shouldiworkthere.com](mailto:privacy@shouldiworkthere.com)
- Legal notices: [legal@shouldiworkthere.com](mailto:legal@shouldiworkthere.com)
- Copyright notices: [dmca@shouldiworkthere.com](mailto:dmca@shouldiworkthere.com)
- Postal mail: 100 Plaza Pl, Ste 300, PMB 58, Northlake, TX 76226, USA
- Telephone: +1 940-240-8554

Should I Work There is a preview. Some protections described in our [constitution](https://shouldiworkthere.com/constitution) are not active yet: the two-of-three trustee process for legal orders and safety issues. This policy says what happens until they are.

## The short version

- We have no accounts and never ask for your name.
- The separate verifier uses your work email address only to send a one-time code. We do not store the address; we keep keyed hashes of it until the quarter ends. Cloudflare, which delivers the email, keeps a delivery record that our account can see for up to 30 days.
- Anyone can ask the verifier to email any address at a listed employer’s email domain, and anyone who can read that mailbox, including your employer, can see these emails.
- Anyone can add an employer to the directory with its name and work-email domain. The listing shows the domain and says it was added by the community; nothing about who added it is kept with it.
- Before the verifier sends a code, before juror tokens are issued and before a new employer is listed, your browser solves a short proof-of-work puzzle. It is computed on your device and adds nothing about you to the request.
- Drafts stay in your browser. A draft is sent for automated screening only after you approve it and consent.
- We do not sell or share personal data, and we use no advertising, analytics, cookies, tracking pixels or session replay.
- You can withdraw a contribution at any time with the withdrawal capability shown once when you submit.
- Local checks and delayed, batched release reduce the risk that you are identified. They cannot guarantee anonymity.

## How the system is divided

Should I Work There runs as three separate services on Cloudflare Workers:

- **The verifier** (verify.shouldiworkthere.com) checks that you control a mailbox at an employer’s listed email domain and then blindly signs a credential that your browser prepared, using RFC 9474 blind RSA signatures. It keeps the list of employer email domains and the signing keys for each employer. It never receives testimony and cannot call the model.
- **The publisher** (shouldiworkthere.com) checks a credential’s signature itself and handles contributions, withdrawals, the employer directory and the public record. It has no access to the verifier’s database or signing keys. When someone adds an employer, the publisher registers the employer’s domain with the verifier over a private connection between the two services, authenticated with a secret they share, and copies that employer’s public keys back; a scheduled job does the same for keys the verifier creates later. When a listing is corrected, the publisher asks the verifier over the same connection to take its domain down. That connection carries directory information about employers and their public keys only, never a contribution, a question, an email address or anything about a person. The publisher never contacts the verifier to check a credential: it checks the signature against the copy of the key it already holds, and it accepts a key created for a domain added by the community only while that employer still has a domain added by the community in the directory. A key the verifier creates for an employer added by the community becomes usable only once the publisher has copied it, when the listing is added or by a job that runs every 6 hours; until then your browser does not use that key, because it uses a key only when both services publish it identically.
- **The inference service** runs Jev for search, screening and analysis. It has no public address; only the publisher is connected to it, and it is the only service that holds model credentials.

Because the signature is blind, the verifier cannot link the credential it signed to the contribution that later uses it. This is separation between services, not independent custody: all three run in the same Cloudflare account under the same operator. Whoever controls that account, including us, could change the code to collect more. We publish the [source code](https://shouldiworkthere.com/source) so changes are visible, but publishing it is not an independent audit.

**What the verified label means.** “Work mailbox verified” means someone controlled a mailbox at an email domain listed for that employer at the time of verification. Beside such an account, readers see the domains listed for the employer when they read it, which are not necessarily the domain the author used: we do not record which domain that was, and the list can change after publication. It does not prove legal identity, job title, current employment, or that each contribution comes from a different person. For an employer added by the community, or a domain someone added to one of our own listings, the domain was supplied by whoever added it and checked only automatically (see [When you add an employer](#adding-employers)), so the label shows control of a mailbox at that domain, not that the domain belongs to the employer named. Former-worker attestation is not supported yet.

## What we collect, part by part

### In your browser

- Your draft, your edits and the results of the local privacy check stay in the page’s memory. Our code does not save them to browser storage, and they are gone when you close or reload the page. Your browser’s own features, such as session restore or form autofill, may still keep what you type; on a shared or employer-managed device, use a private window. Your draft leaves your device only when you choose to screen or submit it.
- On the draft, the repair editors and the reason for a challenge, we turn off the browser’s spell check and ask writing-assistant extensions, such as Grammarly and LanguageTool, not to run. Extensions that ignore these requests can still read the page.
- Employer names, published group labels, documented events and topics are recognized on your device as you type. A submitted question that is only the name of a listed employer opens that employer without being sent anywhere.
- The last question you submitted and the view you are on are kept in the tab’s session history, so Back and Forward work. Browsers may save session history to disk to restore tabs. Page addresses and share links carry only public identifiers, such as an employer, a view, a published group or a documented event, never your question; a group or sector that nothing publishes is dropped from a link.
- If you choose a light or dark theme, your browser stores that choice (local storage, “siwt-theme”); it is removed when you return to your system’s theme.
- If you switch Live understanding on or off, your browser stores that choice (local storage, “siwt-live”, the value on or off only) so it is remembered on this device. Nothing about what you type is stored.
- A local check may show crisis support resources if what you type suggests that you or someone else may be at risk of harm. It runs only on your device; nothing about it is stored, sent or reported.
- Before your browser asks the verifier to email a code or to issue juror tokens, and before it adds an employer to the directory, it solves a proof-of-work puzzle in a background thread (a Web Worker): it searches for a number whose SHA-256 hash, together with the request, starts with about 20 zero bits, which usually takes about a second. The puzzle is tied to this site, the action, the signing key it concerns (if any), a digest of what the request is about (the email address you entered, the blinded request or the domain) and the current minute, and is accepted for about 2 minutes either side, so an answer cannot be reused for a different request. It is computed only on your device, and the answer adds nothing about you to the request it goes with: the server checks only that it fits that request. It makes sending many requests costly; it does not identify anyone.
- If you choose, your browser keeps the signing key for a contribution in its local database (IndexedDB), filed under a value derived from your withdrawal capability. The key cannot be exported. It stays until you withdraw from that browser or clear the site’s data.
- If you choose, your browser keeps a finished credential proof so you can submit later. It stays until you use it, discard it or it expires; expired proofs are deleted the next time the contribution page lists them.
- If you choose, while a work-mailbox verification is unfinished, your browser keeps the blinded request it sent to the verifier and the values that finish it (never your email address or the code), so a reload or a lost reply cannot lose the credential or tokens. Because it links the verifier’s request to the finished credential or tokens, it never leaves the device, and it is deleted once they are finished, when you give up, or when it has expired and the page next lists it.
- If you choose, your browser keeps unused juror tokens so you can serve later. They stay until you use or discard them, or they expire; expired tokens are deleted the next time the jury page lists them.
- This local database exists only while it holds something you chose to keep. While it does, the contribution page says what it holds and offers to delete all of it. Anyone who can open your browser profile, including an employer that manages the device, could find these saved items. Keep them only on a personal device you control.
- We set no cookies. The site registers a minimal service worker that caches nothing.

### At the verifier

- **Your work email address.** Used in memory to check that it belongs to an employer’s listed email domain and to send an email through Cloudflare’s email sending service. We do not store it in our databases. Cloudflare keeps a delivery record of each message, with the recipient address, subject line, time and delivery status, which our Cloudflare account can view for up to 30 days. We do not copy these records into our databases.
- **What the email reveals.** The verifier cannot tell who is asking, so anyone can ask it to email any address at a listed employer’s email domain. Because anyone can add an employer with its domain, that can be almost any organization’s mail domain that is not a free or disposable email provider. Each request needs a proof-of-work answer from the requester’s browser. Every email it sends has the same sender, subject line and wording, which name Should I Work There, and contains a new code, whether or not the mailbox already received a credential or its juror tokens this quarter. The limit of one credential per employer and quarter, and of one set of up to 3 juror tokens, is applied only when the code is used. Anyone who can read the mailbox, including an employer that monitors it, can therefore learn that a code was requested for it, and whoever uses the code learns whether the mailbox can still obtain a credential or juror tokens this quarter. No more than three emails are sent to the same mailbox in any 15 minutes, counting credentials and juror tokens together; after that, requests for it send nothing until the window has passed, whoever makes them. For an employer added by the community, or a domain someone added to one of our listings, the verifier also sends at most 40 verification emails per UTC day for that employer, and 1,000 per UTC day for all such employers together; over either limit, a request is answered in the same way and no email is sent, so anyone can use up an employer’s emails for the day, and a code requested after that may not arrive until the next UTC day. The verifier’s response to a request is the same either way.
- **A keyed hash of your mailbox** (lowercased, with any “+tag” removed), combined with the employer and the calendar quarter. It limits each mailbox to one credential per employer per quarter. A separate keyed hash, stored with the number of tokens issued, lets each mailbox receive juror tokens once per employer and quarter, as one set of up to 3. Neither can be reversed without our secret key. We hold that key, so given a specific address we could check whether that mailbox obtained a credential or juror tokens this quarter.
- **For each code request:** the keyed mailbox hash above, a keyed hash of the mailbox alone (used only to limit the emails sent to it), a keyed hash of the code, an attempt counter, an expiry time 15 minutes later and, once a credential or a batch of juror tokens is signed, a hash of the blinded message or batch. The blinded message cannot be linked to your finished credential or tokens.
- **Counts per employer, with no mailbox.** For real employers, the verifier counts credentials and juror tokens issued per employer and quarter, and per hour, to enforce the published caps, and records a pause when a sudden burst of requests trips the limit (see the [transparency page](https://shouldiworkthere.com/transparency)). Employers added by the community start with conservative caps: 50 credentials and 50 juror tokens a quarter. For those employers the verifier also counts the verification emails it sends each UTC day, per employer and for all of them together, to apply the email limits described above; these counts name the employer, never a mailbox.
- **Employer domains and keys, with no mailbox.** The verifier keeps each listed employer’s email domain, including domains registered by the publisher when someone adds an employer (see [When you add an employer](#adding-employers)), with the quarter it was registered. When such a domain is registered, and again for each new quarter, the verifier creates that employer’s contribution and juror signing keys, stores the private halves encrypted, and publishes the public halves at verify.shouldiworkthere.com/keys, marked as community keys. If we take a listing’s domain down after a correction request (see the terms), the verifier deletes that domain and its keys at once and keeps a record of the listing’s page identifier, the domain and the quarter, so that neither can be registered again unless we re-admit it.
- **Your IP address,** used in memory as a rate-limit key (see “On the network” below).

### At the publisher

When you submit, the publisher’s private intake database receives:

- The approved text, the contribution type (experience, claim or opinion), the broad reporting quarter you chose, the employer and the verification type.
- Your optional questionnaire answers.
- The public half of a signing key your browser created for this contribution only, so you can sign later changes.
- A hash of your withdrawal capability. We never store the capability itself.
- Whether you allowed anonymous jurors to read these words, with detected identifiers masked, if screening holds them for a jury (yes or no; no unless you choose it).
- Whether you checked the statement that your account may reveal sensitive information about you and that you choose to publish it (yes or no; unchecked unless you check it).
- A nullifier (a hash of the credential) so the same credential cannot be used twice.
- A hash of the text, the calendar day of submission and, if the case is held, the day it was held and why, such as for a jury or by the privacy re-check. These time the retention limits and are erased at publication, withdrawal or expiry.
- If a published account is withheld for repair, its original public fields (never anything about its author), so that it can be restored under the same public identifier. They are erased with the rest of the record.
- For each signed change you make, a hash of part of its signature, kept 181 days so the same request cannot be replayed.
- A decision record for each step (submit, revise, hold, withhold, restore, publish, withdraw or expire, and jury and appeal outcomes): the rules that applied, the quarter, the policy version and digest, and the model, provider and prompt version used for screening. It contains no text and cannot be edited or deleted.

**Publication.** A contribution is published only after screening, a random delay of 12 to 72 hours, and only in a batch of at least 5 accepted contributions for the same employer and verification type. A batch that small hides less than a large one: someone who knows who contributed about an employer around the same time can tell who wrote which account more easily among five accounts than among many, so leave out details that only you would know. An account submitted before September 23, 2026, under the previous version of these documents, keeps the rule it was accepted under: it is published only in a batch of at least 25 accounts submitted before that day, for the same employer, reporting quarter and verification type, and never together with later accounts. Its text is then copied to the public database under a new random identifier, with the employer, contribution type, reporting quarter, verification label and release quarter, and the intake copy of the text is erased. Beside a work-mailbox verified account, readers also see the email domains listed for the employer when they read it. The intake record keeps a link to the public identifier so a withdrawal can remove the public copy, and it keeps your answers so aggregates can be recomputed. Individual answers are never copied to the public database.

**Aggregates.** Questionnaire results are published only as percentages and answer bands, computed by a scheduled job, for groups with at least 25 published contributions, and each figure needs at least 25 answers, so a group’s first batches of written accounts can be published before any of its figures are. A withdrawal removes the affected group’s published figures at once. They are published again only after at least 5 further publications or withdrawals, and only while at least 25 contributions remain.

**Readings of published text.** After publication, Jev reads each published account and records structured readings, such as whether it describes a layoff or how it describes workload, and compares it with other published accounts for the same employer. These readings are stored with the public record and deleted with it. Risk signals, such as whether text might identify someone, are computed only for your unpublished draft and are not stored.

**Search.** When you submit a question, or while Live understanding is on (it is on by default and starts off when your browser sends a Global Privacy Control signal; if you switch it on or off yourself, that choice is remembered on your device and takes precedence), what you typed is sent to the inference service to interpret it. When a submitted question is understood with confidence, it also goes to the inference service’s retrieval step, which does nothing while the optional semantic index is not set up, and to Jev to rank up to 12 published accounts by relevance. Questions containing direct identifiers, such as email addresses or phone numbers, are refused before they reach Jev. We do not store your question. If you choose to share the topic, we add one to a count kept for a standard question identifier, the employer and the quarter, at most once per question, network and day; your wording is not kept. Counting once a day needs a daily network record that names the employer and the standard question; see “On the network” below.

### At the inference service

- Search text, when you submit a question, and as you type while Live understanding is on.
- Your approved draft, after you consent to screening. The inference service returns risk probabilities and does not store the text; what TypeSafe does with it is described under “Jev and automated decisions”. Screening also asks one optional question about your own safety; see [Support resources](#support-resources).
- Published accounts, for relevance ranking and structured readings. An hourly job reads up to ten published accounts whose readings are missing or out of date.
- The reason given in a challenge, with detected identifying details masked, and the rule it cites, and the challenged account’s published text, as described under “When you challenge an account or serve as a juror”.
- The name and domain of each employer someone adds, as described under [When you add an employer](#adding-employers).
- Daily counts of model calls, failures and fallbacks by purpose and provider, used to enforce daily budgets (45,000 calls for submitted searches and checks of new listings, 45,000 for Live understanding, 5,000 for screening, 4,000 for reading published accounts and 1,000 for challenge reasons). Separate short-term failure counts, used to switch providers, are removed once they are more than a day old, the next time a failure is recorded. No text.

### On the network

Cloudflare receives your IP address and standard request details, such as your browser type, each time you connect, in order to deliver and protect traffic. Cloudflare keeps its own operational records under its privacy policy.

Our code reads your IP address only in memory, to rate-limit requests. The publisher uses a daily keyed hash of it (HMAC-SHA-256 with a secret key) and the verifier an hourly keyed hash; each is handed to Cloudflare’s rate limiter for a 60-second window. For an IPv6 address, these keys use only its /64 network prefix, which one household, line or server usually holds. We do not write IP addresses to our databases, and application logging is turned off for all three services. The hashes are not anonymous to us: we hold the keys, so we could test a guessed address against them.

**Daily network records.** Some limits need to remember a network for the rest of a UTC day: counting interest in a standard question at most once per question and day, allowing each network at most 5 challenges a day, and allowing each network at most five attempts a day to add an employer, and each wider network at most 15. For these, the publisher stores a keyed hash (HMAC-SHA-256 with a secret key) of the day, the purpose and a hash of your IP address (for IPv6, of its /64 prefix), never the address itself: in the public database for question interest, and in the private intake database, with a count, for the challenge limit and the listing limit. For question interest, the purpose names the employer and the standard question, and the record is made only when you choose to share the topic. For the challenge limit, the purpose is only “challenge”: it names no account, rule or employer. For the listing limit, the purpose is only “employers”: it names no employer or domain, and a second record for it uses a hash of your wider network (the IPv4 /24 or IPv6 /48 that contains your address) instead of your address. Each record is deleted once its day has ended, by a job that runs every 6 hours. These records are not anonymous to us: we hold the key, so given a guessed address we could test whether a record matches it, and for question interest, whether that network shared interest in a given standard question about a given employer that day. After a record is deleted, it can remain in the databases’ recovery history for up to 30 days, where a court order could require us to recover it.

### When you challenge an account or serve as a juror

- **Challenging an account.** A challenge sends the account’s public identifier, the rule you cite and your reason, up to 500 characters. Your reason is checked for identifying details on your device and again by the publisher, which refuses it if it finds a direct identifier. The publisher then masks any other identifying details it detects and sends only the masked reason and the public text of the rule to the inference service, so that Jev can check whether the reason fits the rule. If Jev is unavailable, has failed in the last 15 minutes, or has already made 1,000 such checks that day, our code instead looks for the rule’s published ground terms in your reason. We do not store your reason.
- **Challenge receipts.** We store a receipt for each challenge: the account, the rule, the policy version and digest, how the challenge was decided, the outcome, whether Jev or the ground terms judged the reason, any jury case it joined, and the quarter. It names no one and holds no reason. You see the receipt once, when you send the challenge; if it leads to the account being withheld, you are told only that it was withheld under the published rules. The account’s author sees each receipt on the status page, with the rule and the model that re-checked the words.
- **Re-checks.** If your reason fits the rule, the published account is checked again under the current policy: first by our local identifier check and then, unless that finds a direct identifier, by Jev. An account is re-checked at most once under each policy version, and at most 100 re-checks by Jev run each day, plus 50 reserved for challenges under the privacy and safety rules (PRIV-04, PRIV-05, SAFE-01 and SAFE-02), which are re-checked first. If a re-check cannot run when your challenge arrives, because the day’s re-checks are used up or Jev is unavailable, your challenge is not refused: it is queued with a receipt, and a scheduled job re-checks queued challenges as capacity returns, the privacy and safety ones first. The account stays published meanwhile. A queued challenge stores the account, the rule, the policy version and digest, how its reason was judged and the quarter, never the reason, and is deleted once it has been re-checked. We keep the decision, the rules that applied and the model and provider used, not the risk probabilities, while that policy version is current. If the account is withheld for repair, its text is removed from the public database and copied back to the private intake database as a held case, where its author can repair or withdraw it; it is then erased like any other held case.
- **Challenge limits.** Each network can send at most 5 challenges a day, counted under the daily network record described under “On the network”, and a challenge whose reason does not fit the cited rule uses two more. A challenge refused before it is considered, because its reason contains an identifying detail or the account is not published now, uses none of that daily budget. Cloudflare’s rate limiter also limits challenges per minute, under the hash of your IP address described there.
- **Juror tokens.** To serve as a juror you get anonymous juror tokens from the verifier: one set of up to 3 per work mailbox, employer and quarter. They are signed blindly, like credentials, so a token cannot be linked to the request that obtained it. The verifier still sees when tokens are requested and the publisher sees when each one is used, so someone holding both services’ records could try to match those times. Tokens for a real employer need the same emailed code as a credential and a proof-of-work answer, and the verifier keeps the keyed mailbox hash described under “At the verifier” until the quarter ends.
- **Serving.** Using a token gives you one seat on one randomly drawn case. It is never a case about your token’s employer. The publisher records that the token was spent (a hash of it, kept until the token’s key expires, so it cannot be used twice) and stores the seat under a hash of a secret that only your browser holds, with the seat’s expiry and your vote. It does not store the token, your mailbox or your IP address with the seat. On a real employer’s case, the seat also records a keyed hash (HMAC-SHA-256 with a secret key) of the case and your token’s employer, so that no employer fills more than two seats on a case. We hold the key, so we could work out that employer while the seat exists. For a token of an employer added by the community, the hash is of the case and one group shared by all such tokens instead, so that together they fill at most one seat on a case; the seat then shows only that the token was of that group. You see only the rule, the question and the passage, with detected identifiers masked. Words that are not yet published reach jurors only if their author allowed juror review. Seats and votes are deleted when the case closes, and an unused seat when it expires after 48 hours. The case keeps only the vote totals and the outcome; its passage is erased when it closes.

### When you contact us

Messages to our contact addresses are forwarded by Cloudflare Email Routing to a mailbox we control, provided by Google LLC (Google Workspace, United States). Cloudflare keeps a record of each forwarded message (sender, recipient, subject line, time and status) that our account can view for up to 30 days. Messages include your email address and whatever you write, so emailing us is not anonymous. If you call us, we see your phone number unless you withhold it, and our telephone provider carries the call and stores any voicemail you leave. Do not include a draft, a withdrawal capability or identifying details unless you need us to act on them. We keep correspondence, and any notes of calls, only as long as needed to deal with them and any related legal obligation.

## When you add an employer

Anyone can add an employer that is not in the directory, without an account. Listing an employer is separate from verifying: it lets people find the employer and request codes for its domain, and it reveals nothing about anyone who later contributes about it.

- **What you send.** The employer’s name (up to 80 characters), a work-email domain it uses for its staff, and a proof-of-work answer computed by your browser (see “In your browser” above). No email address and no contribution.
- **Checks.** The publisher refuses a name that contains identifying details about a person, such as a name, an email address, a phone number, a street address or a link, or an insult, profanity, accusation or slur; a name with invisible characters or that mixes Latin, Cyrillic and Greek letters; and a name that contains a web address other than the domain it is listed with. It refuses a domain whose words contain an insult, profanity, accusation, slur or identifying details, since the domain is shown beside the name. It checks that the domain is a valid host name, is not a free, disposable or reserved email domain on our list, and has mail (MX) records, which it looks up through Cloudflare’s public DNS resolver (cloudflare-dns.com); the lookup sends the domain name, not anything about you. A domain that is already listed, or whose parent domain is, cannot be listed again, and the verifier also refuses a domain that is a parent or a subdomain of one it already holds, and a listing, a domain or a subdomain of a domain that was taken down after a correction. A name that means an employer already listed with a domain, including the same name with words such as “Inc.” or “Staff” or spelled with look-alike letters, is refused, unless the domain is added to one of our listings of that name that has no domain yet, as described below; and a domain whose own name is a listed employer’s name or one of its known alternative names can be listed only under that employer’s name. The domain’s own name (the part before the public suffix, such as “acme” in mail.acme.com, without hyphens) is expected to carry the employer’s name: one of its words, the whole name run together or its initials, ignoring generic words such as “careers” or “hq”. Jev is then asked whether the name is an organization’s name, whether the name or the domain is abusive and, when the domain does not carry the name, whether it is plausibly that organization’s email domain. A name Jev judges unlikely to be an organization, a name or domain it judges likely to be abusive, and a domain that does not carry the name and that Jev judges less than 30% likely to be the organization’s email domain are refused.
- **Adding a domain to an existing listing.** If the name matches a listing we made that has no domain yet, Jev is also asked whether the domain is that employer’s corporate email domain. The domain is added to that listing only if Jev judges it at least 85% likely and the domain’s own name is exactly a significant word of the employer’s name or of one of our known alternative names for it, or one of those names written as one word or with hyphens between its words: schwab.com and charles-schwab.com can be added to Charles Schwab, but schwabmail.net, notschwab.net, schwab-careers.com, schwab.attacker.com or charles-schwab-corporate-email.com cannot. Otherwise the employer is listed separately, with the domain beside its name. A listing of ours that receives a domain this way keeps its name; the domain appears beside each work-mailbox verified account under it and on the employer’s page, marked as added by the community, because whoever added it, not we, supplied it.
- **Registration.** The publisher then registers the domain with the verifier (see “How the system is divided”). If the verifier already holds the domain for another employer, the new listing is withdrawn at once.
- **What is kept.** In the public directory: the name, the domain, an identifier for the page address, a note that the listing was added by the community, and when it was added. The verifier keeps the domain with the employer and the quarter it was registered, and creates the employer’s signing keys (see “At the verifier” above). If the domain is later taken down after a correction, the verifier keeps a record of the listing’s page identifier, the domain and the quarter so that they cannot be registered again, and the public log of listing corrections records the correction (see the terms). Nothing about who added the listing is kept with it, and the log names no one who asked for a correction.
- **Limits.** Each network can make at most five attempts a day that pass the name and domain rules, and each wider network (an IPv4 /24 or IPv6 /48) at most 15, counted under daily network records whose purpose is only “employers” (see “On the network”), and at most 200 employers are added a day in total. Without the secret key for these records, no employer can be added.

A listing shows the domain beside the name, for example “Acme (acme.com)”, and says it was added by the community. The name and domain come from whoever added it, not from us or the employer. See [Employers added by the community](https://shouldiworkthere.com/terms#community-listings) in the terms for what a listing does and does not mean, and how to have a wrong one corrected.

## How long we keep it

*Retention by data type*

| What | Where | How long |
| --- | --- | --- |
| Draft, edits and local check results | Your browser, in memory | Until you close or reload the page (your browser’s own session restore or autofill may keep it longer) |
| Signing key (optional) | Your browser (IndexedDB) | Until you withdraw from that browser or clear the site’s data |
| Finished credential proof (optional) | Your browser (IndexedDB) | Until you use or discard it, or it expires |
| Unfinished work-mailbox verification (optional): blinded request and finishing values | Your browser (IndexedDB) | Until finished or discarded, or once expired, when the page next lists it |
| Unused juror tokens (optional) | Your browser (IndexedDB) | Until you use or discard them, or they expire |
| Theme choice (optional) | Your browser (local storage) | Until you return to your system’s theme or clear the site’s data |
| Your last submitted question and the view path | Your browser (the tab’s session history) | Until the tab’s history is gone; browsers may save it to restore tabs |
| Work email address | Verifier memory; Cloudflare email delivery records | Not stored in our databases. Cloudflare’s delivery record (recipient, subject line, time and status): up to 30 days |
| Code request records: keyed mailbox hashes, code hash, attempts, blinded-message hash | Verifier database | The code is valid for 15 minutes; the record is deleted by a job that runs every 15 minutes after that |
| One-credential-per-quarter record: keyed mailbox hash and blinded-message hash | Verifier database | Until the end of the calendar quarter in which the credential was issued, then deleted by the same job |
| Juror token count for a mailbox: keyed mailbox hash and number of tokens | Verifier database | Until the end of the calendar quarter, then deleted by the same job |
| Issuance counts per employer, purpose and quarter (no mailbox; real employers only) | Verifier database | Until the end of the calendar quarter, then deleted by the same job |
| Hourly issuance counts per employer and purpose (no mailbox; real employers only) | Verifier database | About 48 hours, then deleted by the same job |
| Issuance pauses per employer and purpose (real employers only) | Verifier database | Until the pause ends, then deleted by the same job |
| Held contribution, including a published account withheld for repair: text, answers, public signing key, hashes, dates and kind of hold | Publisher intake database | Erased about 30 days after it was held, unless repaired or withdrawn sooner. While a jury case about it is open, erasure waits for the case to close; if the jury reaches no decision, it is erased within about a day |
| Accepted contribution waiting for a batch: the same data | Publisher intake database | Erased about 180 days after submission if not published |
| Published text | Public database | Until you withdraw it |
| Answers and public signing key of a published contribution | Publisher intake database | Until you withdraw it |
| Readings and comparisons of published text | Public database | Deleted with the published text |
| Aggregate figures | Public database | Replaced when recomputed; removed at once when a withdrawal affects them |
| Credential nullifier | Publisher intake database | Until the credential’s signing key expires |
| Replay guard for each signed change: a hash of part of the signature | Publisher intake database | 181 days |
| Minimal record after withdrawal or expiry: status, employer, reporting and submission quarters, contribution and verification type, revision count and capability hash | Publisher intake database | Twelve months after the start of the month in which it was withdrawn or expired, the scheduled job replaces the capability hash with a random value and removes the employer and the quarters; only the status, the contribution and verification type and the revision count remain, with no fixed limit. It holds no text or answers; it lets a repeated withdrawal work and keeps public counts accurate. See “Withdraw” under your rights for what it can reveal |
| Decision records (no text) | Publisher intake database | No fixed limit; append-only |
| Challenge receipts (no reasons, no text) | Publisher intake database | Deleted by the scheduled job once they are more than four quarters old |
| Queued challenges: the account, the rule, the policy version and digest, how the reason was judged and the quarter (no reasons, no text) | Publisher intake database | Until re-checked, when the result is kept as a challenge receipt; deleted by the scheduled job once more than four quarters old |
| Re-check decisions: the decision, the rules and the model (no text) | Publisher intake database | While the policy version they were made under is current |
| Jury cases: rule, masked passage, vote totals and outcome | Publisher intake database | The passage is erased when the case closes; the rest is deleted by the scheduled job once it is more than four quarters old, except a decision about published words, which is kept while its policy version is current so that it stays final |
| Jury seats and votes | Publisher intake database | Deleted when the case closes; an unused seat when it expires after 48 hours |
| Spent juror token record (a hash of the token) | Publisher intake database | Until the token’s key expires |
| Shared-topic counts (opt-in) | Public database | No fixed limit; counts only |
| Employer listings added by the community: name, domain, page identifier, the community label and when it was added (nothing about who added it) | Public database; the domain and the employer’s signing keys also in the verifier database | Kept as part of the public directory; a listing is changed only if it is corrected, as described in the terms |
| Daily counts of verification emails sent for employers added by the community, per employer and in total (no mailbox or address) | Verifier database | Kept for the current and the previous UTC day, then deleted by the job that runs every 15 minutes |
| Record of a listing whose domain was taken down after a correction: its page identifier, the domain and the quarter (nothing about any person) | Verifier database | No fixed limit, so that the listing and the domain cannot be registered again; deleted only if we re-admit them |
| Public log of listing corrections: the kind of correction, the reason, the quarter and a digest of the listing’s page identifier (no name, requester or text) | Public database | Kept as a permanent public record; entries cannot be changed or deleted |
| Proof-of-work answers | Checked in memory by the verifier or the publisher | Not stored |
| Model-call counts (no text) | Public database | Daily totals: no fixed limit. Short-term failure counts for switching providers: removed once more than a day old, when the next failure is recorded |
| IP address hashes for rate limits | Cloudflare rate limiter | 60-second windows; never written to our databases |
| Daily network records: a keyed hash of the day, the purpose (for question interest, the employer and the standard question) and a hash of your IP address (for IPv6, of its /64 prefix), or, for the second listing record, of your wider network (IPv4 /24 or IPv6 /48) | Public database (question interest); publisher intake database, with a count (challenges and employer listings) | Deleted once the UTC day has ended, by a job that runs every 6 hours; then up to 30 days in the recovery history |
| Transparency archives: rounded counts, ledgers and digests | Cloudflare R2 | Kept as a permanent public record |
| Recovery history of all three databases | Cloudflare D1 point-in-time recovery | Up to 30 days after any change, including erasure |
| Email you send us, and notes of calls | Our mailbox; Cloudflare routing records | As long as needed to deal with it; Cloudflare’s routing record: up to 30 days |
| Call records (your phone number, time and length) and any voicemail, when you call us | Our telephone provider | Under the provider’s own retention terms, which we have not yet confirmed |

Retention limits are applied by scheduled jobs that run every 6 hours at the publisher and every 15 minutes at the verifier. Limits counted in days are checked against calendar dates, so erasure happens within about a day of the limit. Withdrawal takes effect immediately, including over a publication batch that is in progress.

Cloudflare D1, which holds our three databases, keeps a point-in-time recovery history. Data we erase, or that you withdraw, can remain recoverable from that history for up to 30 days. We would restore a database only to recover from data loss or corruption, or where the law requires it. During those 30 days, a court order could require us to recover erased data from this history, including withdrawn text and answers.

## Why we use data, and our legal bases

Some laws, such as the EU and UK GDPR, require a legal basis for each use of personal data. Ours are:

*Purposes and legal bases*

| Purpose | Data | Legal basis |
| --- | --- | --- |
| Verify control of a work mailbox and allow one credential per mailbox, employer and quarter | Email address in memory, keyed mailbox hash, code request records | Taking the steps you ask for, and our legitimate interest in preventing duplicate credentials |
| Screen an approved draft with Jev | Approved draft | Your consent, given with the screening checkbox. Without it, nothing is sent |
| Publish your contribution and compute aggregates | Approved text, optional answers, reporting quarter, employer | Your consent when you submit, and your explicit consent if you check the statement about sensitive information about you. You can withdraw at any time |
| Let anonymous jurors read held words | Held words, with detected identifiers masked | Your consent, given with the juror-review checkbox (off unless you choose it). Without it, no juror sees unpublished words |
| Record structured readings of published text and compare accounts | Published text | Our legitimate interest in making the public record searchable and comparable. The text is already public at that point |
| Publish what contributors say about other people | Whatever an account says about managers, coworkers or others, within the content rules | Our legitimate interest, and the public’s, in freedom of expression and in information about workplaces, limited by content rules that protect private individuals |
| Interpret and rank searches | Search text | Your request when you submit a question, or when you type while Live understanding is on (it is on by default, starts off under Global Privacy Control, and you can switch it off) |
| Count interest in standard questions | Question identifier, employer, quarter, and the day’s network record for that question and employer | Your consent (off by default) |
| Keep records after withdrawal or expiry, and decision records | Minimal records and decision records described above; no text | Our legitimate interests in accountability for automated decisions, accurate public counts and making a repeated withdrawal work |
| Handle challenges to published accounts and re-check them | The challenged account, the cited rule and your reason (sent to Jev, not stored), challenge receipts, re-check decisions, and the rate-limit hash of your IP address | Our legitimate interests in applying the published rules fairly and in preventing abuse of challenges |
| Issue juror tokens and run juries | Your email address in memory and a keyed mailbox hash (real-employer tokens), spent-token hashes, seats and votes | Taking the steps you ask for when you request tokens or serve, and our legitimate interest in limiting each token to one seat and each mailbox to a set number of tokens |
| Offer support resources when text you send suggests someone may be at risk of harm | The text you send, in memory only; nothing is stored | Our legitimate interest, and yours, in making help easy to find. For sensitive information, see [If you are in the EU, EEA or UK](#eu-uk) |
| Let anyone add an employer to the directory and set up its verification | The name and domain you enter, which describe an organization rather than you, and the checks of them described under [When you add an employer](#adding-employers) | Our legitimate interest, and the public’s, in a directory that anyone can extend without an account |
| Keep the service secure and available | IP address in memory, rate-limit hashes, daily network records, proof-of-work answers (checked, not stored), model-call counts | Our legitimate interests in security and availability |
| Reply when you email or call us | Your email address or phone number, and what you tell us | Our legitimate interest in answering you, and legal obligation where the request concerns your legal rights |
| Respond to legal requests and meet legal obligations | Only what a valid request covers | Legal obligation |
| Publish transparency archives | Rounded counts, ledgers and digests | Our legitimate interest in public accountability |

If your account includes sensitive information about yourself, such as your health or union membership, it is screened and published because you chose to include it and submit it. The contribution form has a separate statement for this, unchecked unless you check it, that your account may reveal sensitive information about you and that you choose to publish it. Do not include sensitive information about other people. For what this means under the GDPR and UK GDPR, see “Sensitive information” under [If you are in the EU, EEA or UK](#eu-uk).

## Jev and automated decisions

Jev is a classification model made by TypeSafe. It answers narrow questions with probabilities: yes or no, a choice between set options, or a score. It does not write answers, summaries or opinions for this site. Every number you see is computed by our code from released data.

**How we reach Jev.** Normally the inference service calls Jev through Cloudflare Workers AI and AI Gateway, using our TypeSafe key stored in AI Gateway. Every request turns gateway logging off and skips the gateway cache. If that path fails, or has failed at least three times in the last 10 to 20 minutes, the inference service calls TypeSafe’s own API directly. Each result records which path served it. On either path, TypeSafe processes the input on its systems to produce the answers.

**What TypeSafe keeps.** We have not yet confirmed TypeSafe’s legal entity, where it processes data, how long it keeps the inputs it receives, whether it uses them to train or improve its models, or the terms of a data processing agreement with it. Until we have confirmed these and stated them here, assume that TypeSafe may keep what it receives. This is one reason drafts are sent only after you approve them and consent, and questions containing direct identifiers are refused before they reach Jev.

**What Jev receives:**

- Your question, with the public employer names and sectors, documented events, group labels and questionnaire topics it may choose from.
- Your question and up to 12 published accounts, to rank them by relevance.
- Your approved draft, after you consent, to check seven policy conditions: identifying a private person, identifying the author from context, threats, exposing private contact or location details, personal attacks, promotion, and coordinated manipulation. It is also asked the one optional question described under [Support resources](#support-resources).
- Published accounts, for structured readings and comparisons.
- The name and domain of each employer someone adds, to ask whether the name is an organization’s, whether the name or the domain is abusive and, when the name matches one of our listings that has no domain or the domain does not carry the name, whether the domain is that employer’s corporate email domain.
- The reason given in a challenge, after the identifier checks and with any other detected identifying details masked, with the public text of the rule it cites, to check whether the reason fits the rule.
- The published text of a challenged account, to re-check it under the current policy, unless our local identifier check has already found a direct identifier in it.

**What Jev never receives:** your email address, verification data, credentials, juror tokens or votes, withdrawal capability, IP address, or any draft you have not approved.

**Automated screening.** Our published, versioned [moderation policy](https://shouldiworkthere.com/moderation/current.json) turns Jev’s probabilities into one of three outcomes: clear, which makes a contribution eligible for release; repair, which asks you to change the words and stores nothing; or jury, which holds the case privately. Under the current policy, possible identification of a person, threats and exposed private contact or location details ask you to repair; a clear personal attack is returned to you for repair, and anything less clear is published as criticism of conduct; and possible promotion and possible coordinated manipulation go to an anonymous jury. If screening is unavailable, the outcome is repair and nothing is stored. When a batch is published, our local identifier check runs again on each contribution and can hold one privately for repair; it is then treated like any other held case. When a challenge’s reason fits the rule it cites, the published account is checked again, by the local identifier check and then by Jev under the current policy; if it contains a direct identifier or meets a repair threshold, it is withheld from publication and held privately for its author to repair. If it falls in the cited rule’s jury range, a jury decides where one can be formed, and the account stays published meanwhile. Criticism and negative opinions are not violations. Each decision records the policy version and digest, the rules that applied and the model used.

**Human review.** A case held for a jury is decided by 7 randomly selected anonymous jurors, each answering one question about one rule, if you allowed anonymous jurors to read your words when you submitted or revised them and enough jurors of other employers can serve on that case; otherwise it stays held privately and is erased about 30 days after it was held unless you repair or withdraw it. You can appeal a decision against you once, when enough jurors of other employers can serve on an appeal, and a new jury of 9 decides without seeing the first result; the appeal is final for those words. The [status page](https://shouldiworkthere.com/status) says whether an appeal is available. You can also repair or withdraw the case at any time. Anyone who controls a domain can add it to the directory and obtain juror tokens for it, so the juror tokens of employers added by the community, including tokens for a domain someone added to one of our listings, count as one group whichever listing they name: together they fill at most one seat on a case, and those employers never count toward whether a jury can form. By design, no one at the operator can approve, edit or release an individual contribution through the application.

**Your rights about automated decisions.** Where the GDPR applies, Article 22 gives you rights about decisions based solely on automated processing that have legal or similarly significant effects on you. Our screening decides only whether a text is published in its current wording; it decides nothing about you as a person, and we do not know who you are. You can always change the words or withdraw. If you think a rule was applied wrongly, write to [privacy@shouldiworkthere.com](mailto:privacy@shouldiworkthere.com) with the rule and the wording, but not your capability. We will check whether the published rule was applied as written. If our code or policy is wrong, we will fix it for everyone, publish the change and tell you. We cannot approve or release an individual case.

## Support resources

Workplace accounts sometimes describe crisis. These checks only offer help to the person writing: they never block, edit, report or score the text, and they are not moderation signals.

- **On your device.** The search box and the contribution editor run a fixed list of crisis phrases as you type. If what you type suggests that you or someone else may be at risk of harm, a card offers crisis lines (988 in the United States, findahelpline.com elsewhere) and emergency numbers. Nothing about it is stored, sent or reported.
- **On our server.** When you send a search, a draft for screening, a contribution or a revision, the publisher runs the same phrase list on that text in memory. If it matches, the reply to you includes the same resources. Nothing about the match is stored, logged or forwarded, and it does not affect screening, publication or search results.
- **During screening.** When you screen a draft, Jev is asked one more question: whether you describe your own thoughts of suicide or of harming yourself. If Jev answers yes, the reply to you includes the same resources. The answer is never stored, logged or used for moderation, and it never changes the outcome; if Jev gives no answer, screening continues as usual.

For what this means under the GDPR and UK GDPR, see “Sensitive information” under [If you are in the EU, EEA or UK](#eu-uk).

## Service providers

These providers process personal data for us:

*Service providers*

| Provider | What they do for us | Data they process |
| --- | --- | --- |
| Cloudflare, Inc. (United States) | Hosting and network delivery (Workers), databases (D1), archive storage (R2), background queues (Queues), rate limiting, verification email delivery (Email Sending), forwarding of mail to our contact addresses (Email Routing), a public DNS resolver that looks up the mail records of domains added to the directory, and model routing (Workers AI and AI Gateway) | Everything described in this policy that passes through or is stored by our services, including IP addresses, request details and email delivery records |
| TypeSafe (legal entity and location not yet confirmed) | Runs the Jev model | Search text, approved drafts after consent, the reasons given in challenges, published accounts, and the names and domains of employers added to the directory |
| Google LLC (Google Workspace, United States) | Stores mail sent to our contact addresses | Your email address and what you write to us |
| Our telephone provider (not yet named) | Carries calls to +1 940-240-8554 and stores any voicemail | Your phone number, the time and length of the call, and any voicemail you leave |

We will name our telephone provider here once it is confirmed. We will update this list before a new provider receives personal data.

## What we do not do

- We do not sell personal data or share it for targeted advertising, and we do not sell aggregated review data.
- We use no advertising, analytics, tracking pixels, session replay or third-party scripts. Every script on the site is served from our own domain.
- We set no cookies. Cloudflare may set a strictly necessary security cookie if it needs to check suspicious traffic.
- We take no payments. There are no subscriptions or trials, and donations are not enabled.
- Employers get no access beyond the public record, and no one can pay to influence it.

**Global Privacy Control.** We do not sell or share personal data or use it for targeted advertising, so there is no sale or sharing for the signal to opt you out of. We still act on it: when your browser sends it, Live understanding starts off, so what you type is sent only when you submit a question (see “Search” above). If you switch Live understanding on or off yourself, that choice is remembered on your device and takes precedence. The page reads the signal only in your browser.

## Your choices and rights

Depending on where you live, you may have rights to access, correct, delete or export personal data, to object to or restrict its use, to withdraw consent, and to appeal if we refuse a request. Because we do not know who you are, the design limits what we can do, and some rights work through the product instead:

- **Withdraw.** Enter your withdrawal capability on the [status page](https://shouldiworkthere.com/status) at any time. This erases the private text, answers and signing key, removes the public text and the readings derived from it, and withdraws affected aggregate figures. No signature is needed, so keep the capability private. A minimal record that the contribution existed and was withdrawn stays. It holds no text or answers, but for about twelve months it records the employer and quarters and is linked to a hash of your capability; after that, only its status, contribution and verification type and revision count remain, and your capability no longer finds it. Anyone who obtains both your capability and our records within that time, for example through a court order, could use it to show that the capability was used for a contribution about that employer.
- **Check or correct.** With the capability, the [status page](https://shouldiworkthere.com/status) shows a contribution’s status and a receipt for each moderation decision about it. While it is held or waiting, you can replace the text with a revised version signed by the key from your browser; the new text is screened again. A published contribution cannot be edited: withdraw it and submit again.
- **Access and export.** We can find what we hold about a contribution only through its capability. We have no account, name or stored email address to search.
- **Verifier records.** The verifier holds only keyed hashes, until the quarter ends. To learn whether a credential was issued for a mailbox this quarter, request a code for it and use it on the contribution page: if one was, the verifier refuses to issue another and the page says so. If you ask us instead, we will answer only by email to that address, and only after you reply from it to a message we send there. We never tell anyone else. Deleting a record early would let the mailbox obtain another credential in the same quarter, so we keep it until the quarter ends unless the law requires otherwise.
- **Copies made by others.** Withdrawal cannot recall copies of published text that other people made.

To make a request, or to appeal our answer to one, email [privacy@shouldiworkthere.com](mailto:privacy@shouldiworkthere.com). Emailing a capability links your email address to that contribution in our mailbox, so use the site instead whenever you can. You may also complain to your data protection authority or, in the United States, to your state attorney general. If you are in the EU, the EEA or the UK, see also [If you are in the EU, EEA or UK](#eu-uk).

## If you are described in a contribution

Accounts describe workplaces, so they can mention managers, coworkers and other people who did not write them. Our content rules forbid identifying private individuals, directly or from context, exposing private contact or location details, and personal attacks. Automated screening checks every draft for these before it can be published, but it can miss things.

If you believe a published contribution identifies you or contains personal data about you, including sensitive information such as your health, email [privacy@shouldiworkthere.com](mailto:privacy@shouldiworkthere.com) with a link to the contribution, what in it concerns you, and the rule or right you rely on. Where the GDPR applies, you can object to the processing; we will weigh your interests against the author’s freedom of expression and the public interest. We cannot tell you who wrote a contribution, because we do not know.

**What a person decides.** We handle these reports as legal notices: a person reviews each one against the law, not against our content rules. Where the law requires removal, for example under a valid court order, or because the law obliges us to grant your objection or erasure request, we remove the contribution through direct administrative access, limited to that contribution, and record the removal in the [legal requests ledger](https://shouldiworkthere.com/legal-requests) when the law allows.

**What the rules decide.** No one at the operator removes a contribution because they judge that it breaks a content rule. A report that it breaks a rule in our moderation policy, such as the rule against identifying a private person, is decided by the published challenge process: it checks whether the reason fits the rule, re-checks the published words under the current policy and can withhold them for their author to repair. Every challenge produces a receipt, which the challenger sees when it is sent and the author sees on the status page. You can challenge the contribution yourself from the account or, if you prefer, ask us and we will file the challenge for you through the same public process, with no priority, and send you its receipt; see [Challenging a contribution](https://shouldiworkthere.com/terms#challenges).

## Legal requests and disclosure

Apart from the service providers above, we disclose personal data only when the law requires it, such as under a valid court order. We record requests in the public [legal requests ledger](https://shouldiworkthere.com/legal-requests) when the law allows. Consistent with our [constitution](https://shouldiworkthere.com/constitution), we protect anonymous speech to the maximum extent permitted by law.

We can disclose only what we hold, including, for up to 30 days after erasure, what remains in our databases’ recovery history, which a court order could require us to recover. We hold no names, accounts or stored email addresses, and no stored link between the verifier’s records and any contribution. Given a specific email address, the verifier’s records can show whether that mailbox obtained a credential for an employer in the current quarter, and for up to 30 days Cloudflare’s delivery records can show when codes were sent to it. None of these show whether that person wrote anything, or what. Given a withdrawal capability, our records can show the employer and quarters of the contribution it controlled, even after withdrawal or expiry, for about twelve months.

An employer does not need us to learn whether one of its mailboxes asked for verification. As described under “At the verifier”, anyone can request a code for a work address, and anyone who can read that mailbox can see the codes sent to it.

A two-of-three trustee process for valid legal orders and credible imminent-safety issues is planned but not active. Until it is, we act on valid legal orders through direct administrative access to our infrastructure, limit the action to what the order requires, and record it in the ledger when the law allows.

## Children

You must be 18 or older to use Should I Work There. It is not directed to children, and we do not knowingly collect personal data from anyone under 18. We cannot check contributors’ ages because we do not know who they are. If you believe someone under 18 has contributed, email [privacy@shouldiworkthere.com](mailto:privacy@shouldiworkthere.com) with a link to the published text. We will review it as a legal notice and remove the contribution where the law requires.

## Where data is processed

We are based in the United States. Cloudflare handles each request in a data center near you; our three databases are stored in its western North America region, and our archives in its storage. TypeSafe processes model inputs on its systems, in locations we have not yet confirmed. If you use Should I Work There from outside the United States, your data is processed in the United States and possibly other countries, whose data protection laws may differ from yours. The safeguards for data from the EU, the EEA and the UK are described in the next section.

## If you are in the EU, EEA or UK

Should I Work There is offered to people in the European Union, the European Economic Area and the United Kingdom. This section adds what the GDPR and the UK GDPR require us to tell you. The rest of this policy applies too.

### Who is responsible

The controller of your personal data is Robles Consulting LLC, a Texas limited liability company, 100 Plaza Pl, Ste 300, PMB 58, Northlake, TX 76226, USA. Contact us at [privacy@shouldiworkthere.com](mailto:privacy@shouldiworkthere.com) or call +1 940-240-8554.

- **Representative in the EU** (GDPR Article 27): pending. We have not appointed one yet. Until we name one here, contact us directly.
- **Representative in the UK** (UK GDPR Article 27): pending. We have not appointed one yet. Until we name one here, contact us directly.

### Legal bases

The table under [Why we use data](#purposes) gives the legal basis for each use. In GDPR terms, “your consent” is Article 6(1)(a); “taking the steps you ask for” and “your request” are Article 6(1)(b), because that is how we provide the service under our [terms](https://shouldiworkthere.com/terms); “legal obligation” is Article 6(1)(c); and “legitimate interest” is Article 6(1)(f). You can object to uses based on legitimate interests, as described below.

You do not have to give us any personal data. Without a work email address you cannot verify a work mailbox, and without your consent a draft is not screened or submitted.

### Sensitive information

Accounts of work can reveal special category data (GDPR Article 9), such as information about health or disability, trade union membership, religious or philosophical beliefs, political opinions, racial or ethnic origin, sex life or sexual orientation.

- **About other people.** Our [content rules](https://shouldiworkthere.com/terms#content-rules) ask you not to include this kind of information about anyone else. Our checks do not reliably catch it: the check on your device looks for identifying details such as names, contact details and exact dates, and automated screening checks whether a person could be identified, not whether a passage reveals sensitive information. We have not yet confirmed which condition in Article 9, or which national exemption for freedom of expression and information (GDPR Article 85; in the UK, the Data Protection Act 2018), covers such information about someone else if it is published despite our rules. If a published contribution reveals this kind of information about you, see [If you are described in a contribution](#described), which explains when the law requires us to remove it and how the published challenge process decides a breach of our moderation rules.
- **About yourself.** The contribution form has a separate statement, unchecked unless you check it, that your account may reveal sensitive information about you and that you choose to publish it. Checking it is your explicit consent (Article 9(2)(a)) to that information being screened, stored while it waits and published; we store only whether you checked it, as a yes or no on the private intake record, until the contribution is withdrawn or erased. You can withdraw that consent at any time by withdrawing the contribution. Once it is published, you have also made the information public yourself (Article 9(2)(e)). Leave it out if you do not want it published; it can also make you easier to identify.
- **Support-resources checks.** The publisher’s crisis phrase check and Jev’s optional self-harm question during screening handle text that may reveal information about your health, only to offer you support resources, and nothing about them is stored. We have not yet confirmed which condition in Article 9 covers this. We will state it here. See [Support resources](#support-resources).

### Your rights

You have the right to access your personal data, to have it corrected or erased, to restrict or object to its use, to receive it in a portable format, and to withdraw consent at any time without affecting what was done before. We do not know who you are, so GDPR Article 11 applies: we do not have to collect more information to identify you, and the rights of access, correction, erasure, restriction and portability work only when you give us something that lets us find your data. For a contribution, that is its withdrawal capability. For the verifier’s records, it is the mailbox address, as described under [Your choices and rights](#your-rights).

- **Withdraw consent or erase.** Enter your capability on the [status page](https://shouldiworkthere.com/status). Consent to screening is asked for each draft, and sharing a search topic is off unless you turn it on.
- **Access and portability.** The [status page](https://shouldiworkthere.com/status) shows a contribution’s status and receipts. For a copy of the text and answers we hold for it, in a machine-readable format, email [privacy@shouldiworkthere.com](mailto:privacy@shouldiworkthere.com) with the capability. Doing so links your email address to that contribution in our mailbox.
- **Correct.** While a contribution is held or waiting for a batch, you can replace its text with a revision signed by the key in your browser. A published contribution cannot be edited: withdraw it and submit again.
- **Restrict.** There is no way to pause a single contribution in the product. If you ask us to restrict the use of one, we will tell you what we can do.
- **Object.** You can object to uses based on legitimate interests, such as the structured readings of published text or the records kept after withdrawal. Withdrawing a contribution ends the readings of it. Otherwise, write to [privacy@shouldiworkthere.com](mailto:privacy@shouldiworkthere.com); we will stop unless we have compelling legitimate grounds that override your interests, or need the data for legal claims. If you are described in a contribution, see [If you are described in a contribution](#described).

We answer requests within one month. If a request is complex, we may take up to two more months, and we will tell you why within the first month.

### Automated decisions

These parts of moderation are automated:

- Screening of an approved draft, where our published policy code turns Jev’s probabilities into clear, repair or jury.
- The local identifier check that runs again when a batch is published, which can hold a contribution for repair.
- The check of whether a challenge’s reason fits the rule it cites, made by Jev or, when Jev is unavailable, by matching the rule’s published ground terms.
- The re-check of a challenged account under the current policy, which can withhold a published account: its words leave the public database, and its author can repair them.

[Jev and automated decisions](#jev) explains them. They decide whether a text is published as written, not anything about you, so we do not consider them decisions with legal or similarly significant effects on you under Article 22. You can still get a person involved:

- Change the words and screen them again, or withdraw the contribution.
- A case held for a jury is decided by 7 anonymous jurors when enough jurors of other employers can serve on it, and you can appeal once, with your capability, to a new jury of 9, when enough jurors of other employers can serve on the appeal.
- Write to [privacy@shouldiworkthere.com](mailto:privacy@shouldiworkthere.com) with the rule and the wording, not your capability. A person will check whether the published rule was applied as written and tell you the result. No one can approve or release an individual case through the application, but if our code or policy is wrong, we fix it for everyone.

### Transfers outside the EU, EEA and UK

We are based in the United States, and our providers process personal data there and possibly in other countries, where data protection law differs from yours. The safeguards are:

- **Cloudflare** states that when it transfers personal data from the EEA or the UK to the United States, it relies on its certification under the EU-U.S. Data Privacy Framework and the UK Extension to it, and on standard contractual clauses if that certification lapses. Cloudflare also states that its customer data processing addendum includes the EU standard contractual clauses and the UK Addendum.
- **Google LLC (Google Workspace, United States)**, which stores mail sent to our contact addresses: Google states that Google LLC is certified under the EU-U.S. Data Privacy Framework and the UK Extension to it, and that it uses standard contractual clauses where they are required, including in its contracts for Google Workspace.
- **Our telephone provider**, which carries calls to +1 940-240-8554: we have not yet named it or confirmed the safeguard. We will state both here.
- **TypeSafe**: confirmation is pending. We have not yet confirmed where TypeSafe processes data or which safeguard covers transfers to it. [Jev and automated decisions](#jev) explains what that means until we do.

For a copy of these safeguards, email [privacy@shouldiworkthere.com](mailto:privacy@shouldiworkthere.com).

### Complaints and assessments

You can complain to a data protection supervisory authority: in the EU or the EEA, the authority where you live, where you work or where you think the infringement happened ([list of authorities](https://www.edpb.europa.eu/about-edpb/about-edpb/members_en)); in the UK, the Information Commissioner’s Office ([make a complaint](https://ico.org.uk/make-a-complaint/)). You can also complain to us first at [privacy@shouldiworkthere.com](mailto:privacy@shouldiworkthere.com).

We are preparing a data protection impact assessment (GDPR Article 35) for the service. It is not complete yet, and we will say here when it is.

## Security

- Encrypted connections (HTTPS with HSTS) and a strict content security policy that allows scripts only from our own domain.
- Separate services and databases for verification, publication and inference, each holding only its own credentials.
- Credential signing keys encrypted at rest with AES-256-GCM in the verifier’s database; the operator also keeps an unencrypted copy of them in a file on the computer that creates them. Mailbox and code records hashed with a secret key.
- Application logging turned off; append-only decision, finance and legal ledgers; published source code.
- A signed release manifest and hash-chained transparency archives that anyone can check with our open verification tool; see the [transparency page](https://shouldiworkthere.com/transparency).

No system is perfectly secure, and these measures have not been independently audited.

## If something goes wrong

If we learn of a security incident that affects personal data, we will contain and investigate it and notify affected people and authorities as the law requires. Because we have no contact details for most people, we will also post a notice on this site and on the [transparency page](https://shouldiworkthere.com/transparency).

## Changes to this policy

Each version has a number and an effective date. We will post material changes on this page at least 30 days before they take effect, unless a change is required by law or urgently needed for security. A change that allows new uses of data we already hold will apply only to data collected after it takes effect.

*Version history*

| Version | Effective | What changed |
| --- | --- | --- |
| 1.2.0 | September 23, 2026 | Describes the service as it opens to the public. Accounts about real employers are published: written accounts in batches of at least five per employer after screening and a random delay, and questionnaire figures only for groups of at least 25. Accounts submitted before this version took effect keep the batch of at least 25 that version 1.1.0 promised. Anyone can add an employer with its work-email domain; listings show the domain, say they were added by the community, are not endorsed by us, and can be corrected on request, with each correction recorded in a public log (new section “Employers added by the community”). A proof-of-work step, computed in your browser, now comes before verification emails, juror tokens and new listings, and verification emails for employers added by the community have daily limits. The live site no longer has fictional sample employers, or the practice features built on them. Anonymous juries for real employers are switched on and form only when enough jurors can serve; juror tokens of employers added by the community share one seat per case and never make a jury formable. Updates the daily model-call limits. |
| 1.1.0 | September 22, 2026 | First published version of the privacy policy, terms of use and accessibility statement. It names the operator and how to contact us, explains how the system is divided, lists what we keep, for how long and which providers process it, sets Texas law and venue and the 18+ requirement, and includes sections for people in the EU, EEA and UK under the GDPR and UK GDPR, the Digital Services Act and the UK Online Safety Act. |

## Contact

Robles Consulting LLC, a Texas limited liability company.

- Privacy questions and requests: [privacy@shouldiworkthere.com](mailto:privacy@shouldiworkthere.com)
- Legal notices: [legal@shouldiworkthere.com](mailto:legal@shouldiworkthere.com)
- Copyright notices: [dmca@shouldiworkthere.com](mailto:dmca@shouldiworkthere.com)
- Postal mail: 100 Plaza Pl, Ste 300, PMB 58, Northlake, TX 76226, USA
- Telephone: +1 940-240-8554
