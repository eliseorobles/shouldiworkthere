#!/usr/bin/env node
// A reviewed, exact file manifest is shared by source downloads and repository checks.
// --update deliberately refreshes it from the Git index; a build never discovers files.
import {readFileSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const MANIFEST='public-source.json';
const ROOT_FILES=new Set(['.gitignore','.gitleaks.toml','.node-version','.env.example','LICENSE','README.md','CONTRIBUTING.md','SECURITY.md','CODE_OF_CONDUCT.md','THIRD_PARTY_NOTICES.md','TRADEMARKS.md','CHANGELOG.md','package.json','bun.lock','tsconfig.json','playwright.config.ts','wrangler.jsonc','inference.wrangler.jsonc','issuer.wrangler.jsonc',MANIFEST]);
const SOURCE=/^(?:shared|worker\/src|web|db|tools|tests|docs|tickets|licenses|\.github)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|css|sql|md|json|jsonc|yml|yaml|txt)$/;
const ENTRIES=new Set(['worker/issuer.ts','worker/inference.ts','worker/inference-core.ts','.github/CODEOWNERS']);
const FORBIDDEN=/(?:^|\/)(?:node_modules|generated|\.wrangler|\.git|\.private-backups|artifacts|test-results|local-drafts|exports|backups)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|\.dev\.vars.*|.*(?:secret|signing-key|dump|backup).*|.*\.(?:pem|key|sqlite3?|db))$/i;
export function publicPath(path) {
  if(typeof path!=='string'||path.includes('\\')||path.split('/').some(p=>p==='..'||p==='.'||!p))return false;
  if(path==='.env.example')return true;
  if(FORBIDDEN.test(path)||path==='web/fonts.css')return false;
  return ROOT_FILES.has(path)||ENTRIES.has(path)||SOURCE.test(path)||/^web\/og\/[a-z0-9-]+\.jpg$/.test(path);
}
export function readPublicFile(root,path) {
  if(!publicPath(path))throw new Error(`Not a publishable source path: ${path}`);
  const base=realpathSync(root),full=resolve(base,path);
  // Check every path component: a symlinked directory must not expose local files either.
  let cursor=base;
  for(const part of path.split('/')) {cursor=resolve(cursor,part);if(lstatSync(cursor).isSymbolicLink())throw new Error(`Symlink in public source path: ${path}`);}
  if(relative(base,realpathSync(full)).split(sep).includes('..'))throw new Error(`Path escapes source root: ${path}`);
  const stat=lstatSync(full);
  if(!stat.isFile()||stat.size>1024*1024)throw new Error(`Public source must be a regular file under 1 MiB: ${path}`);
  return readFileSync(full);
}
export function publicPaths(root=ROOT) {
  const paths=JSON.parse(readFileSync(resolve(root,MANIFEST),'utf8'));
  if(!Array.isArray(paths)||!paths.length||paths.some(p=>!publicPath(p)))throw new Error('public-source.json must contain only approved public paths');
  if(JSON.stringify(paths)!==JSON.stringify([...new Set(paths)].sort()))throw new Error('public-source.json must be sorted with no duplicates');
  return paths;
}
export function publicSourceFiles(root=ROOT) {
  return Object.fromEntries(publicPaths(root).filter(p=>!p.endsWith('.jpg')).map(p=>[p,readPublicFile(root,p).toString('utf8')]));
}
function indexedPaths(root) {
  const result=spawnSync('git',['ls-files','--stage','-z'],{cwd:root,encoding:'utf8'});
  if(result.status!==0)throw new Error('Use --check/--update in a Git checkout; building a release archive needs no Git.');
  return result.stdout.split('\0').filter(Boolean).map(row=>{
    const [metadata,path]=row.split('\t'),[mode,,stage]=metadata.split(' ');
    if(!['100644','100755'].includes(mode)||stage!=='0')throw new Error(`Unsupported index entry: ${path}`);
    return path;
  }).sort();
}
export function checkPublication(root=ROOT) {
  const paths=indexedPaths(root),approved=publicPaths(root);
  for(const path of paths)readPublicFile(root,path);
  if(JSON.stringify(paths)!==JSON.stringify(approved))throw new Error('Git index differs from public-source.json. Review staged paths, then run node tools/publication.mjs --update and stage the manifest.');
  return paths;
}
function main() {
  if(process.argv.includes('--update')) {
    const paths=indexedPaths(ROOT);
    for(const path of paths)readPublicFile(ROOT,path);
    if(!paths.includes(MANIFEST))throw new Error('Stage public-source.json before refreshing it.');
    writeFileSync(resolve(ROOT,MANIFEST),`${JSON.stringify(paths,null,2)}\n`);
    console.log(`Publication manifest refreshed: ${paths.length} files. Review the diff and stage ${MANIFEST}.`);
  } else if(process.argv.includes('--check'))console.log(`Publication check passed: ${checkPublication().length} approved files; no symlinks or private paths.`);
  else throw new Error('Usage: node tools/publication.mjs --check|--update');
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))main();
