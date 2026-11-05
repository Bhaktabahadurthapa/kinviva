// Real-browser check for the Architecture feature. Needs the dev server (npm run dev, port 1420) and Chrome.
// Usage: CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/architecture-security-check.mjs
import { spawn } from "node:child_process";
const port = 9900 + Math.floor(Math.random()*90);
const c = spawn(process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new","--disable-gpu",`--remote-debugging-port=${port}`,`--user-data-dir=/tmp/ml-c-${port}`,"about:blank"],{stdio:"ignore"});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
let t; for(let i=0;i<50;i++){try{t=await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if(t.find(x=>x.type==="page"))break;}catch{} await sleep(200);}
const ws=new WebSocket(t.find(x=>x.type==="page").webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0; const p=new Map(); ws.onmessage=m=>{const d=JSON.parse(m.data); if(d.id&&p.has(d.id)){p.get(d.id)(d);p.delete(d.id);}};
const send=(method,params={})=>new Promise(r=>{const i=++id;p.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
await send("Page.navigate",{url:"http://localhost:1420/?mock&scene=live"}); await sleep(2500);
const r = await send("Runtime.evaluate",{awaitPromise:true,returnByValue:true,expression:`(async()=>{
 const R=await import('/src/lib/mermaidRender.ts'); const m=await R.loadMermaid('light'); const out={};
 window.__pwn=0;
 const cases={
  html:'flowchart TD\\n a["<img src=x onerror=window.__pwn=1>"] --> b["<b>bold</b><script>window.__pwn=2</script>"]',
  click:'flowchart TD\\n a-->b\\n click a call window.__pwn=3()\\n click b href "https://evil.example" _blank',
  directive:'%%{init: {"securityLevel":"loose","htmlLabels":true}}%%\\nflowchart TD\\n a["<img src=x onerror=window.__pwn=4>"]-->b',
  style:'flowchart TD\\n a-->b\\n style a fill:url(https://evil.example/x)'
 };
 for (const [k,src] of Object.entries(cases)) { try { const {svg}=await m.render('x'+k,src); const d=document.createElement('div'); d.innerHTML=svg; document.body.append(d); await new Promise(r=>setTimeout(r,200)); out[k]={foreign:/foreignObject/i.test(svg), img:/<img/i.test(svg), script:/<script/i.test(svg), onerror:/onerror/i.test(svg), evilLink:/evil\\.example/.test(svg), anchors:/<a[ >]/.test(svg)}; } catch(e){ out[k]='parse-error: '+e.message.split('\\n')[0].slice(0,60); } }
 out.pwn=window.__pwn; return out; })()`});
console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 1)); ws.close(); c.kill();
