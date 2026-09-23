# Demo: two flows

Two short screen recordings for X, and the steps to reproduce them. Both use the fictional sample employers, which are
labeled "(fictional demonstration)" everywhere they appear; their numbers, accounts and events are seed data written to
exercise the interface, not facts about any company.

**Where to run it: locally only.** Since the public launch of September 23, 2026 the live site shows no fictional data
(`SAMPLE_EMPLOYERS` is `off` in production): `/c/northwind-labs` answers 404 there, and no sandbox proof or practice
jury exists. Record both flows on a local copy: `node tools/prepare-local.mjs` with `TYPESAFE_API_KEY` in `.env` (it sets
`SAMPLE_EMPLOYERS=on`), then `node tools/dev.mjs` and open http://localhost:8788. Say in the post that the recording is
of a local copy with fictional employers, and that the live site has none. On the live site, real employers show an
honest empty state until verified accounts are published. Jev's readings are model outputs, so wording, probabilities
and forks can differ from run to run; the numbers come from the database and do not.

## Flow 1: ask a question, get evidence instead of an essay

What it shows: Jev decides what view to build and with which filters; code and SQL fill in every number; uncertainty is
visible as chips and forks; every number opens to its evidence.

1. Open `/` and type **"How did trust in managers change after the restructuring at Northwind Labs?"**, then press
   Enter (or the "Read the evidence" button). Nothing is sent while you type unless Live understanding is on; employer
   names are recognized on the device as you type.
2. The canvas morphs into the **timeline** view for Northwind Labs. The chips show what Jev inferred: the employer, the
   topic (management), and the **2025 restructuring** event, applied because it is the only documented restructuring or
   layoff for that employer; a notice says so and the chip can be changed or removed.
3. The answer is a fixed sentence filled with released numbers. On the local seed (September 22, 2026) it read:
   *"Manager keeps commitments at Northwind Labs (fictional demonstration) fell from 66% agree (n=690, 2024) before the
   2025 restructuring to 47% agree (n=410, 2026) after it. The comparison window also contains the 2024 leadership
   change, so the change cannot be attributed to the 2025 restructuring alone."* No model wrote it, and the confounding
   event is named because the code found it inside the window.
4. Where Jev was unsure (here, whether the topic is management, culture or layoffs; in two runs on September 22 it
   split 73/18/9 and 67/22/11), a fork shows the alternatives with their model probabilities. Say out loud that these
   are probabilities about the wording of the question, not about the evidence.
5. Click a metric. The **Evidence Lens** opens with the question wording, group, n, period, verification method,
   exclusions, release id and the related accounts.
6. Optional, for the ambiguity point: ask **"How political is engineering at Northwind Labs?"** The reply applies the
   Engineering group and offers a fork between meanings (leadership and team culture, manager politics, promotion
   politics) with probabilities, instead of guessing silently. In two runs on September 22 Jev put 95% and 96% on
   culture, so the fork also shows how lopsided a reading can be. Do not present the headline as an answer about
   politics: it is the Engineering group's "Would work here again" figure (24% agree, n=120, 2026), because no released
   measure is about politics.
7. Optional, for honesty: open `/c/stripe`. Nothing is published about it, so the page says so and shows no numbers:
   written accounts appear in batches of at least 5 verified contributions after screening and a random delay, and
   survey figures need 25. The live site shows the same empty state.

Jev's choices can differ between runs and builds. Re-run each question before recording and describe the headline you
actually get.

What not to claim: Jev does not "answer" anything; it classifies the question. The fictional numbers are not findings.

## Flow 2: contribute without being identifiable

What it shows: drafts stay on the device; identifying details are caught before anything leaves it; the author approves
every change; the credential is blind-signed; the receipt explains exactly what happens next.

1. Open `/submit` and choose **Northwind Labs** (fictional). Pick an account type and a reporting quarter.
2. Paste an identifying draft, for example:

   > My manager Dana Lee told me on March 11 that the only staff engineer in the Austin office would be let go before
   > the review. Call me at 512-555-0142 if you need details.

   The on-device checks mark five details as you type: "My manager Dana Lee" (named individual), "on March 11" (exact
   date), "512-555-0142" (phone number), "the only staff engineer" (unique role) and "the Austin office" (narrow
   location). The meter counts only what they recognize and says it is not an anonymity guarantee. Show the browser's
   network panel: nothing has been sent.
3. Work through the **Make safer** panel under the draft; it is already open and shows one detail at a time. Each
   proposed generalization is shown before and after and needs its own approval ("Approve this edit", "Keep as written"
   where allowed, or "Write it my way"). Details marked "must change", such as the phone number, cannot be kept. On the
   September 22 build the panel proposed removing the phone number, "a staff engineer", "my manager", "around then" and
   "a field location". Approving all five gave:

   > my manager told me around then that a staff engineer in a field location would be let go before the review. Call
   > me at  if you need details.

   The panel changes only the marked words, so finish in the draft itself: capitalize "My" and delete the "Call me at"
   sentence. That leaves "My manager told me around then that a staff engineer in a field location would be let go
   before the review.", with no details left for the checks to mark. Showing that last edit is part of the point: the
   author owns the words. Re-run the draft before recording and describe what the panel actually proposes.
4. In "Contextual check by Jev", tick the consent box and press **Check the approved draft**. Only the approved text is
   sent. The result is clear, repair or held for a jury, with the rules and the policy version. On the local stack the
   final draft above came back "Clear for delayed publication" under policy 0.6.0, checked by jev-1.13.0 via the TypeSafe
   API (the local stack runs `JEV_PROVIDER=typesafe`; production uses Workers AI first).
5. In "Prove the relationship, not your identity", press **Create a sandbox proof**. For a fictional employer no email is
   needed; the browser prepares the credential, the verifier signs it blind, and the page shows the key fingerprint and
   that publisher and verifier published the same key. For a real employer this step first computes a short proof of
   work in the browser (about a second), then sends a code to a work mailbox, and the page says what the mailbox's
   readers can see. Sandbox proofs exist only on a local copy.
6. Tick the confirmations (18 or older and the terms; optionally juror review and the sensitive-information statement)
   and submit. The receipt shows the **withdrawal capability** once, the decision with its policy version and digest, and
   the release policy: a random 12 to 72 hour delay and a batch of at least 5 contributions for the same employer and
   verification type, so a single demo contribution will not appear on the page during the recording.
7. Open `/status`, paste the capability, and show the receipts; then **Withdraw this contribution** and show that it is
   erased.

What not to claim: a sandbox proof verifies nothing about employment; the labels say "Sandbox credential; employment not
verified". The detectors reduce risk and do not guarantee anonymity. On a local copy a practice jury for a fictional
employer can form wherever sandbox juror keys are published (the local stack publishes them), but one person can hold
several seats on a practice case, so it demonstrates the procedure and proves nothing about who voted. A jury-range draft
reaches jurors only if its author allowed juror review; otherwise it stays held. Do not show a sandbox proof as if it
were the live site.

## Optional flow 3: add an employer (local only)

What it shows: anyone can list an employer that is missing, and the listing says where it came from. Do it only on a
local copy: in production every listing is real data, and a test listing would have to be removed by hand.

1. Search for an employer that is not listed. The unlisted state offers to add it.
2. Enter a name and a work-email domain. The browser computes the proof of work, then the site checks the domain's mail
   records and that the domain carries the name, and asks Jev whether the name is an organization's and whether the
   name or the domain is abusive (and, if the domain does not carry the name, whether it is plausibly the
   organization's). The new listing shows the domain beside the name and
   says it was added by the community.
3. What not to claim: a listing proves nothing about the organization or the domain; it only lets people who control
   mailboxes at that domain verify. Listing and contributing are separate, so adding an employer reveals nothing about
   anyone who later writes about it.

## Suggested post text

Post it only once the launch release is live and `verify-deployment` passes, and only after its legal gate is closed
([operations.md](operations.md), "Deploy order for this release", step 0): `LEGAL_REVIEWED_VERSION` is `'1.2.0'` on
the owner's statement that counsel approved the terms, so the live pages carry no draft notice; if that approval does
not cover the text now in `docs/legal`, set it back to `null` first. Before the release is live, the text below
describes a release that is not deployed. Someone must also be reading legal@ from the moment it is posted: listing
corrections happen only when a person applies them ([operations.md](operations.md), "Staffing legal@ during the
launch").

> Most review sites ask you to trust them with who you are. Should I Work There splits the job: a verifier checks that
> you can read a work mailbox and blind-signs a credential; a separate service stores what you wrote and never sees the
> mailbox.
>
> Jev never writes the answer. It decides which view the evidence should take, and the database fills in every number,
> each one opening to its question, sample size and period.
>
> Preview, now open to the public. Accounts about real employers are published in batches of at least 5 after a random
> delay; survey figures need 25. Anyone can add a missing employer by name and work-email domain, shown beside the
> name. The employers in these clips are fictional, on a local copy; the live site has none. The three services still
> run in one cloud account. Details: /transparency.
