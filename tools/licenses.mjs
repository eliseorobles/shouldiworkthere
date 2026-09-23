#!/usr/bin/env node
// Preserve the installed runtime dependency licenses and notices, including transitive dependencies.
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,writeFileSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
export function dependencyNotices(root=ROOT) {
  const files={'licenses/Apache-2.0.txt':readFileSync(join(root,'licenses/Apache-2.0.txt'),'utf8')},packages=[],seen=new Set();
  function visit(name,from) {
    const packagePath=createRequire(from).resolve(`${name}/package.json`);
    if(seen.has(packagePath))return;
    seen.add(packagePath);
    const dir=dirname(packagePath),pkg=JSON.parse(readFileSync(packagePath,'utf8'));
    const notices=readdirSync(dir).filter(f=>/^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i.test(f)).sort();
    if(!notices.length)throw new Error(`No license text found for ${name}`);
    const prefix=`${name.replace(/^@/,'').replaceAll('/','-')}-${pkg.version}`;
    const paths=notices.map(f=>`licenses/${prefix}-${f}${f.endsWith('.txt')?'':'.txt'}`);
    for(let i=0;i<notices.length;i++)files[paths[i]]=readFileSync(join(dir,notices[i]),'utf8');
    packages.push({name,version:pkg.version,license:pkg.license,files:paths});
    for(const child of Object.keys(pkg.dependencies??{}).sort())visit(child,packagePath);
  }
  const rootPackage=join(root,'package.json');
  for(const name of Object.keys(JSON.parse(readFileSync(rootPackage,'utf8')).dependencies).sort())visit(name,rootPackage);
  files['licenses/index.json']=`${JSON.stringify(packages.sort((a,b)=>a.name.localeCompare(b.name)),null,2)}\n`;
  return files;
}
function main() {
  const files=dependencyNotices();
  if(process.argv.includes('--write')) {
    mkdirSync(join(ROOT,'licenses'),{recursive:true});
    for(const [path,text] of Object.entries(files))writeFileSync(join(ROOT,path),text);
    console.log(`Wrote ${Object.keys(files).length} runtime license/notice files. Review and stage them.`);
  } else if(process.argv.includes('--check')) {
    for(const [path,text] of Object.entries(files))if(!existsSync(join(ROOT,path))||readFileSync(join(ROOT,path),'utf8')!==text)throw new Error(`${path} is missing or stale; run node tools/licenses.mjs --write`);
    const expected=new Set(Object.keys(files));
    for(const file of readdirSync(join(ROOT,'licenses')))if(!expected.has(`licenses/${file}`))throw new Error(`Stale license file: licenses/${file}; review and remove it after updating dependencies.`);
    console.log(`Runtime dependency licenses verified (${Object.keys(files).length} files).`);
  } else throw new Error('Usage: node tools/licenses.mjs --write|--check');
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))main();
