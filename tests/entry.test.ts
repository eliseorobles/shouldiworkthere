import {test} from 'node:test';
import assert from 'node:assert/strict';

// workerd treats every named export of a Worker's entry module as an entrypoint and refuses to start when one is not a
// function or handler (a constant crashed both workers at startup). Entry modules therefore export only `default`.
for(const entry of ['../worker/src/index.ts','../worker/inference.ts']) test(`${entry} exports only its default handler`,async()=>{
 const module=await import(entry);
 assert.deepEqual(Object.keys(module),['default']);
 assert.equal(typeof module.default.fetch,'function');
});
test('the verifier entry exports only functions besides its default handler',async()=>{
 const module=await import('../worker/issuer.ts');
 for(const [name,value] of Object.entries(module)) if(name!=='default') assert.equal(typeof value,'function',`${name} must be a function`);
});
