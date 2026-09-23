// Runs the three workers as separate local `wrangler dev` processes, each with only its own env file (--env-file
// replaces .dev.vars/.env loading). Inference and the verifier start first so the main worker's service bindings
// (INFERENCE, VERIFIER) resolve through the local dev registry. --test-scheduled lets you trigger each worker's cron locally at /__scheduled.
// Usage: node tools/dev.mjs [--restart] [--only=main,inference,verifier]. With --only, just those workers are (re)started
// and the others keep running, e.g. `node tools/dev.mjs --restart --only=verifier` after the verifier crashed.
import {spawn} from 'node:child_process';
import {openSync,writeFileSync,existsSync,readFileSync,mkdirSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const WORKERS=[
 {name:'inference',config:'inference.wrangler.jsonc',port:8789,inspector:9233,envFile:'.dev.vars.inference',owns:['TYPESAFE_API_KEY']},
 {name:'verifier',config:'issuer.wrangler.jsonc',port:8790,inspector:9232,envFile:'.dev.vars.verifier',owns:['ISSUER_MASTER_KEY','MAILBOX_PEPPER','INTERNAL_TOKEN']},
 {name:'main',config:'wrangler.jsonc',port:8788,inspector:9231,envFile:'.dev.vars.main',owns:['RATE_LIMIT_SECRET','INTERNAL_TOKEN']},
];
const SECRETS=['TYPESAFE_API_KEY','ISSUER_MASTER_KEY','MAILBOX_PEPPER','RATE_LIMIT_SECRET','ADMIN_TOKEN','ISSUER_KEYS','INTERNAL_TOKEN'];
const jsonc=text=>JSON.parse(text.replace(/^\s*\/\/.*$/mg,''));
/**
 * The main worker's service bindings (wrangler.jsonc services) each name a worker started here, so every binding
 * resolves through the local dev registry: INFERENCE → shouldiworkthere-inference, VERIFIER → shouldiworkthere-verifier.
 * Workers are started in WORKERS order, so both are up before the main worker. Pure: the problems, or [] when wired.
 */
export function serviceBindingProblems(mainConfigText,workerConfigs) {
 let services=[];
 try {services=jsonc(mainConfigText).services??[];} catch {return ['wrangler.jsonc could not be read'];}
 const names=new Set(Object.values(workerConfigs).map(text=>{try {return jsonc(text).name;} catch {return null;}}));
 const problems=[];
 for(const binding of ['INFERENCE','VERIFIER']) {
  const service=services.find(s=>s?.binding===binding)?.service;
  if(!service)problems.push(`wrangler.jsonc binds no ${binding} service`);
  else if(!names.has(service))problems.push(`wrangler.jsonc binds ${binding} to ${service}, which no local worker is named`);
 }
 return problems;
}
/** The one secret the main worker and the verifier share must be present and identical in both env files, or every internal call is refused. */
export function sharedSecretProblems(mainText,verifierText) {
 const value=(text,key)=>text.split('\n').find(line=>line.startsWith(`${key}=`))?.slice(key.length+1).trim()??'';
 const main=value(mainText,'INTERNAL_TOKEN'),verifier=value(verifierText,'INTERNAL_TOKEN');
 return !main||!verifier?['INTERNAL_TOKEN is missing from .dev.vars.main or .dev.vars.verifier']:main!==verifier?['INTERNAL_TOKEN differs between .dev.vars.main and .dev.vars.verifier']:[];
}
/** Refuse to start a worker whose env file holds another worker's secret (for example an old shared .dev.vars copy). */
export function envFileProblems(worker,text) {
 const keys=text.split('\n').filter(line=>/^[A-Z_]+=/.test(line)).map(line=>line.slice(0,line.indexOf('=')));
 const foreign=keys.filter(key=>SECRETS.includes(key)&&!worker.owns.includes(key)).map(key=>`${worker.envFile} holds ${key}, which ${worker.name} does not own`);
 const billable=worker.name==='inference'&&!/^JEV_PROVIDER=typesafe$/m.test(text)?['.dev.vars.inference does not set JEV_PROVIDER=typesafe, so local inference would call the remote, billable Workers AI binding']:[];
 return [...foreign,...billable];
}
export const childEnv=environment=>Object.fromEntries(Object.entries(environment).filter(([key])=>!/TYPESAFE|ISSUER|MAILBOX_PEPPER|ADMIN_TOKEN|MASTER_KEY|RATE_LIMIT_SECRET|INTERNAL_TOKEN/.test(key)));

/** --only=main,verifier starts (or with --restart, restarts) just those workers and leaves the others running. */
export function selectedWorkers(argv) {
 const only=argv.find(a=>a.startsWith('--only='))?.slice(7);
 if(!only)return WORKERS;
 const names=only.split(',').map(s=>s.trim()).filter(Boolean),unknown=names.filter(n=>!WORKERS.some(w=>w.name===n));
 if(unknown.length)throw new Error(`Unknown worker ${unknown.join(', ')}; use ${WORKERS.map(w=>w.name).join(', ')}.`);
 return WORKERS.filter(w=>names.includes(w.name));
}

/**
 * A note when the local stack has its own issuer keys (tools/prepare-local.mjs) but the client build does not pin them:
 * the local contribution and juror flows would refuse every local key. null when nothing is wrong.
 */
export function pinNote(clientAssets,localRegistryExists) {
 if(!localRegistryExists||!clientAssets)return null;
 let pins=null;try {pins=JSON.parse(/^export const CLIENT_ISSUER_PINS = (.*);$/m.exec(clientAssets)?.[1]??'null');} catch {}
 return pins?.registry==='local'?null:'The client build does not pin the local issuer keys, so the local contribution and juror flows will refuse them. Run node tools/build.mjs --local (never release that build).';
}

/**
 * A warning when the production registry (db/issuer-public-keys.json) holds a key of the local registry: the local
 * verifier would then hold a production private key, and a release would pin it. null when they share nothing.
 */
export function sharedKeyNote(productionText,localText) {
 const moduli=text=>{try {const keys=JSON.parse(text);return new Set(Array.isArray(keys)?keys.map(k=>k?.publicKey?.n).filter(Boolean):[]);} catch {return new Set();}};
 const production=moduli(productionText),shared=[...moduli(localText)].filter(n=>production.has(n)).length;
 return shared?`WARNING: ${shared} key(s) of db/issuer-public-keys.json are also local keys (.wrangler/provision/local-issuer-public-keys.json). They are not production keys: move db/issuer-public-keys.* and .issuer-secrets.json aside; node tools/provision-issuer.mjs --remote then creates fresh ones, and tools/transparency.mjs refuses to sign a registry holding a local key.`:null;
}

async function main() {
  if(process.argv.includes('--stop')) {
    for(const worker of selectedWorkers(process.argv)) {
      const file=`.wrangler/local-${worker.name}.pid`;
      if(existsSync(file))try{process.kill(-Number(readFileSync(file,'utf8')),'SIGTERM');}catch{}
    }
    console.log('Stopped the local worker process groups recorded by this checkout.');return;
  }
 if(!existsSync('.wrangler')||WORKERS.some(w=>!existsSync(w.envFile)))throw new Error('Run node tools/prepare-local.mjs first.');
 const problems=[...WORKERS.flatMap(w=>envFileProblems(w,readFileSync(w.envFile,'utf8'))),...sharedSecretProblems(readFileSync('.dev.vars.main','utf8'),readFileSync('.dev.vars.verifier','utf8'))];
 if(problems.length)throw new Error(`${problems.join('; ')}. Run node tools/prepare-local.mjs again (or with --env-only for the env files alone).`);
 const wiring=serviceBindingProblems(readFileSync('wrangler.jsonc','utf8'),Object.fromEntries(WORKERS.filter(w=>w.name!=='main').map(w=>[w.name,readFileSync(w.config,'utf8')])));
 if(wiring.length)throw new Error(wiring.join('; '));
 if(!existsSync('worker/generated/release-manifest.ts')){mkdirSync('worker/generated',{recursive:true});writeFileSync('worker/generated/release-manifest.ts','// GENERATED by tools/transparency.mjs - do not edit by hand. null until a release manifest is signed.\nexport const RELEASE_MANIFEST: string | null = null;\n');}
 const workers=selectedWorkers(process.argv),subset=workers.length<WORKERS.length;
 if(process.argv.includes('--restart')) {
  for(const file of [...workers.map(w=>`.wrangler/local-${w.name}.pid`),...(subset?[]:['.wrangler/local-dev.pid'])]) if(existsSync(file))try{process.kill(-Number(readFileSync(file,'utf8')),'SIGTERM');}catch{}
  await new Promise(r=>setTimeout(r,1500));
 }
 // Secrets exported in this shell must not leak into a worker whose config does not own them.
 const env=childEnv(process.env);
 for(const worker of workers) {
  const output=openSync(`.wrangler/local-${worker.name}.log`,'a');
   const child=spawn('bunx',['wrangler','dev','--config',worker.config,'--local','--test-scheduled','--port',String(worker.port),'--inspector-port',String(worker.inspector),'--env-file',worker.envFile],{detached:true,stdio:['ignore',output,output],env:{...env,WRANGLER_SEND_METRICS:'false'}});
  writeFileSync(`.wrangler/local-${worker.name}.pid`,String(child.pid));child.unref();
 }
 const note=pinNote(existsSync('worker/generated/client-assets.ts')?readFileSync('worker/generated/client-assets.ts','utf8'):'',existsSync('.wrangler/provision/local-issuer-public-keys.json'));
 if(note)console.warn(note);
 const shared=existsSync('db/issuer-public-keys.json')&&existsSync('.wrangler/provision/local-issuer-public-keys.json')?sharedKeyNote(readFileSync('db/issuer-public-keys.json','utf8'),readFileSync('.wrangler/provision/local-issuer-public-keys.json','utf8')):null;
 if(shared)console.warn(shared);
 console.log(subset?`Starting ${workers.map(w=>`${w.name} :${w.port}`).join(', ')}; the other workers were left as they are. Logs: .wrangler/local-{${workers.map(w=>w.name).join(',')}}.log`:'Local preview starting: http://localhost:8788 (inference :8789, verifier :8790; each runs its cron at /__scheduled). Logs: .wrangler/local-{main,inference,verifier}.log');
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) await main();
