import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,utimesSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {OPERATOR_LEGAL_NAME,OPERATOR_PHONE,OPERATOR_POSTAL_ADDRESS} from '../shared/brand.ts';

type Entry={ts:string;text:string};
type State={status:string;completed:string|null;log:Entry[];missing?:boolean};
type Ticket={id:string;ref?:string;phase:string;title:string;depends_on:string[];scope:string;acceptance:string|string[];files?:string[];tests?:string[]};
type Manifest={project:string;north_star:string;waterfall:Ticket[]};
const T=await import('../tools/ticket.mjs' as string) as {
 parseTicket:(raw:string)=>{meta:Record<string,string>;log:Entry[]};
 renderTicket:(t:Ticket,s:State)=>string;
 loadManifest:(root?:string)=>Manifest;
 loadStates:(m:Manifest,root?:string)=>Map<string,State>;
 problems:(m:Manifest,s:Map<string,State>,o?:{root?:string|null})=>string[];
 transition:(m:Manifest,s:Map<string,State>,cmd:string,id:string,note:string,o?:{cascade?:boolean;start?:boolean;now?:string;root?:string|null})=>{changed:string[]};
 settle:(m:Manifest,s:Map<string,State>,now?:string)=>{changed:string[];demoted:string[]};
 writeAll:(m:Manifest,s:Map<string,State>,root?:string)=>void;
 recordReads:(text:string,root?:string|null)=>string;
 citedDocs:(text:string)=>string[];
};
const ROOT=join(import.meta.dirname,'..');
const NOW='2026-09-22 12:00 UTC';
const ticket=(id:string,deps:string[]=[]):Ticket=>({id,phase:'Phase 0',title:`Ticket ${id}`,depends_on:deps,scope:'Scope.',acceptance:['First criterion.','Second criterion.'],tests:['tests/example.test.ts']});
const state=(status:string,extra:Entry[]=[]):State=>({status,completed:status==='DONE'?NOW:null,log:[{ts:NOW,text:'Ticket created.'},...extra]});
const verified={ts:NOW,text:'Verified: tests/example.test.ts passes.'};
const chain=():[Manifest,Map<string,State>]=>[
 {project:'P',north_star:'N',waterfall:[ticket('A'),ticket('B',['A']),ticket('C',['B'])]},
 new Map([['A',state('DONE',[verified])],['B',state('DONE',[verified])],['C',state('DONE',[verified])]]),
];

test('the log is read only from its own section: acceptance checkboxes never become entries, and re-rendering is idempotent', () => {
 const t=ticket('X');
 const s:State={status:'DONE',completed:NOW,log:[
  {ts:'x',text:'A hand-written checklist line from an older file.'},
  {ts:' ',text:'An unchecked hand-written line.'},
  {ts:NOW,text:'Ticket created.'},
  {ts:NOW,text:'A multi-line entry:\n- first point\n  - nested point'},
  {ts:NOW,text:'A note with a blank line:\n\nand text after it, then a whitespace-only line:\n   \nand the end.'},
  verified,
 ]};
 let text=T.renderTicket(t,s);
 assert.match(text,/^- \[x\] First criterion\.$/m,'a DONE ticket renders its acceptance as checked');
 for(let round=0;round<3;round++) {
  const {meta,log}=T.parseTicket(text);
  assert.deepEqual(log,s.log,'only the Log section is read back, verbatim');
  assert.equal(meta.status,'DONE');
  const again=T.renderTicket(t,{status:meta.status!,completed:meta.completed??null,log});
  assert.equal(again,text,'render → parse → render is a fixed point');
  text=again;
 }
 assert.equal(text.match(/First criterion/g)?.length,1,'acceptance lines are never duplicated into the log');
});

test('status rules: DONE needs DONE dependencies and a cited verification, IN PROGRESS cannot sit on pending or blocked work, PENDING cannot sit on blocked work, BLOCKED names its prerequisite', () => {
 const [m,s]=chain();
 assert.deepEqual(T.problems(m,s),[]);
 s.set('A',state('IN PROGRESS'));
 assert.deepEqual(T.problems(m,s),['B is DONE but depends on A (IN PROGRESS)']);
 s.set('B',state('IN PROGRESS'));s.set('C',state('PENDING'));
 assert.deepEqual(T.problems(m,s),[],'rework may overlap a prerequisite that is itself in progress');
 s.set('A',state('PENDING'));
 assert.deepEqual(T.problems(m,s),['B is IN PROGRESS but depends on A (PENDING)']);
 s.set('A',state('BLOCKED'));s.set('B',state('PENDING'));
 assert.deepEqual(T.problems(m,s),['A is BLOCKED but its latest status entry does not name the prerequisite','B is PENDING but depends on A (BLOCKED), so it is blocked too (run settle)']);
 s.set('A',state('BLOCKED',[{ts:NOW,text:'BLOCKED: Needs the owner.'}]));s.set('B',state('BLOCKED',[{ts:NOW,text:'BLOCKED: waits on A (blocked: Needs the owner.)'}]));
 assert.deepEqual(T.problems(m,s),['C is PENDING but depends on B (BLOCKED), so it is blocked too (run settle)'],'the rule applies all the way down');
 s.set('C',state('BLOCKED',[{ts:NOW,text:'BLOCKED: waits on B (blocked: Needs the owner.)'}]));
 assert.deepEqual(T.problems(m,s),[]);
 s.set('B',state('PENDING'));s.set('C',state('PENDING'));
 s.set('A',state('DONE',[{ts:NOW,text:'Finished the work.'}]));
 assert.deepEqual(T.problems(m,s),['A is DONE but no log entry since it last closed cites a test file or a verification command']);
 s.set('A',state('DONE',[verified,{ts:NOW,text:'REOPENED: regression.'},{ts:NOW,text:'Fixed it.'}]));
 assert.deepEqual(T.problems(m,s),['A is DONE but no log entry since it last closed cites a test file or a verification command'],'evidence from before a reopen does not count');
});

test('done refuses open dependencies and notes that cite no test; start refuses unstarted or blocked prerequisites', () => {
 const [m,s]=chain();
 T.transition(m,s,'reopen','A','Regression found.',{cascade:true,now:NOW});
 assert.throws(()=>T.transition(m,s,'done','B','Verified: tests/example.test.ts',{now:NOW}),/Dependencies not DONE: A \(PENDING\)/);
 assert.throws(()=>T.transition(m,s,'start','B','',{now:NOW}),/not DONE or IN PROGRESS: A \(PENDING\)/);
 assert.throws(()=>T.transition(m,s,'done','A','Looks fine now.',{now:NOW}),/must cite a test file/);
 T.transition(m,s,'done','A','Re-verified: node --test tests/example.test.ts passes.',{now:NOW});
 assert.equal(s.get('A')!.status,'DONE');
 assert.throws(()=>T.transition(m,s,'start','A','',{now:NOW}),/use reopen/);
 assert.deepEqual(T.problems(m,s),[]);
});

test('reopen and block refuse to strand dependents unless cascaded, and the cascade records why on each one', () => {
 let [m,s]=chain();
 assert.throws(()=>T.transition(m,s,'reopen','A','Regression.',{now:NOW}),/would leave dependents inconsistent: B, C/);
 assert.equal(s.get('A')!.status,'DONE','a refused command changes nothing');
 assert.deepEqual(T.transition(m,s,'reopen','A','Regression.',{start:true,cascade:true,now:NOW}).changed,['A','B','C']);
 assert.deepEqual([...s.values()].map(x=>x.status),['IN PROGRESS','IN PROGRESS','IN PROGRESS']);
 assert.match(s.get('B')!.log.at(-1)!.text,/^REOPENED: prerequisite A was reopened/);
 assert.deepEqual(T.problems(m,s),[]);
 [m,s]=chain();
 T.transition(m,s,'block','A','Needs an independent trustee.',{cascade:true,now:NOW});
 assert.deepEqual([...s.values()].map(x=>x.status),['BLOCKED','BLOCKED','BLOCKED']);
 assert.equal(s.get('C')!.log.at(-1)!.text,'BLOCKED: waits on B (blocked: Needs an independent trustee.)','the external prerequisite is named, not a chain of waits');
 assert.equal(s.get('C')!.completed,null);
 assert.deepEqual(T.problems(m,s),[]);
 assert.throws(()=>T.transition(m,s,'block','A','',{now:NOW}),/prerequisite/);
});

test('a reopen is judged by its own dependents only; an unrelated inconsistency is left for check to report', () => {
 const m:Manifest={project:'P',north_star:'N',waterfall:[ticket('A'),ticket('B',['A']),ticket('X'),ticket('Y',['X'])]};
 const s=new Map([['A',state('DONE',[verified])],['B',state('PENDING')],['X',state('IN PROGRESS')],['Y',state('DONE',[verified])]]);
 assert.deepEqual(T.transition(m,s,'reopen','A','Regression.',{now:NOW}).changed,['A']);
 assert.equal(s.get('Y')!.status,'DONE','an unrelated ticket is not rewritten');
 assert.deepEqual(T.problems(m,s),['Y is DONE but depends on X (IN PROGRESS)']);
 const m2:Manifest={project:'P',north_star:'N',waterfall:[ticket('A'),ticket('X'),ticket('Z',['A','X'])]};
 const s2=new Map([['A',state('DONE',[verified])],['X',state('IN PROGRESS')],['Z',state('DONE',[verified])]]);
 T.transition(m2,s2,'reopen','A','Regression.',{start:true,cascade:true,now:NOW});
 assert.equal(s2.get('Z')!.log.at(-1)!.text,'REOPENED: prerequisite A was reopened; this ticket closes again after it does.','a knock-on names the prerequisite that moved');
});

test('a ticket with a blocked dependency is blocked too, its recorded reason stays current, and it is released when the block lifts',()=>{
 const m:Manifest={project:'P',north_star:'N',waterfall:[ticket('A'),ticket('B',['A']),ticket('C',['B']),ticket('D',['A']),ticket('E',['A'])]};
 const s=new Map([['A',state('IN PROGRESS')],['B',state('PENDING')],['C',state('PENDING')],['D',state('IN PROGRESS')],['E',state('BLOCKED',[{ts:NOW,text:'BLOCKED: Needs a trustee.'}])]]);
 assert.deepEqual(T.problems(m,s),[]);
 assert.throws(()=>T.transition(m,s,'block','A','Needs counsel.',{now:NOW}),/would leave dependents inconsistent: B, C, D\./,'pending dependents are lowered too, so the block needs --cascade');
 T.transition(m,s,'block','A','Needs counsel.',{cascade:true,now:NOW});
 assert.deepEqual([...s.values()].map(x=>x.status),['BLOCKED','BLOCKED','BLOCKED','BLOCKED','BLOCKED']);
 assert.equal(s.get('C')!.log.at(-1)!.text,'BLOCKED: waits on B (blocked: Needs counsel.)');
 assert.equal(s.get('E')!.log.at(-1)!.text,'BLOCKED: Needs a trustee.','a ticket blocked for its own reason keeps it');
 assert.deepEqual(T.problems(m,s),[]);
 // A new reason reaches every waiting dependent without --cascade, because no status is lowered.
 assert.deepEqual(T.transition(m,s,'block','A','Needs counsel and the owner.',{now:NOW}).changed,['A','B','C','D']);
 assert.equal(s.get('C')!.log.at(-1)!.text,'BLOCKED: waits on B (blocked: Needs counsel and the owner.)');
 assert.deepEqual(T.problems(m,s),[]);
 s.get('A')!.log.push({ts:NOW,text:'BLOCKED: Something else.'});
 assert.deepEqual(T.problems(m,s),['B is BLOCKED waiting on A, but the reason it records is out of date (run settle)','D is BLOCKED waiting on A, but the reason it records is out of date (run settle)']);
 s.get('A')!.log.pop();
 // Lifting the block releases the waiting dependents; E's own prerequisite still holds it.
 assert.deepEqual(T.transition(m,s,'start','A','Counsel answered.',{now:NOW}).changed,['A','B','C','D']);
 assert.deepEqual([...s.values()].map(x=>x.status),['IN PROGRESS','PENDING','PENDING','PENDING','BLOCKED']);
 assert.equal(s.get('B')!.log.at(-1)!.text,'UNBLOCKED: A is no longer blocked (it is IN PROGRESS); this ticket can start again.');
 assert.equal(s.get('C')!.log.at(-1)!.text,'UNBLOCKED: B is no longer blocked (it is PENDING); this ticket can start again.');
 assert.deepEqual(T.problems(m,s),[]);
 // The rule is checked, not only applied: a pending ticket on a blocked dependency, or a stale wait, is reported.
 s.set('A',state('BLOCKED',[{ts:NOW,text:'BLOCKED: Needs counsel.'}]));
 assert.deepEqual(T.problems(m,s),['B is PENDING but depends on A (BLOCKED), so it is blocked too (run settle)','D is PENDING but depends on A (BLOCKED), so it is blocked too (run settle)']);
 s.set('A',state('DONE',[verified]));s.set('B',state('BLOCKED',[{ts:NOW,text:'BLOCKED: waits on A (blocked: Needs counsel.)'}]));
 assert.deepEqual(T.problems(m,s),['B is BLOCKED waiting on A, which is DONE (run settle)','C is PENDING but depends on B (BLOCKED), so it is blocked too (run settle)']);
});

test('settle applies a dependency added to the manifest, and releases what no longer waits',()=>{
 const m:Manifest={project:'P',north_star:'N',waterfall:[ticket('A'),ticket('B'),ticket('C',['B'])]};
 const s=new Map([['A',state('BLOCKED',[{ts:NOW,text:'BLOCKED: Needs the owner.'}])],['B',state('IN PROGRESS')],['C',state('PENDING')]]);
 m.waterfall[1]!.depends_on=['A'];
 assert.deepEqual(T.problems(m,s),['B is IN PROGRESS but depends on A (BLOCKED)']);
 assert.deepEqual(T.settle(m,s,NOW),{changed:['B','C'],demoted:['B','C']});
 assert.equal(s.get('B')!.log.at(-1)!.text,'BLOCKED: waits on A (blocked: Needs the owner.)');
 assert.equal(s.get('C')!.log.at(-1)!.text,'BLOCKED: waits on B (blocked: Needs the owner.)','the external prerequisite is named, not a chain of waits');
 assert.deepEqual(T.problems(m,s),[]);
 m.waterfall[1]!.depends_on=[];
 assert.deepEqual(T.problems(m,s),['B is BLOCKED waiting on A, which it does not depend on']);
 assert.deepEqual(T.settle(m,s,NOW),{changed:['B','C'],demoted:[]},'a wait on a ticket that is no longer a dependency is released, and so is what waited on it');
 assert.equal(s.get('B')!.log.at(-1)!.text,'UNBLOCKED: this ticket no longer depends on A; it can start again.');
 assert.deepEqual([...s.values()].map(x=>x.status),['BLOCKED','PENDING','PENDING']);
 assert.deepEqual(T.problems(m,s),[]);
});

test('with the project root known, a completion note must cite a test file that exists or a verification command, and the tracker is not one',()=>{
 const root=mkdtempSync(join(tmpdir(),'siwt-evidence-'));
 try {
  mkdirSync(join(root,'tests'));writeFileSync(join(root,'tests','real.test.ts'),'');
  const [m,s]=chain();
  T.transition(m,s,'reopen','A','Regression.',{start:true,cascade:true,now:NOW});
  assert.throws(()=>T.transition(m,s,'done','A','No tests yet; tests/missing.test.ts does not exist.',{now:NOW,root}),/cites tests\/missing\.test\.ts, which does not exist/);
  assert.throws(()=>T.transition(m,s,'done','A','node tools/ticket.mjs check says OK',{now:NOW,root}),/must cite a test file/);
  assert.throws(()=>T.transition(m,s,'done','A','Verified: tests/real.test.ts and tests/gone.test.ts.',{now:NOW,root}),/cites tests\/gone\.test\.ts/,'every cited test file must exist');
  T.transition(m,s,'done','A','node --test "tests/*.test.ts": all passed.',{now:NOW,root});
  T.transition(m,s,'done','B','Verified: tests/real.test.ts passes.',{now:NOW,root});
  assert.equal(s.get('B')!.status,'DONE');
  T.writeAll(m,s,root);
  s.set('C',state('DONE',[{ts:NOW,text:'Verified: tests/gone.test.ts passes.'}]));
  assert.deepEqual(T.problems(m,s,{root}).filter(p=>p.startsWith('C ')),['C is DONE but no log entry since it last closed cites a test file or a verification command','C is DONE but cites tests/gone.test.ts, which does not exist']);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('the command line applies the same rules to real files, keeps every word of a note, and refuses status prefixes in plain notes', () => {
 const root=mkdtempSync(join(tmpdir(),'siwt-tickets-'));
 try {
  mkdirSync(join(root,'tools'));mkdirSync(join(root,'tests'));
  writeFileSync(join(root,'tests','example.test.ts'),'');
  const [m]=chain();
  writeFileSync(join(root,'tools','tickets.manifest.json'),JSON.stringify(m));
  const run=(...args:string[])=>spawnSync(process.execPath,[join(ROOT,'tools','ticket.mjs'),...args],{env:{...process.env,TICKETS_ROOT:root},encoding:'utf8'});
  const log=()=>T.parseTicket(readFileSync(join(root,'tickets','A-ticket-a.md'),'utf8')).log;
  assert.equal(run('init').status,0);
  assert.equal(run('check').status,0);
  assert.equal(run('done','B','Verified: tests/example.test.ts').status,1,'B cannot close before A');
  assert.equal(run('done','A','No tests yet; tests/missing.test.ts does not exist.').status,1,'a missing test file is not evidence');
  assert.equal(run('done','A','node tools/ticket.mjs check says OK').status,1,'the tracker is not verification');
  assert.equal(run('done','A','Verified: tests/example.test.ts').status,0);
  assert.equal(run('note','A','A second','note.').status,0);
  assert.equal(run('note','A','ran','npx','tsc','--noEmit','ok').status,0);
  assert.equal(log().at(-1)!.text,'ran npx tsc --noEmit ok','only --cascade and --start are flags');
  assert.equal(run('note','A','x','--cascade').status,1,'a flag the command does not take is refused, not dropped');
  assert.equal(run('note','A','BLOCKED: this is not a block').status,1);
  assert.equal(run('note','A','UNBLOCKED: nor this').status,1);
  assert.equal(run('note','A','First line.\n\nThird line after a blank one.').status,0);
  assert.equal(log().at(-1)!.text,'First line.\n\nThird line after a blank one.');
  assert.equal(run('check').status,0,'a note with a blank line stays in sync');
  assert.equal(run('settle').status,0);
  const file=readFileSync(join(root,'tickets','A-ticket-a.md'),'utf8');
  assert.equal(log().length,5,'created, completed and three notes: nothing else');
  assert.equal(file.match(/Second criterion/g)?.length,1);
  writeFileSync(join(root,'tickets','A-ticket-a.md'),file.replace('status: DONE','status: DONE\nextra: drift'));
  assert.equal(run('check').status,1,'a hand edit that drifts from the manifest is reported');
  writeFileSync(join(root,'tickets','A-ticket-a.md'),file);
  assert.equal(run('check').status,0);
  writeFileSync(join(root,'tickets','A-old-title.md'),file);
  const orphan=run('check');
  assert.equal(orphan.status,1);assert.match(orphan.stdout,/tickets\/A-old-title\.md matches no ticket in the manifest/,'a file left behind by a title change is reported');
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('a note that cites a document records what it read, and check reports the note once the document changes until a later note re-reads it', () => {
 const root=mkdtempSync(join(tmpdir(),'siwt-docs-'));
 try {
  mkdirSync(join(root,'tools'));mkdirSync(join(root,'tests'));mkdirSync(join(root,'docs','legal'),{recursive:true});
  writeFileSync(join(root,'tests','example.test.ts'),'');
  writeFileSync(join(root,'docs','evaluation.md'),'27 cases, 88 of 108 correct, p50 169 ms.\n');
  writeFileSync(join(root,'docs','legal','terms.md'),'Terms.\n');
  const [m]=chain();
  writeFileSync(join(root,'tools','tickets.manifest.json'),JSON.stringify(m));
  const run=(...args:string[])=>spawnSync(process.execPath,[join(ROOT,'tools','ticket.mjs'),...args],{env:{...process.env,TICKETS_ROOT:root},encoding:'utf8'});
  const log=(id:string)=>T.parseTicket(readFileSync(join(root,'tickets',`${id}-ticket-${id.toLowerCase()}.md`),'utf8')).log;
  assert.equal(run('init').status,0);
  assert.equal(run('done','A','Verified: tests/example.test.ts; docs/evaluation.md states 88 of 108.').status,0);
  const read=log('A').at(-1)!.text.match(/\[read docs\/evaluation\.md (sha256:[0-9a-f]{12})\]$/);
  assert.ok(read,'the digest of the cited document is recorded with the note');
  assert.equal(run('note','B','Nothing cited here.').status,0);
  assert.doesNotMatch(log('B').at(-1)!.text,/\[read /,'a note that cites no document records nothing');
  assert.equal(run('check').status,0);
  // The document is rewritten after the note: the note no longer describes it.
  writeFileSync(join(root,'docs','evaluation.md'),'33 cases, 111 of 132 correct, p50 193 ms.\n');
  const stale=run('check');
  assert.equal(stale.status,1);
  assert.match(stale.stdout,new RegExp(`A: its \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC entry cites docs/evaluation\\.md, which has changed since that entry read it \\(${read![1]} then, sha256:[0-9a-f]{12} now\\)`));
  assert.match(run('list').stdout,/^\[x\] A .*\(inconsistent\)$/m,'list flags the ticket too');
  // A later note that re-reads it settles the citation; the old entry stays as written.
  assert.equal(run('note','A','Correction: docs/evaluation.md now states 111 of 132.').status,0);
  assert.equal(run('check').status,0);
  assert.equal(log('A').filter(e=>e.text.includes('88 of 108')).length,1,'the earlier entry is kept');
  // An entry without a digest (hand-written, or older than digests) is judged by the document's modification time.
  const s=T.loadStates(m,root);
  s.get('C')!.log.push({ts:'2026-09-22 21:41 UTC',text:'docs/legal/terms.md says so.'});
  const at=(iso:string)=>new Date(iso);
  utimesSync(join(root,'docs','legal','terms.md'),at('2026-09-22T21:41:30Z'),at('2026-09-22T21:41:30Z'));
  assert.deepEqual(T.problems(m,s,{root}).filter(p=>p.startsWith('C:')&&!p.includes('in sync')),[],'a change within the minute the entry was written is not reported');
  utimesSync(join(root,'docs','legal','terms.md'),at('2026-09-22T21:48:39Z'),at('2026-09-22T21:48:39Z'));
  assert.deepEqual(T.problems(m,s,{root}).filter(p=>p.startsWith('C:')&&!p.includes('in sync')),['C: its 2026-09-22 21:41 UTC entry cites docs/legal/terms.md, which was modified at 2026-09-22 21:48 UTC, after that entry; re-read it and add a note, a correction if the entry no longer holds']);
  s.get('C')!.log.push({ts:'2026-09-22 21:50 UTC',text:'docs/gone.md was read.'});
  assert.ok(T.problems(m,s,{root}).includes('C: its 2026-09-22 21:50 UTC entry cites docs/gone.md, which does not exist'));
  // A "waits on" entry copies another ticket's reason; that ticket's own entry is the one judged.
  s.get('B')!.log.push({ts:'2026-09-22 21:00 UTC',text:'BLOCKED: waits on A (blocked: see docs/legal/terms.md)'});
  assert.ok(!T.problems(m,s,{root}).some(p=>p.startsWith('B:')&&p.includes('docs/')));
  // Without the root nothing is recorded or compared, so the in-memory rules stay pure.
  assert.equal(T.recordReads('see docs/evaluation.md',null),'see docs/evaluation.md');
  assert.deepEqual(T.citedDocs('docs/evaluation.md, README.md and docs/legal/terms.md. Again docs/evaluation.md.'),['docs/evaluation.md','README.md','docs/legal/terms.md']);
  assert.deepEqual(T.citedDocs('docs/../../etc/notes.md'),[],'a path that leaves docs/ is never read');
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('the repository tickets are consistent with their dependencies, in sync with the manifest, and every DONE ticket cites its verification', () => {
 const m=T.loadManifest(ROOT);
 assert.deepEqual(T.problems(m,T.loadStates(m,ROOT),{root:ROOT}),[]);
 const done=[...T.loadStates(m,ROOT)].filter(([,s])=>s.status==='DONE').map(([id])=>id);
 assert.ok(!done.includes('W-021'),'production deploy stays open until the reconciled release is deployed and verified');
});

test('every brief gap and hardening item has exactly one ticket with testable acceptance', () => {
 const m=T.loadManifest(ROOT);
 const refs=m.waterfall.flatMap(t=>t.ref?[t.ref]:[]);
 const expected=[...['G','U','L'].flatMap(p=>Array.from({length:8},(_,i)=>`${p}${i+1}`)),...Array.from({length:10},(_,i)=>`H${i+1}`)];
 assert.deepEqual([...refs].sort(),[...expected].sort());
 for(const t of m.waterfall.filter(t=>t.ref)) {
  assert.ok(Array.isArray(t.acceptance)&&t.acceptance.length>0,`${t.id} has an acceptance list`);
  assert.ok((t.tests?.length??0)>0,`${t.id} names its verification`);
 }
});

test('the legal operator is never named in the manifest, the tracker or the tickets, in any form, and W-034 says so', () => {
 const m=T.loadManifest(ROOT);
 // The full legal name, the name without its entity suffix and its first word, and the operator's contact details.
 const name=OPERATOR_LEGAL_NAME.replace(/,?\s+(?:LLC|L\.L\.C\.|Inc\.?|Ltd\.?|Corp\.?|Co\.?)$/i,'').trim();
 const needles=[...new Set([OPERATOR_LEGAL_NAME,name,name.split(/\s+/)[0]!,OPERATOR_PHONE,OPERATOR_POSTAL_ADDRESS])].filter(n=>n.length>=4);
 assert.ok(needles.length>=4,'the check derives several forms of the operator from shared/brand.ts');
 const files=[join(ROOT,'tools','tickets.manifest.json'),join(ROOT,'tools','ticket.mjs'),...readdirSync(join(ROOT,'tickets')).map(f=>join(ROOT,'tickets',f))];
 assert.ok(files.some(f=>f.endsWith('INDEX.md')));
 for(const file of files) {
  const text=readFileSync(file,'utf8').toLowerCase();
  needles.forEach((needle,i)=>assert.ok(!text.includes(needle.toLowerCase()),`${file} contains operator form #${i}`));
 }
 assert.ok((m.waterfall.find(t=>t.id==='W-034')!.acceptance as string[]).includes('The legal operator appears only in legal text, never as product branding.'));
});
