#!/usr/bin/env node
/**
 * Renders the Open Graph images (1200x630 JPEG, at most 90 KB each) into web/og/ with Playwright: one for the home page
 * and one per directory employer in db/seed.sql. Fictional employers are labeled as fictional in the image itself; real
 * employers get the rule-based "opens after" card, which shellMeta uses only while nothing about them is published.
 * No numbers, quotes or ratings appear in any image. Run `node tools/og.mjs`, then `node tools/build.mjs` to embed them.
 *
 * Only the seeded employers get their own image. The employers later migrations add to the directory (0009 and after,
 * about two hundred) share the home image: every image is embedded in the main Worker bundle, and one per employer would
 * add roughly 60 KB each, several megabytes in all. pages.ts falls back to home.jpg for any employer without its own image,
 * and tests/web.test.ts checks that every directory employer's page names an image the Worker serves.
 */
import {chromium} from '@playwright/test';
import {mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {policy} from '../shared/policy.ts';

// The publication rule on real-employer cards comes from the executable policy, never a copy of its number.
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..'),OUT=join(ROOT,'web','og'),LIMIT=90*1024,MINIMUM_BATCH=policy.retention.minimumBatch;
const fonts=readFileSync(join(ROOT,'web','fonts.css'),'utf8');
const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

export function seedCompanies(sql=readFileSync(join(ROOT,'db','seed.sql'),'utf8')) {
 const block=/INSERT INTO companies[^;]*?VALUES([\s\S]*?);/.exec(sql)?.[1]??'';
 return [...block.matchAll(/\(\s*'[^']*',\s*'([a-z0-9][a-z0-9-]*)',\s*'((?:[^']|'')*)',\s*'(sample|real)',\s*'((?:[^']|'')*)'/g)].map(m=>({slug:m[1],name:m[2].replaceAll("''","'"),kind:m[3],sector:m[4].replaceAll("''","'")}));
}

const mark=`<svg width="56" height="56" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6F84FF"/><stop offset="1" stop-color="#3D52CC"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/><path d="M23 23c0-11 20-11 20 0 0 8-11 7-11 16" stroke="white" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="32" cy="49" r="3" fill="white"/></svg>`;
const page=body=>`<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
*{box-sizing:border-box;margin:0}html,body{width:1200px;height:630px}
body{font-family:'Instrument Sans',sans-serif;color:#151B2E;background:#F6F8FD;overflow:hidden;position:relative;padding:64px 80px}
body::before{content:'';position:absolute;inset:0;background:radial-gradient(60% 55% at 50% -10%,#8FA2FF66,transparent 70%),radial-gradient(40% 40% at 95% 100%,#DCE3FD,transparent 70%)}
main{position:relative;height:100%;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:16px;font-size:34px;font-weight:600;letter-spacing:-.035em}.brand b{color:#4B63F0;font-weight:600}
.pill{display:inline-flex;align-self:flex-start;align-items:center;gap:12px;font-size:26px;font-weight:600;border-radius:999px;padding:10px 24px}
.fiction{color:#8A5A0B;background:#FBF1DF;border:2px solid #E9C98E}.real{color:#3D52CC;background:#DCE3FD}
h1{font-size:96px;font-weight:500;letter-spacing:-.045em;line-height:1.02}
h1 span{color:#56607A}
.lede{font-size:34px;line-height:1.35;color:#56607A;letter-spacing:-.01em;max-width:960px}
.composer{margin-top:auto;display:flex;align-items:center;gap:20px;background:#fff;border-radius:40px;padding:18px 18px 18px 36px;box-shadow:0 0 0 2px #DCE2EF,0 30px 80px -30px #4B63F0aa;font-size:30px;color:#56607A}
.composer i{margin-left:auto;width:64px;height:64px;border-radius:50%;background:#4B63F0;display:grid;place-items:center}
.foot{margin-top:auto;font-size:26px;color:#56607A;display:flex;gap:28px}
</style></head><body><main>${body}</main></body></html>`;
const brand=`<div class="brand">${mark}<span>should i work there<b>?</b></span></div>`;
const send='<i><svg width="30" height="30" viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></i>';

export function ogHtml(target) {
 if(target.kind==='home')return page(`${brand}<h1 style="margin-top:52px">Know the workplace.<br><span>Keep your privacy.</span></h1><div class="composer">Find a company, ask a question, compare what matters${send}</div>`);
 const name=escape(target.name),size=name.length>22?72:name.length>14?88:104;
 if(target.kind==='sample')return page(`${brand}<span class="pill fiction" style="margin-top:44px">Fictional demonstration, illustrative data</span><h1 style="margin-top:22px;font-size:${size}px">${name}</h1><p class="lede" style="margin-top:18px">A fictional employer. Every number, account and event on its page is demonstration data.</p><div class="foot"><span>Every number opens to its evidence</span></div>`);
 return page(`${brand}<span class="pill real" style="margin-top:44px">Real employer</span><h1 style="margin-top:22px;font-size:${size}px">${name}</h1><p class="lede" style="margin-top:18px">This record opens after ${MINIMUM_BATCH} verified coworkers contribute. An empty record says nothing about working here.</p><div class="foot"><span>Anonymous, credentialed contributions</span></div>`);
}

async function render(browser,target) {
 const context=await browser.newContext({viewport:{width:1200,height:630},deviceScaleFactor:1});
 const tab=await context.newPage();await tab.setContent(ogHtml(target),{waitUntil:'load'});await tab.evaluate(()=>document.fonts.ready);
 let quality=90,bytes;
 do {bytes=await tab.screenshot({type:'jpeg',quality,clip:{x:0,y:0,width:1200,height:630}});quality-=6;} while(bytes.length>LIMIT&&quality>30);
 await context.close();
 if(bytes.length>LIMIT)throw new Error(`${target.file} stays above ${LIMIT} bytes`);
 return bytes;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
 mkdirSync(OUT,{recursive:true});
 const targets=[{kind:'home',file:'home.jpg'},...seedCompanies().map(c=>({...c,file:`c-${c.slug}.jpg`}))];
 const browser=await chromium.launch();
 try {for(const target of targets){const bytes=await render(browser,target);writeFileSync(join(OUT,target.file),bytes);console.log(`${target.file} ${(bytes.length/1024).toFixed(1)} KB`);}}
 finally {await browser.close();}
 const keep=new Set(targets.map(t=>t.file));
 for(const file of readdirSync(OUT))if(file.endsWith('.jpg')&&!keep.has(file))rmSync(join(OUT,file));
}
