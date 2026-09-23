// Test-only Worker entrypoint. All screening validation, budgets, and policy code remain real;
// only the provider's answer for one exact synthetic paragraph is deterministic.
import inference,{type InferenceEnv} from '../worker/inference-core.ts';
import type {AIBinding,Question} from '../worker/src/ai.ts';
import {INTEGRATION_TESTIMONY} from './inference-fixture-data.ts';

const fixture:AIBinding={async run(_model,input) {
  const {state,questions}=input as {state:{testimony?:string};questions:Record<string,Question>};
  if(state.testimony!==INTEGRATION_TESTIMONY||Object.values(questions).some(q=>q.type!=='noul'))throw new Error('No provider fixture for this input');
  return {model:'ci-screening-fixture',answers:Object.fromEntries(Object.keys(questions).map(id=>[id,{type:'noul',noul:0.001}]))};
}};
const offline=(env:InferenceEnv)=>({...env,AI:undefined,JEV_PROVIDER:'typesafe',JEV_FALLBACK:'off',TYPESAFE_API_KEY:undefined});

export default {
  async fetch(request:Request,env:InferenceEnv&{ENVIRONMENT?:string}) {
    if(env.ENVIRONMENT!=='development')return Response.json({error:'test_fixture_is_local_only'},{status:503});
    const screening=new URL(request.url).pathname==='/screen';
    return inference.fetch(request,{...offline(env),AI:screening?fixture:undefined,JEV_PROVIDER:screening?'cloudflare':'typesafe'});
  },
  async queue(batch:MessageBatch<{id:string}>,env:InferenceEnv) {await inference.queue(batch,offline(env));},
  async scheduled(event:ScheduledController,env:InferenceEnv) {await inference.scheduled(event,offline(env));},
};
