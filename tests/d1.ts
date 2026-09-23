import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import type {Env} from '../worker/src/types.ts';
import {decide} from '../shared/policy.ts';

export class TestD1 {
 db=new DatabaseSync(':memory:');
 prepare(sql:string) {
  const db=this.db;
  const bound=(values:unknown[]=[])=>({
   bind:(...args:unknown[])=>bound(args),
   async first(column?:string){const row=db.prepare(sql).get(...values as never[])??null;return column?row?.[column]:row;},
   async all(){return {success:true,results:db.prepare(sql).all(...values as never[]),meta:{}};},
   async run(){const info=db.prepare(sql).run(...values as never[]);return {success:true,meta:{changes:Number(info.changes)}};},
   raw:()=>db.prepare(sql).run(...values as never[]),
  });return bound();
 }
 async batch(statements:ReturnType<TestD1['prepare']>[]) {
  this.db.exec('BEGIN');try {const results=statements.map(s=>({success:true,meta:{changes:Number(s.raw().changes)}}));this.db.exec('COMMIT');return results;}catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 exec(sql:string){this.db.exec(sql);}
}
/** Applies every numbered migration in a directory, in order, exactly as production does. */
export function applyMigrations(db:TestD1,dir:string) {
 if(!existsSync(dir))return;
 for(const file of readdirSync(dir).filter(f=>/^\d{4}_.*\.sql$/.test(f)).sort())db.exec(readFileSync(`${dir}/${file}`,'utf8'));
}
/** The test environment shows the fictional sample employers (SAMPLE_EMPLOYERS 'on', as locally); production hides them. */
export function testEnv() {
 const publicDb=new TestD1();publicDb.exec(readFileSync('db/schema.sql','utf8'));publicDb.exec(readFileSync('db/seed.sql','utf8'));applyMigrations(publicDb,'db/migrations');
 const intake=new TestD1();intake.exec(readFileSync('db/intake.sql','utf8'));applyMigrations(intake,'db/intake-migrations');
 const signals={private_identity:0,contextual_identity:0,threat:0,doxxing:0,personal_attack:0,promotional:0,manipulation:0};
 const env={DB:publicDb,INTAKE:intake,MIN_COHORT_N:'25',MIN_CLUSTER_N:'5',ENVIRONMENT:'test',PUBLIC_ORIGIN:'http://localhost',REAL_PUBLICATION_ENABLED:'false',SAMPLE_EMPLOYERS:'on',INFERENCE:{fetch:async()=>Response.json({decision:decide(signals),signals,model:'test-fixture'})}} as unknown as Env;
 return {env,publicDb,intake};
}
