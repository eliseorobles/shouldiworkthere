import {useEffect,useState,Component,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {EvidenceExperience} from './app.tsx';
import {SubmitPage} from './submit.tsx';
import {JuryPage,StatusPage} from './jury.tsx';
import {BRAND,LEGAL_LINKS} from '../shared/brand.ts';
import {fetchConfig,NAV_LINKS,TRUST_LINKS,THEME_KEY,type SiteConfig} from './api.ts';
import {Icon} from './canvas/parts.tsx';
import {forgetQuestion} from './share.ts';

type Theme='light'|'dark';
// The only thing this site keeps in browser storage for the canvas: an explicit light/dark choice.
const storedTheme=():Theme|null=>{try {const v=localStorage.getItem(THEME_KEY);return v==='light'||v==='dark'?v:null;} catch {return null;}};
const systemTheme=():Theme=>matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
const effectiveTheme=():Theme=>{const t=document.documentElement.dataset.theme;return t==='light'||t==='dark'?t:systemTheme();};
function applyTheme(theme:Theme|null) {
 const root=document.documentElement;if(theme)root.dataset.theme=theme;else delete root.dataset.theme;
 const color=effectiveTheme()==='dark'?'#0D1222':'#F6F8FD';
 document.querySelectorAll('meta[name="theme-color"]').forEach(meta=>meta.setAttribute('content',color));
}
/** Choosing the system's current theme returns to following the system, and removes the stored choice. */
function chooseTheme(theme:Theme) {
 const follow=theme===systemTheme();
 try {if(follow)localStorage.removeItem(THEME_KEY);else localStorage.setItem(THEME_KEY,theme);} catch {}
 applyTheme(follow?null:theme);
}
function ThemeToggle() {
 const [theme,setTheme]=useState<Theme>(effectiveTheme);
 useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)'),sync=()=>setTheme(effectiveTheme());media.addEventListener('change',sync);return ()=>media.removeEventListener('change',sync);},[]);
 const next=theme==='dark'?'light':'dark';
 return <button type="button" className="icon-button theme-toggle" aria-label={`Switch to ${next} theme`} onClick={()=>{chooseTheme(next);setTheme(next);}}><Icon name={theme==='dark'?'sun':'moon'}/></button>;
}

const SPA_PATHS=['/submit','/contribute','/jury','/status'];
const evidencePath=(path:string)=>path==='/'||path.startsWith('/c/');
function useRoute() {
 const [path,setPath]=useState(location.pathname);
 useEffect(()=>{
  const pop=()=>setPath(location.pathname);
  const click=(event:MouseEvent)=>{
   if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   const link=(event.target as Element|null)?.closest?.('a'),href=link?.getAttribute('href');
   if(!link||!href||link.target||link.hasAttribute('download'))return;
   const url=new URL(href,location.href);
   if(url.origin!==location.origin||!(evidencePath(url.pathname)||SPA_PATHS.includes(url.pathname)))return;
   event.preventDefault();
   if(url.pathname+url.search!==location.pathname+location.search) {
    forgetQuestion();
    history.pushState(null,'',url.pathname+url.search);
    window.dispatchEvent(new PopStateEvent('popstate',{state:null}));
   }
   scrollTo({top:0,behavior:'instant' as ScrollBehavior});
  };
  window.addEventListener('popstate',pop);document.addEventListener('click',click);
  return ()=>{window.removeEventListener('popstate',pop);document.removeEventListener('click',click);};
 },[]);
 return path;
}
class Boundary extends Component<{children:ReactNode},{failed:boolean}> {
 state={failed:false};static getDerivedStateFromError(){return {failed:true};}
 // The boundary cannot know whether a request was sent before the failure, so it says neither that something was nor that it wasn't.
 render(){return this.state.failed?<main className="page" id="main"><div className="empty large"><h1>This view couldn’t load</h1><p>Reload the page to try again. This error does not undo anything you had already sent. To check a contribution, open <a href="/status">Contribution status</a> with its capability.</p><div className="option-row"><a className="secondary-button" href="/">Return to {BRAND}</a></div></div></main>:this.props.children;}
}
function App() {
 const path=useRoute(),[config,setConfig]=useState<SiteConfig|null>(null);
 useEffect(()=>{void fetchConfig().then(setConfig);if('serviceWorker'in navigator)void navigator.serviceWorker.register('/sw.js').catch(()=>{});},[]);
 const kind=path==='/submit'||path==='/contribute'?'submit':path==='/jury'?'jury':path==='/status'?'status':'evidence';
 return <div className="frame">
  <a className="skip-link" href="#main">Skip to content</a>
  <header className="topbar">
   <a className="wordmark" href="/" aria-label={`${BRAND}, home`}><img src="/favicon.svg" alt="" width="28" height="28"/><span className="wordmark-text" aria-hidden="true">should i work there<span className="wordmark-q">?</span></span><span className="badge">Preview</span></a>
   <nav className="nav" aria-label="Main">{NAV_LINKS.map(l=><a key={l.href} href={l.href} {...(l.href==='/'&&kind==='evidence'?{'aria-current':'page' as const}:{})}>{l.label}</a>)}<ThemeToggle/><a className="nav-cta" href="/submit" {...(kind==='submit'?{'aria-current':'page' as const}:{})}>Contribute</a></nav>
  </header>
  <Boundary key={kind}>{kind==='submit'?<SubmitPage/>:kind==='jury'?<JuryPage/>:kind==='status'?<StatusPage/>:<EvidenceExperience config={config}/>}</Boundary>
  <footer className="footer">
   <div className="footer-brand"><span className="footer-name">{BRAND}</span><span>Know the workplace. Protect the person.</span></div>
   <nav className="footer-links" aria-label="Legal"><ul>{LEGAL_LINKS.map(l=><li key={l.href}><a href={l.href}>{l.label}</a></li>)}</ul></nav>
   <nav className="footer-links" aria-label="How it works"><ul>{TRUST_LINKS.map(l=><li key={l.href}><a href={l.href}>{l.label}</a></li>)}</ul></nav>
   <p className="footer-note">Free access. No ads. No employer privileges.</p>
  </footer>
 </div>;
}

// /theme.js (worker/src/pages.ts) already applied a stored choice before first paint; this keeps the app in step with it.
// Server-rendered trust pages load only /theme.js, never this bundle.
applyTheme(storedTheme());
const root=document.getElementById('app-root');
if(root)createRoot(root).render(<App/>);
