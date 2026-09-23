#!/usr/bin/env node
/**
 * Waterfall ticket tracker.
 *
 * Usage:
 *   node tools/ticket.mjs list                          one line per ticket; inconsistent tickets are flagged
 *   node tools/ticket.mjs check                         print every inconsistency and exit 1 if there is one (CI)
 *   node tools/ticket.mjs init                          create missing ticket files, then sync
 *   node tools/ticket.mjs sync                          re-render every ticket file and INDEX.md from the manifest and the logs
 *   node tools/ticket.mjs settle                        after a manifest change, apply the dependency rules below to every ticket
 *   node tools/ticket.mjs start  W-004 ["note"]
 *   node tools/ticket.mjs done   W-004 "verification note citing tests/... or the command that was run"
 *   node tools/ticket.mjs block  W-004 "the external prerequisite" [--cascade]
 *   node tools/ticket.mjs reopen W-004 "why" [--start] [--cascade]
 *   node tools/ticket.mjs note   W-004 "additional context"
 *   node tools/ticket.mjs status W-004
 * Only --cascade and --start are flags; any other word, including one starting with "--", is part of the note.
 *
 * Status rules (enforced by `done`, `start`, `block`, `reopen` and `check`):
 *   DONE         every dependency is DONE, and since the ticket last closed its log has a note citing a test file
 *                that exists, or a verification command (npx tsc, npx playwright, node --test, or
 *                node tools/verify-deployment.mjs, eval-intents.mjs or transparency.mjs). A cited test file that does
 *                not exist is itself a problem.
 *   IN PROGRESS  every dependency is DONE or IN PROGRESS.
 *   PENDING      no dependency is BLOCKED.
 *   BLOCKED      the log's latest status entry is "BLOCKED: <prerequisite>". A ticket that is BLOCKED because a
 *                dependency is records "waits on <id> (blocked: <that dependency's reason>)", and the reason must be
 *                current: when the dependency's reason changes the dependent's entry is refreshed, and when the
 *                dependency is no longer BLOCKED the dependent is released to PENDING ("UNBLOCKED: ...").
 * `reopen` and `block` refuse when they would lower a dependent's status, unless --cascade is given; the cascade
 * reopens (or blocks) each such dependent and logs why. Refreshing a waiting dependent's reason and releasing it are
 * applied by every command without --cascade, because they only keep the record true.
 *
 * Source of truth: tools/tickets.manifest.json (definitions)
 *                  tickets/<id>-<slug>.md      (status and log; only the "## Log" section is read back)
 *                  tickets/INDEX.md            (generated table)
 * `check` also reports a ticket file or INDEX.md that differs from what the manifest and logs render, and a ticket file
 * that matches no ticket (a title change renames the file: move the old file, and so its log, to the new name).
 * Cited documents (docs/**.md, README.md): when a command's text cites one, the tracker appends
 * "[read <path> sha256:<first 12 hex>]" (or "absent"), the content the note was written against. `check` reports a
 * ticket whose latest entry citing a document no longer matches it: the recorded digest differs from the document now,
 * or, for an entry without a digest (written by hand or before digests were recorded), the document was modified after
 * the minute the entry was written. The remedy is to re-read the document and add a note, a correction when what the
 * earlier entry says no longer holds; the old entry stays as written. "waits on" entries copy another ticket's reason
 * and are judged on that ticket.
 * Plain notes may not start with REOPENED:, BLOCKED: or UNBLOCKED:, which record status changes.
 * TICKETS_ROOT overrides the project root (used by tests/tickets.test.ts).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export const STATUSES = ["PENDING", "IN PROGRESS", "BLOCKED", "DONE"];
const STATUS_MARK = { PENDING: " ", "IN PROGRESS": "~", BLOCKED: "!", DONE: "x" };
const DEFAULT_ROOT = process.env.TICKETS_ROOT ? resolve(process.env.TICKETS_ROOT) : join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = /^- \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC)\] (.*)$/;
/** Hand-written checklist lines found inside a Log section (W-023 has some). Kept verbatim, never duplicated. */
const LEGACY = /^- \[([ xX])\] (.*)$/;
/** Verification commands a completion note may cite instead of a test file. This tracker's own commands are not verification. */
const VERIFY_COMMAND = /\bnpx (?:tsc|playwright)\b|\bnode --test\b|\bnode tools\/(?:verify-deployment|eval-intents|transparency)\.mjs\b/;
/** A completion note must cite what verified it: a test file, or the verification command that was run. */
export const EVIDENCE = new RegExp(`\\btests\\/[\\w.-]+|${VERIFY_COMMAND.source}`);
/** Project-relative test paths a note cites ("tests/jev.test.ts"), without trailing sentence punctuation. */
export const citedTests = (text) => [...text.matchAll(/\btests\/[\w.-]+/g)].map((m) => m[0].replace(/\.+$/, ""));
/** Test paths a note cites that do not exist under `root` (none when the root is not known). */
export const missingTests = (text, root = null) => (root ? [...new Set(citedTests(text))].filter((p) => !existsSync(join(root, p))) : []);
/** Whether a note cites its verification: a verification command, or a test file (one that exists, when `root` is known). */
export function hasEvidence(text, root = null) {
  if (VERIFY_COMMAND.test(text)) return true;
  const cited = citedTests(text);
  return root ? cited.some((p) => existsSync(join(root, p))) : cited.length > 0;
}
/** Log entries that record a status change. Plain notes may not start with these prefixes. */
const STATUS_ENTRY = /^(REOPENED|BLOCKED|UNBLOCKED):/;

/** Project documents whose statements a note can rely on. Code and tests are not documents (tests are checked above). */
const DOC = /\b(?:docs\/[\w./-]*[\w-]\.md|README\.md)\b/g;
/** What the tracker records for each cited document: its content digest when the entry was written, or "absent". */
const STAMP = /\[read (\S+) (sha256:[0-9a-f]{12}|absent)\]/g;
/** Documents a text cites, in order of first mention, without duplicates; a path that climbs out of docs/ is not one. */
export const citedDocs = (text) => [...new Set([...text.matchAll(DOC)].map((m) => m[0]))].filter((p) => !p.split("/").includes(".."));
/** The digest each document had when the entry was written, as the entry records it. */
export const recordedReads = (text) => new Map([...text.matchAll(STAMP)].map((m) => [m[1], m[2]]));
/** A document's current content digest under `root`, in the recorded form. */
export function docDigest(root, path) {
  const p = join(root, path);
  return existsSync(p) ? `sha256:${createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12)}` : "absent";
}
/** The text with a read record appended for each cited document it does not already record (unchanged without `root`). */
export function recordReads(text, root = null) {
  if (!root) return text;
  const known = recordedReads(text);
  const add = citedDocs(text).filter((d) => !known.has(d));
  return add.length ? `${text} ${add.map((d) => `[read ${d} ${docDigest(root, d)}]`).join(" ")}` : text;
}
/** End of the minute an entry was written (entries have minute resolution), or null for an undated legacy line. */
const entryEnd = (ts) => {
  const t = Date.parse(`${ts.replace(" UTC", "").replace(" ", "T")}:00Z`);
  return Number.isNaN(t) ? null : t + 60_000;
};
const minute = (ms) => nowIso(new Date(ms));
/**
 * Documents a ticket's log relies on that changed after the entry that last cited them. For each cited document only
 * the latest entry citing it counts, so a later note that re-read the document settles an earlier one.
 */
export function staleCitations(t, state, root) {
  const latest = new Map();
  for (const e of state.log) {
    if (/^BLOCKED: waits on /.test(e.text)) continue;
    for (const d of citedDocs(e.text)) latest.set(d, e);
  }
  const out = [];
  for (const [doc, e] of latest) {
    const then = recordedReads(e.text).get(doc), now = docDigest(root, doc);
    if (then) {
      if (then !== now)
        out.push(`${t.id}: its ${e.ts} entry cites ${doc}, which has changed since that entry read it (${then} then, ${now} now); re-read it and add a note, a correction if the entry no longer holds`);
    } else if (now === "absent") out.push(`${t.id}: its ${e.ts} entry cites ${doc}, which does not exist`);
    else {
      const end = entryEnd(e.ts), changed = statSync(join(root, doc)).mtimeMs;
      if (end !== null && changed >= end)
        out.push(`${t.id}: its ${e.ts} entry cites ${doc}, which was modified at ${minute(changed)}, after that entry; re-read it and add a note, a correction if the entry no longer holds`);
    }
  }
  return out;
}

export function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function nowIso(date = new Date()) {
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export const ticketFile = (t) => `${t.id}-${slugify(t.title)}.md`;
const ticketsDir = (root) => join(root, "tickets");

export function loadManifest(root = DEFAULT_ROOT) {
  return JSON.parse(readFileSync(join(root, "tools", "tickets.manifest.json"), "utf8"));
}

/** Frontmatter plus the Log section. Nothing above "## Log" (scope, acceptance checklist, verification) is read back. */
export function parseTicket(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const meta = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  const body = m ? m[2] : raw;
  const log = [];
  const at = body.search(/^## Log[ \t]*$/m);
  if (at >= 0) {
    for (const line of body.slice(at).split("\n").slice(1)) {
      if (/^## /.test(line)) break;
      const entry = line.match(ENTRY);
      const legacy = entry ? null : line.match(LEGACY);
      if (entry) log.push({ ts: entry[1], text: entry[2] });
      else if (legacy) log.push({ ts: legacy[1] === " " ? " " : "x", text: legacy[2] });
      // An indented line continues the entry above; a blank line inside a note is rendered as the indent alone.
      else if (line.startsWith("  ") && log.length) log[log.length - 1].text += "\n" + line.slice(2);
    }
  }
  return { meta, log };
}

const renderEntry = (e) => `- [${e.ts}] ${e.text.split("\n").join("\n  ")}`;

export function renderTicket(t, state) {
  const deps = t.depends_on.length ? t.depends_on.join(", ") : "none";
  const lines = ["---", `id: ${t.id}`, `title: ${t.title}`];
  if (t.ref) lines.push(`ref: ${t.ref}`);
  lines.push(`phase: ${t.phase}`, `status: ${state.status}`, `depends_on: ${deps}`);
  if (state.completed) lines.push(`completed: ${state.completed}`);
  lines.push("---", "", `# ${t.id} - ${t.title}`, "", `**Phase:** ${t.phase}  `);
  if (t.ref) lines.push(`**Brief ref:** ${t.ref}  `);
  lines.push(`**Depends on:** ${deps}  `, `**Status:** ${state.status}`, "", "## Scope", "", t.scope, "", "## Acceptance criteria", "");
  const mark = state.status === "DONE" ? "x" : " ";
  if (Array.isArray(t.acceptance)) for (const item of t.acceptance) lines.push(`- [${mark}] ${item}`);
  else lines.push(t.acceptance);
  if (t.files?.length) {
    lines.push("", "## Implementation paths", "");
    for (const file of t.files) lines.push(`- \`${file}\``);
  }
  if (t.tests?.length) {
    lines.push("", "## Required verification", "");
    for (const scenario of t.tests) lines.push(`- ${scenario}`);
  }
  lines.push("", "## Log", "");
  for (const entry of state.log) lines.push(renderEntry(entry));
  lines.push("");
  return lines.join("\n");
}

export function readState(t, root = DEFAULT_ROOT, now = nowIso()) {
  const p = join(ticketsDir(root), ticketFile(t));
  if (!existsSync(p)) return { status: "PENDING", completed: null, log: [{ ts: now, text: "Ticket created." }], missing: true };
  const { meta, log } = parseTicket(readFileSync(p, "utf8"));
  return {
    status: meta.status ?? "PENDING",
    completed: meta.completed ?? null,
    log: log.length ? log : [{ ts: now, text: "Ticket created." }],
    missing: false,
  };
}

export function loadStates(manifest, root = DEFAULT_ROOT, now = nowIso()) {
  return new Map(manifest.waterfall.map((t) => [t.id, readState(t, root, now)]));
}

const sorted = (manifest) => [...manifest.waterfall].sort((a, b) => a.id.localeCompare(b.id));

export function renderIndex(manifest, states) {
  const all = sorted(manifest);
  const count = (s) => all.filter((t) => states.get(t.id).status === s).length;
  const rows = [
    `# ${manifest.project} - Waterfall Tickets`,
    "",
    `> ${manifest.north_star}`,
    "",
    `Progress: **${count("DONE")} / ${all.length}** tickets done. In progress: ${count("IN PROGRESS")}. Blocked: ${count("BLOCKED")}. Pending: ${count("PENDING")}.`,
    "",
    "| Ticket | Ref | Phase | Title | Status | Completed |",
    "|---|---|---|---|---|---|",
  ];
  for (const t of all) {
    const state = states.get(t.id);
    rows.push(`| \`${t.id}\` | ${t.ref ?? "-"} | ${t.phase} | [${t.title}](${ticketFile(t)}) | [${STATUS_MARK[state.status] ?? "?"}] ${state.status} | ${state.completed ?? "-"} |`);
  }
  rows.push(
    "",
    "Status legend: `[ ]` pending, `[~]` in progress, `[!]` blocked, `[x]` done. Ref is the product-brief item a ticket implements (G backend, U interface, L legal, H hardening).",
    "",
    "Status rules, enforced by `node tools/ticket.mjs check`: a ticket is DONE only when every ticket it depends on is DONE and its log, since it last closed, cites test files that exist or the verification command that was run; it is IN PROGRESS only while every dependency is DONE or IN PROGRESS; a ticket with a BLOCKED dependency is itself BLOCKED, never DONE, IN PROGRESS or PENDING. A BLOCKED ticket's log names its external prerequisite, or the dependency it waits on with that dependency's current reason; a ticket that only waits is released to PENDING when nothing it depends on is blocked any more, while a ticket blocked on its own prerequisite stays blocked until someone reopens or starts it. Reopening or blocking a ticket lowers its dependents' statuses only with `--cascade`. After a change to the manifest, `node tools/ticket.mjs settle` applies these rules. Scope changes are recorded as a log entry on the ticket that discovers them. An entry that cites a document (docs/..., README.md) records a digest of the version it read (`[read <path> sha256:...]`); `check` reports a ticket whose latest entry citing a document no longer matches that document, until a new entry re-reads it (earlier entries are never rewritten).",
    "",
  );
  return rows.join("\n");
}

/** Topological order (dependencies first); throws on an unknown dependency or a cycle. */
export function topo(manifest) {
  const byId = new Map(manifest.waterfall.map((t) => [t.id, t]));
  const out = [], mark = new Map();
  const visit = (t, path) => {
    if (mark.get(t.id) === 2) return;
    if (mark.get(t.id) === 1) throw new Error(`dependency cycle: ${[...path, t.id].join(" -> ")}`);
    mark.set(t.id, 1);
    for (const d of t.depends_on) {
      const dep = byId.get(d);
      if (!dep) throw new Error(`${t.id} depends on unknown ticket ${d}`);
      visit(dep, [...path, t.id]);
    }
    mark.set(t.id, 2);
    out.push(t);
  };
  for (const t of sorted(manifest)) visit(t, []);
  return out;
}

const lastStatusIndex = (log) => {
  for (let i = log.length - 1; i >= 0; i--) if (STATUS_ENTRY.test(log[i].text)) return i;
  return -1;
};
const blockReason = (state) => {
  const i = lastStatusIndex(state.log);
  return i >= 0 && state.log[i].text.startsWith("BLOCKED:") ? state.log[i].text.slice(8).trim() : null;
};
const WAITS = /^waits on (\S+) \(blocked: ([\s\S]*)\)$/;
/** The external prerequisite behind a (possibly cascaded) block, without the "waits on ..." wrapping. */
const rootReason = (reason) => reason?.match(WAITS)?.[2] ?? reason ?? "no reason recorded";
/** For a ticket BLOCKED only because a dependency is: that dependency and the reason recorded for it. */
const waitsOn = (state) => {
  const m = state.status === "BLOCKED" ? blockReason(state)?.match(WAITS) : null;
  return m ? { id: m[1], reason: m[2] } : null;
};

/** Every way the manifest, the files and the statuses disagree with the rules. */
export function problems(manifest, states, { root = null } = {}) {
  const out = [];
  const ids = manifest.waterfall.map((t) => t.id);
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) out.push(`duplicate ticket id ${id}`);
  try { topo(manifest); } catch (error) { out.push(error.message); return out; }
  for (const t of manifest.waterfall) {
    const s = states.get(t.id);
    if (s.missing) out.push(`${t.id}: no ticket file (run init)`);
    if (!STATUSES.includes(s.status)) { out.push(`${t.id}: unknown status '${s.status}'`); continue; }
    const deps = t.depends_on.map((d) => ({ id: d, status: states.get(d).status }));
    if (s.status === "DONE") {
      for (const d of deps.filter((d) => d.status !== "DONE")) out.push(`${t.id} is DONE but depends on ${d.id} (${d.status})`);
      if (!s.completed) out.push(`${t.id} is DONE without a completed timestamp`);
      const since = s.log.slice(lastStatusIndex(s.log) + 1);
      if (!since.some((e) => hasEvidence(e.text, root)))
        out.push(`${t.id} is DONE but no log entry since it last closed cites a test file or a verification command`);
      for (const p of new Set(since.flatMap((e) => missingTests(e.text, root)))) out.push(`${t.id} is DONE but cites ${p}, which does not exist`);
    }
    if (s.status === "IN PROGRESS")
      for (const d of deps.filter((d) => d.status === "PENDING" || d.status === "BLOCKED")) out.push(`${t.id} is IN PROGRESS but depends on ${d.id} (${d.status})`);
    if (s.status === "PENDING")
      for (const d of deps.filter((d) => d.status === "BLOCKED")) out.push(`${t.id} is PENDING but depends on ${d.id} (BLOCKED), so it is blocked too (run settle)`);
    if (s.status === "BLOCKED") {
      const w = waitsOn(s);
      if (!blockReason(s)) out.push(`${t.id} is BLOCKED but its latest status entry does not name the prerequisite`);
      else if (w && !t.depends_on.includes(w.id)) out.push(`${t.id} is BLOCKED waiting on ${w.id}, which it does not depend on`);
      else if (w && states.get(w.id).status !== "BLOCKED") out.push(`${t.id} is BLOCKED waiting on ${w.id}, which is ${states.get(w.id).status} (run settle)`);
      else if (w && rootReason(blockReason(states.get(w.id))) !== w.reason) out.push(`${t.id} is BLOCKED waiting on ${w.id}, but the reason it records is out of date (run settle)`);
    }
    if (s.status !== "DONE" && s.completed) out.push(`${t.id} is ${s.status} but still has a completed timestamp`);
  }
  if (root) {
    for (const t of manifest.waterfall) {
      const p = join(ticketsDir(root), ticketFile(t)), s = states.get(t.id);
      if (!s.missing && readFileSync(p, "utf8") !== renderTicket(t, s)) out.push(`${t.id}: ${ticketFile(t)} is not in sync with the manifest (run sync)`);
      out.push(...staleCitations(t, s, root));
    }
    const index = join(ticketsDir(root), "INDEX.md");
    if (!existsSync(index) || readFileSync(index, "utf8") !== renderIndex(manifest, states)) out.push("INDEX.md is not in sync (run sync)");
    // A changed title renames the file; the old file (and its log) must not be left behind.
    const expected = new Set(manifest.waterfall.map(ticketFile));
    for (const f of existsSync(ticketsDir(root)) ? readdirSync(ticketsDir(root)) : [])
      if (f.endsWith(".md") && f !== "INDEX.md" && !expected.has(f)) out.push(`tickets/${f} matches no ticket in the manifest (after a title change, move its log to the new file name)`);
  }
  return out;
}

/** Every ticket that depends on `id`, directly or through other tickets. */
export function dependents(manifest, id) {
  const out = new Set();
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of manifest.waterfall)
      if (!out.has(t.id) && t.depends_on.some((d) => d === id || out.has(d))) { out.add(t.id); grew = true; }
  }
  return out;
}

/**
 * Bring tickets (within `scope`, when given) in line with their dependencies, dependencies first, until nothing
 * changes; each change is logged on the ticket.
 *  - Lowered ("demoted"): a DONE, IN PROGRESS or PENDING ticket with a BLOCKED dependency becomes BLOCKED ("waits on");
 *    a DONE or IN PROGRESS ticket with a PENDING dependency becomes PENDING; a DONE ticket with any other unfinished
 *    dependency becomes IN PROGRESS.
 *  - Kept true: a ticket BLOCKED because it waits on a dependency records that dependency's current reason, and is
 *    released to PENDING when nothing it depends on is BLOCKED any more.
 * With `origin` (the ticket a command changed), only dependencies that moved during the command count, so an older,
 * unrelated inconsistency is left for `check`. Returns {changed, demoted}.
 */
export function settle(manifest, states, now = nowIso(), scope = null, origin = null) {
  const changed = [], demoted = [];
  // The prerequisites that moved: the command's ticket and every knock-on so far.
  const moved = new Set(origin ? [origin] : []);
  const order = topo(manifest).filter((t) => !scope || scope.has(t.id));
  const waits = (d) => `BLOCKED: waits on ${d.id} (blocked: ${rootReason(blockReason(d.state))})`;
  const record = (t, s, status, text, lowered) => {
    s.status = status;
    s.completed = null;
    s.log.push({ ts: now, text });
    if (!changed.includes(t.id)) changed.push(t.id);
    if (lowered && !demoted.includes(t.id)) demoted.push(t.id);
    moved.add(t.id);
  };
  for (let again = true; again; ) {
    again = false;
    for (const t of order) {
      const s = states.get(t.id);
      const all = t.depends_on.map((d) => ({ id: d, state: states.get(d) }));
      const deps = origin ? all.filter((d) => moved.has(d.id)) : all;
      if (s.status === "BLOCKED") {
        const w = waitsOn(s);
        if (!w || (origin && !moved.has(w.id))) continue;
        // Undefined when the manifest no longer lists the ticket it waits on as a dependency.
        const d = all.find((x) => x.id === w.id);
        if (d?.state.status === "BLOCKED") {
          if (rootReason(blockReason(d.state)) === w.reason) continue;
          record(t, s, "BLOCKED", waits(d), false);
        } else {
          const other = all.find((x) => x.state.status === "BLOCKED");
          if (other) record(t, s, "BLOCKED", waits(other), false);
          else if (d) record(t, s, "PENDING", `UNBLOCKED: ${d.id} is no longer blocked (it is ${d.state.status}); this ticket can start again.`, false);
          else record(t, s, "PENDING", `UNBLOCKED: this ticket no longer depends on ${w.id}; it can start again.`, false);
        }
        again = true;
        continue;
      }
      if (!STATUSES.includes(s.status)) continue;
      const blocked = deps.find((d) => d.state.status === "BLOCKED");
      const pending = deps.find((d) => d.state.status === "PENDING");
      const open = deps.find((d) => d.state.status !== "DONE");
      let next = null, text = null;
      if (blocked) [next, text] = ["BLOCKED", waits(blocked)];
      else if (s.status === "PENDING") continue;
      else if (pending) [next, text] = ["PENDING", `REOPENED: prerequisite ${pending.id} is PENDING; this ticket resumes when ${pending.id} is in progress.`];
      else if (s.status === "DONE" && open)
        [next, text] = ["IN PROGRESS", `REOPENED: prerequisite ${open.id} ${origin ? "was reopened" : `is ${open.state.status}`}; this ticket closes again after it does.`];
      if (!next) continue;
      record(t, s, next, text, true);
      again = true;
    }
  }
  return { changed, demoted };
}

const clone = (states) => new Map([...states].map(([id, s]) => [id, { ...s, log: [...s.log] }]));

/**
 * Apply one command to the in-memory states. Returns {changed:[ids]}; throws Error with a readable message when the
 * rules refuse it. With `root` (the command line passes it), a note's cited test files must exist.
 */
export function transition(manifest, states, cmd, id, note, { cascade = false, start = false, now = nowIso(), root = null } = {}) {
  const t = manifest.waterfall.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown ticket: ${id}`);
  if (!["note", "start", "done", "block", "reopen"].includes(cmd)) throw new Error(`Unknown command: ${cmd}`);
  // With the root known, each cited document's current digest is recorded with the note (see staleCitations).
  note = recordReads((note ?? "").replace(/\r\n?/g, "\n"), root);
  const s = states.get(id);
  const deps = t.depends_on.map((d) => ({ id: d, status: states.get(d).status }));
  const notDone = deps.filter((d) => d.status !== "DONE");
  const unstarted = deps.filter((d) => d.status === "PENDING" || d.status === "BLOCKED");
  const fmt = (list) => list.map((d) => `${d.id} (${d.status})`).join(", ");
  const prefix = note.match(STATUS_ENTRY)?.[1];
  if (prefix && ["note", "start", "done"].includes(cmd))
    throw new Error(`A ${cmd} text cannot start with "${prefix}:", which records a status change; use block or reopen, or reword it.`);
  if (cmd === "note") {
    if (!note.trim()) throw new Error("A note needs text.");
    s.log.push({ ts: now, text: note });
    return { changed: [id] };
  }
  let next, text;
  if (cmd === "start") {
    if (s.status === "DONE") throw new Error(`${id} is DONE; use reopen (with the reason) to work on it again.`);
    if (unstarted.length) throw new Error(`Dependencies not DONE or IN PROGRESS: ${fmt(unstarted)}`);
    [next, text] = ["IN PROGRESS", note.trim() ? note : "Started."];
  } else if (cmd === "done") {
    if (!note.trim()) throw new Error("Completion requires a verification note.");
    const missing = missingTests(note, root);
    if (missing.length) throw new Error(`The verification note cites ${missing.join(", ")}, which does not exist.`);
    if (!hasEvidence(note, root))
      throw new Error("The verification note must cite a test file (tests/...) or the verification command that was run (npx tsc, npx playwright, node --test, node tools/verify-deployment.mjs, eval-intents.mjs or transparency.mjs).");
    if (notDone.length) throw new Error(`Dependencies not DONE: ${fmt(notDone)}`);
    [next, text] = ["DONE", note];
  } else {
    if (!note.trim()) throw new Error(cmd === "block" ? "Blocking requires the prerequisite that blocks it." : "Reopening requires the reason.");
    if (cmd === "reopen" && start && unstarted.length) throw new Error(`Cannot reopen as IN PROGRESS; dependencies not DONE or IN PROGRESS: ${fmt(unstarted)}`);
    [next, text] = [cmd === "block" ? "BLOCKED" : start ? "IN PROGRESS" : "PENDING", `${cmd === "block" ? "BLOCKED" : "REOPENED"}: ${note}`];
  }
  const trial = clone(states), ts = trial.get(id);
  ts.status = next;
  ts.completed = next === "DONE" ? now : null;
  ts.log.push({ ts: now, text });
  // Only this ticket's dependents are touched; inconsistencies elsewhere are for `check` to report.
  const { changed, demoted } = settle(manifest, trial, now, dependents(manifest, id), id);
  if (demoted.length && !cascade)
    throw new Error(`${id} -> ${next} would leave dependents inconsistent: ${demoted.join(", ")}. Re-run with --cascade to ${cmd === "block" ? "block" : "reopen"} them too.`);
  for (const [k, v] of trial) states.set(k, v);
  return { changed: [id, ...changed] };
}

export function writeAll(manifest, states, root = DEFAULT_ROOT, ids = null) {
  const dir = ticketsDir(root);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  for (const t of manifest.waterfall) {
    if (ids && !ids.includes(t.id)) continue;
    const s = states.get(t.id);
    writeFileSync(join(dir, ticketFile(t)), renderTicket(t, s));
    s.missing = false;
  }
  writeFileSync(join(dir, "INDEX.md"), renderIndex(manifest, states));
}

/** The only flags, and the commands that take them. Any other argument, even one starting with "--", is note text. */
const FLAGS = new Map([["--cascade", ["block", "reopen"]], ["--start", ["reopen"]]]);

function main(argv) {
  const flags = new Set(argv.filter((a) => FLAGS.has(a)));
  const [cmd, id, ...rest] = argv.filter((a) => !FLAGS.has(a));
  for (const flag of flags)
    if (!FLAGS.get(flag).includes(cmd)) {
      console.error(`${cmd ?? "(no command)"} does not take ${flag}; only ${FLAGS.get(flag).join(" and ")} do${FLAGS.get(flag).length === 1 ? "es" : ""}.`);
      return 1;
    }
  const note = rest.join(" ").trim();
  const root = DEFAULT_ROOT;
  const manifest = loadManifest(root);
  const states = loadStates(manifest, root);
  if (cmd === "settle") {
    const { changed, demoted } = settle(manifest, states);
    writeAll(manifest, states, root, changed);
    for (const c of changed) console.log(`${c} -> ${states.get(c).status}${demoted.includes(c) ? " (lowered)" : ""}`);
    console.log(changed.length ? `Settled ${changed.length} ticket(s).` : "Nothing to settle.");
    return 0;
  }
  if (cmd === "init" || cmd === "sync") {
    const created = manifest.waterfall.filter((t) => states.get(t.id).missing).length;
    if (cmd === "sync" && created) {
      console.error(`${created} ticket files are missing; run init.`);
      return 1;
    }
    writeAll(manifest, states, root);
    console.log(`${cmd === "init" ? `Created ${created} ticket files; ` : ""}rendered ${manifest.waterfall.length} tickets and INDEX.md.`);
    const found = problems(manifest, states);
    for (const p of found) console.log(`  inconsistent: ${p}`);
    return 0;
  }
  if (cmd === "list") {
    const bad = problems(manifest, states, { root });
    for (const t of sorted(manifest)) {
      const s = states.get(t.id);
      const flag = bad.some((p) => p.startsWith(`${t.id} `) || p.startsWith(`${t.id}:`)) ? "  (inconsistent)" : "";
      console.log(`[${STATUS_MARK[s.status] ?? "?"}] ${t.id}  ${String(s.status).padEnd(12)} ${t.ref ? `${t.ref.padEnd(4)}` : "    "}${t.title}${s.completed ? `  (${s.completed})` : ""}${flag}`);
    }
    return 0;
  }
  if (cmd === "check") {
    const found = problems(manifest, states, { root });
    for (const p of found) console.log(p);
    console.log(found.length ? `${found.length} problem(s).` : `OK: ${manifest.waterfall.length} tickets consistent and in sync.`);
    return found.length ? 1 : 0;
  }
  if (cmd === "status") {
    const t = manifest.waterfall.find((x) => x.id === id);
    if (!t) { console.error(`Unknown ticket: ${id}`); return 1; }
    const s = states.get(id);
    console.log(`${t.id} [${s.status}] ${t.title}${t.ref ? ` (${t.ref})` : ""}`);
    console.log(`depends on: ${t.depends_on.map((d) => `${d} (${states.get(d).status})`).join(", ") || "none"}`);
    console.log(`completed: ${s.completed ?? "-"}`);
    for (const e of s.log) console.log(`  ${renderEntry(e)}`);
    return 0;
  }
  if (["start", "done", "block", "reopen", "note"].includes(cmd)) {
    let result;
    try {
      result = transition(manifest, states, cmd, id, note, { cascade: flags.has("--cascade"), start: flags.has("--start"), root });
    } catch (error) {
      console.error(error.message);
      return 1;
    }
    writeAll(manifest, states, root, result.changed);
    for (const changed of result.changed) console.log(`${changed} -> ${states.get(changed).status}`);
    return 0;
  }
  console.log("Usage: node tools/ticket.mjs <list|check|init|sync|settle|start|done|block|reopen|note|status> [ticket-id] [note] [--cascade] [--start]");
  return cmd ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
