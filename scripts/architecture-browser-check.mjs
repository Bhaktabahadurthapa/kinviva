// Real-browser check for the Architecture feature. Needs the dev server (npm run dev, port 1420) and Chrome.
// Usage: CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/architecture-browser-check.mjs
import { spawn } from "node:child_process";
const port = 9900 + Math.floor(Math.random()*90);
const c = spawn(process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new","--disable-gpu",`--remote-debugging-port=${port}`,`--user-data-dir=/tmp/ml-c-${port}`,"--window-size=1440,900","about:blank"],{stdio:"ignore"});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
let t; for(let i=0;i<50;i++){try{t=await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if(t.find(x=>x.type==="page"))break;}catch{} await sleep(200);}
const ws=new WebSocket(t.find(x=>x.type==="page").webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0; const p=new Map(); ws.onmessage=m=>{const d=JSON.parse(m.data); if(d.id&&p.has(d.id)){p.get(d.id)(d);p.delete(d.id);}};
const send=(method,params={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
await send("Page.navigate",{url:"http://localhost:1420/?mock&scene=live"}); await sleep(2500);
const r = await send("Runtime.evaluate",{awaitPromise:true,returnByValue:true,expression:`(async()=>{
 const out={};
 const R=await import('/src/lib/mermaidRender.ts'); const A=await import('/src/lib/architecture.ts');
 const model={title:'t',diagram:'flowchart',illustrative:false,confidence:'low',explanation:'',concerns:[],references:[],
   components:[{id:'n1',label:'Web',kind:'client',evidence:'mentioned'},{id:'n2',label:'API',kind:'service',evidence:'mentioned'},{id:'n3',label:'DB',kind:'database',evidence:'inferred'}],
   relations:[{from:'n1',to:'n2',label:'HTTPS',evidence:'mentioned'},{from:'n2',to:'n3',label:'SQL',evidence:'inferred'}]};
 // valid light + dark
 for (const th of ['light','dark']) { const s=await R.renderDiagram(A.toMermaid(model),th); out['valid_'+th]=s.includes('<svg')&&!/foreignObject|<script/i.test(s); }
 // sequence
 out.sequence=(await R.renderDiagram(A.toMermaid({...model,diagram:'sequence'}),'light')).includes('<svg');
 // invalid syntax gives friendly error
 try{await R.renderDiagram('flowchart TD\\n a --> ','light');out.invalid='no error'}catch(e){out.invalid=e.message}
 // rejected content never reaches mermaid
 for (const [k,src] of Object.entries({directive:'flowchart TD\\n %%{init:{"securityLevel":"loose"}}%%\\n a-->b',click:'flowchart TD\\n a-->b\\n click a href "https://evil.example"',html:'flowchart TD\\n a["<img src=x onerror=alert(1)>"]-->b',pie:'pie\\n "a":1'})) { try{await R.renderDiagram(src,'light');out['bad_'+k]='RENDERED'}catch(e){out['bad_'+k]=e.message} }
 // large diagram
 const comps=Array.from({length:24},(_,i)=>({id:'n'+(i+1),label:'Service '+i,kind:'service',evidence:'mentioned'}));
 const rels=Array.from({length:40},(_,i)=>({from:'n'+((i%24)+1),to:'n'+(((i*7+3)%24)+1),label:'x',evidence:i%3?'mentioned':'inferred'})).filter(r=>r.from!==r.to);
 const t0=performance.now(); const big=await R.renderDiagram(A.toMermaid({...model,components:comps,relations:rels}),'light'); out.large_ms=Math.round(performance.now()-t0); out.large_ok=big.includes('<svg');
 // cache: second render instant
 const t1=performance.now(); await R.renderDiagram(A.toMermaid({...model,components:comps,relations:rels}),'light'); out.cached_ms=Math.round(performance.now()-t1);
 // sanitizer
 const evil='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><foreignObject><div>x</div></foreignObject><a href="https://evil.example"><rect width="5" height="5" onclick="alert(1)" style="fill:url(https://evil.example/x)"/></a><image href="https://evil.example/i.png"/></svg>';
 const clean=R.sanitizeSvg(evil); out.sanitized=!/script|foreignObject|evil|onclick|<a|image/i.test(clean);
 // exports
 const svg=await R.renderDiagram(A.toMermaid(model),'light');
 const exp=R.svgForExport(svg,'#ffffff'); out.svg_export=exp.startsWith('<?xml')&&/width="\\d+"/.test(exp);
 const png=await R.svgToPngBase64(svg,'#ffffff'); out.png_bytes=atob(png).length; out.png_magic=atob(png).slice(1,4);
 const pngDark=await R.svgToPngBase64(await R.renderDiagram(A.toMermaid(model),'dark'),'#12161d'); out.png_dark_bytes=atob(pngDark).length;
 return out; })()`});
console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 1)); ws.close(); c.kill();
