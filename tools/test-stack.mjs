#!/usr/bin/env node
// Own a temporary local stack for CI: refuse occupied ports and stop our workers even on failure.
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';

async function free(port) {
  await new Promise((resolve,reject)=>{
    const server=createServer();
    server.once('error',()=>reject(new Error(`Port ${port} is occupied. Stop the existing local stack before running test:stack.`)));
    server.listen(port,()=>server.close(resolve));
  });
}
const run=(command,args)=>new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:'inherit'});
  child.once('error',reject);
  child.once('exit',code=>code===0?resolve():reject(new Error(`${command} ${args.join(' ')} exited ${code}`)));
});
async function ready() {
  const pending=new Map([[8788,'/api/config'],[8789,'/'],[8790,'/keys']]);
  const deadline=Date.now()+120000;
  while(pending.size&&Date.now()<deadline) {
    for(const [port,path] of pending)try {
      const response=await fetch(`http://localhost:${port}${path}`,{signal:AbortSignal.timeout(2000)});
      if(port===8789||response.ok)pending.delete(port);
    } catch {}
    if(pending.size)await new Promise(r=>setTimeout(r,1000));
  }
  if(pending.size)throw new Error(`Workers did not become ready: ${[...pending.keys()].join(', ')}. See .wrangler/local-*.log.`);
}
for(const port of [8788,8789,8790,9231,9232,9233])await free(port);
try {
  await run(process.execPath,['tools/dev.mjs']);
  await ready();
  await run(process.execPath,['tests/integration.mjs']);
  await run('bunx',['playwright','test']);
} catch(error) {
  // Startup diagnostics are useful on a fresh runner. Mask env secrets before printing error lines.
  const secrets=['main','inference','verifier'].flatMap(name=>{
    const path=`.dev.vars.${name}`;
    return existsSync(path)?readFileSync(path,'utf8').split('\n').filter(line=>/^[A-Z_]*(KEY|SECRET|TOKEN|PEPPER)[A-Z_]*=/.test(line)).map(line=>line.slice(line.indexOf('=')+1)).filter(Boolean):[];
  });
  for(const name of ['main','inference','verifier']) {
    const path=`.wrangler/local-${name}.log`;
    if(!existsSync(path))continue;
    let text=readFileSync(path,'utf8');
    for(const value of secrets)text=text.replaceAll(value,'[REDACTED]');
    console.error(`${name} startup diagnostics:\n${text.split('\n').filter(line=>/error|failed|authentication|login|account|API|permission|not found/i.test(line)).slice(-80).join('\n')}`);
  }
  throw error;
} finally {
  await run(process.execPath,['tools/dev.mjs','--stop']);
}
