import {test} from 'node:test';
import assert from 'node:assert/strict';
import fixture from './inference-fixture.ts';
import {INTEGRATION_TESTIMONY} from './inference-fixture-data.ts';
import {testEnv} from './d1.ts';
import {digest} from '../shared/proof.ts';

const request=(approvedText=INTEGRATION_TESTIMONY,consent=true)=>new Request('https://inference/screen',{method:'POST',body:JSON.stringify({approvedText,consent})});
test('the integration provider fixture runs real screening and matches only its exact synthetic text',async()=>{
  const env={DB:testEnv().env.DB,ENVIRONMENT:'development'};
  const response=await fixture.fetch(request(),env);
  assert.equal(response.status,200);
  const body=await response.json() as {decision:{action:string};model:string;contentHash:string};
  assert.equal(body.decision.action,'clear');assert.equal(body.model,'ci-screening-fixture');
  assert.equal(body.contentHash,await digest(INTEGRATION_TESTIMONY));
  assert.equal((await fixture.fetch(request('An arbitrary account that the deterministic fixture must never approve.'),env)).status,503);
  assert.notEqual((await fixture.fetch(request(INTEGRATION_TESTIMONY,false),env)).status,200);
});
test('the integration fixture refuses production and missing environment declarations',async()=>{
  const DB=testEnv().env.DB;
  for(const env of [{DB},{DB,ENVIRONMENT:'production'}])assert.equal((await fixture.fetch(request(),env)).status,503);
});
