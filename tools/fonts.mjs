import {readFileSync,writeFileSync} from 'node:fs';
const fonts=[['Instrument Sans','instrument-sans'],['JetBrains Mono','jetbrains-mono']];
const css=fonts.map(([family,slug])=>`@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;font-display:swap;src:url(data:font/woff2;base64,${readFileSync(`node_modules/@fontsource-variable/${slug}/files/${slug}-latin-wght-normal.woff2`).toString('base64')}) format('woff2');}`).join('\n');
writeFileSync('web/fonts.css',css);
console.log(`Self-hosted variable fonts: ${(css.length/1024).toFixed(1)} KiB. Licenses included in the public source bundle.`);
