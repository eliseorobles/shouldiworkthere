import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const publication=await import('../tools/publication.mjs' as string) as {
  publicPath:(p:string)=>boolean;
  publicSourceFiles:(root:string)=>Record<string,string>;
  readPublicFile:(root:string,path:string)=>Buffer;
};
const build=await import('../tools/build.mjs' as string) as {verifierOriginFromConfig:(text:string)=>string};
const dev=await import('../tools/dev.mjs' as string) as {localConfig:(text:string)=>Record<string,unknown>};

test('local configs omit remote-only inference bindings while preserving local service wiring',()=>{
  const config={name:'inference',main:'worker/inference.ts',ai:{binding:'AI'},d1_databases:[{binding:'DB'}],services:[{binding:'VERIFIER',service:'verifier'}]};
  const {ai:_,...expected}=config;
  assert.deepEqual(dev.localConfig(JSON.stringify(config)),expected);
});

test('an unlisted local document cannot enter the downloadable source, even inside a public directory',()=>{
  const root=mkdtempSync(join(tmpdir(),'siwt-publication-'));
  try {
    mkdirSync(join(root,'docs'));
    writeFileSync(join(root,'docs','public.md'),'public protocol');
    writeFileSync(join(root,'docs','internal.md'),'unreviewed local notes');
    writeFileSync(join(root,'public-source.json'),JSON.stringify(['docs/public.md']));
    assert.deepEqual(publication.publicSourceFiles(root),{'docs/public.md':'public protocol'});
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('publication refuses private paths and traversal even when explicitly listed',()=>{
  for(const path of ['.env','.env.production','.dev.vars.main','.issuer-secrets.json','.release-signing-key.json','.private-backups/key.json','db/backup.sql','db/dump.sql','worker/generated/client-assets.ts','web/fonts.css','docs/../.env','/etc/passwd','docs\\public.md','node_modules/react/index.js','launch-videos/public/frame.jpg'])assert.equal(publication.publicPath(path),false,path);
  for(const path of ['.env.example','db/issuer-public-keys.json','db/issuer-public-keys.sql','docs/releases/release.json','licenses/react-LICENSE.txt'])assert.equal(publication.publicPath(path),true,path);
});

test('publication refuses both file and directory symlinks, including targets within the project',()=>{
  const root=mkdtempSync(join(tmpdir(),'siwt-publication-'));
  try {
    mkdirSync(join(root,'docs'));mkdirSync(join(root,'private'));
    writeFileSync(join(root,'private','notes.md'),'private');
    symlinkSync(join(root,'private','notes.md'),join(root,'docs','notes.md'));
    assert.throws(()=>publication.readPublicFile(root,'docs/notes.md'),/Symlink/);
    symlinkSync(join(root,'private'),join(root,'docs','linked'));
    assert.throws(()=>publication.readPublicFile(root,'docs/linked/notes.md'),/Symlink/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('a fork pins its configured verifier custom domain and ambiguous routes fail closed',()=>{
  assert.equal(build.verifierOriginFromConfig('{"routes":[{"pattern":"verify.fork.example","custom_domain":true}]}'),'https://verify.fork.example');
  for(const routes of [[],[{pattern:'*.example',custom_domain:true}],[{pattern:'example/path',custom_domain:true}],[{pattern:'a.example',custom_domain:true},{pattern:'b.example',custom_domain:true}]])assert.throws(()=>build.verifierOriginFromConfig(JSON.stringify({routes})),/exactly one custom domain/);
});
