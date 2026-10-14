// THROWAWAY (HEL-1580, owner ruling A / C2). LOCAL LOOPBACK transport lab. No npm deps: node:https/http2/crypto + Chromium's
// built-in fetch/WebSocket (driven through the repo's playwright-core, absolute path). Simulated "evaluate" = a busy loop of SERVICE_MS.
// Usage: PLAYWRIGHT_CORE=/abs/node_modules/playwright-core nice -n 19 node transport-lab.cjs > results-transport-lab.json
const http2 = require("node:http2"), https = require("node:https"), crypto = require("node:crypto"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), cp = require("node:child_process");
const core = process.env.PLAYWRIGHT_CORE || "/home/matt/Development/helio/node_modules/playwright-core";
const { chromium } = require(core);
const SERVICE_MS = 7; // ~ the engine cost measured for 500 rows (preview 42-45 ms minus 36 ms floor), see measurements.md s2
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hel1580-lab-"));
cp.execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", dir + "/k.pem", "-out", dir + "/c.pem", "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
const tls = { key: fs.readFileSync(dir + "/k.pem"), cert: fs.readFileSync(dir + "/c.pem") };
const busy = (ms) => { const t = performance.now(); while (performance.now() - t < ms); };
const counters = { requests: 0, upgrades: 0, serverSawAbort: 0, wsMessages: 0, h1Connections: 0, h2Sessions: 0 };
const RESULT = JSON.stringify({ counts: [269, 269, 269], rows: Array.from({ length: 10 }, (_, i) => ({ date: "2023-01-" + i, status: "success", duration_s: 270 + i, duration_min: 4.5 })) });
const PAGE = `<!doctype html><meta charset=utf-8><body><script>
const stats=(a)=>{const s=[...a].sort((x,y)=>x-y);const q=p=>s[Math.min(s.length-1,Math.floor(p*s.length))];return{n:s.length,median:+q(.5).toFixed(2),p95:+q(.95).toFixed(2),max:+s[s.length-1].toFixed(2)}};
const body=(kb)=>JSON.stringify({steps:[{type:"filter"}],frame:"x".repeat(kb*1024)});
async function rr(base,kb,n,abortEvery){const ts=[];let proto="";for(let i=0;i<n;i++){const ac=new AbortController();const t0=performance.now();
 if(abortEvery&&i%abortEvery===0){const p=fetch(base+"/eval?slow=1",{method:"POST",body:body(kb),signal:ac.signal}).catch(()=>{});await new Promise(r=>setTimeout(r,2));ac.abort();await p;const t1=performance.now();}
 const t=performance.now();const r=await fetch(base+"/eval",{method:"POST",body:body(kb)});await r.text();ts.push(performance.now()-t);}
 proto=performance.getEntriesByType("resource").filter(e=>e.name.includes("/eval")).map(e=>e.nextHopProtocol).pop();return{...stats(ts),proto};}
async function nd(base,kb,n){const ts=[];for(let i=0;i<n;i++){const t=performance.now();const r=await fetch(base+"/eval-nd",{method:"POST",body:body(kb)});const rd=r.body.getReader();let lines=0,first=0;for(;;){const{done,value}=await rd.read();if(done)break;if(!first)first=performance.now()-t;lines++;}ts.push(performance.now()-t);}return stats(ts);}
async function sse(base,kb,n){const ts=[];const waiters=new Map();const r=await fetch(base+"/stream");const rd=r.body.getReader();const dec=new TextDecoder();let buf="";
 (async()=>{for(;;){const{done,value}=await rd.read();if(done)break;buf+=dec.decode(value);let k;while((k=buf.indexOf("\\n\\n"))>=0){const m=buf.slice(0,k);buf=buf.slice(k+2);const id=/id: (\\d+)/.exec(m);if(id&&waiters.has(id[1])){waiters.get(id[1])();waiters.delete(id[1]);}}}})();
 for(let i=0;i<n;i++){const t=performance.now();const w=new Promise(res=>waiters.set(String(i),res));await fetch(base+"/eval-sse?id="+i,{method:"POST",body:body(kb)}).then(x=>x.text());await w;ts.push(performance.now()-t);}rd.cancel();return stats(ts);}
async function ws(host,kb,n){const ts=[];const t0=performance.now();const s=new WebSocket("wss://"+host+"/ws");await new Promise((res,rej)=>{s.onopen=res;s.onerror=rej});const setup=performance.now()-t0;let cur;s.onmessage=()=>cur&&cur();
 for(let i=0;i<n;i++){const t=performance.now();const w=new Promise(res=>cur=res);s.send(body(kb));await w;ts.push(performance.now()-t);}s.close();return{...stats(ts),setupMs:+setup.toFixed(2)};}
async function cold(kind,base,host,kb){const t0=performance.now();if(kind==="ws"){const s=new WebSocket("wss://"+host+"/ws");await new Promise(r=>s.onopen=r);const w=new Promise(r=>s.onmessage=r);s.send(body(kb));await w;const d=performance.now()-t0;s.close();return d;}
 const r=await fetch(base+"/eval",{method:"POST",body:body(kb)});await r.text();return performance.now()-t0;}
async function multi(base,nd,n){const first=[],last=[];for(let i=0;i<n;i++){const t=performance.now();const r=await fetch(base+"/eval-multi?stepMs=30&nd="+(nd?1:0),{method:"POST",body:body(1)});const rd=r.body.getReader();let f=0;for(;;){const{done,value}=await rd.read();if(done)break;if(!f)f=performance.now()-t;}first.push(f);last.push(performance.now()-t);}return{firstByte:stats(first),complete:stats(last)};}
window.lab={rr,nd,sse,ws,cold,stats,multi};
</script>`;
function handler(req, res) {
  const u = new URL(req.url, "https://localhost");
  if (u.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end(PAGE); }
  counters.requests++;
  if (u.pathname === "/stream") { res.writeHead(200, { "content-type": "text/event-stream" }); streams.add(res); req.on("close", () => streams.delete(res)); return res.write(":open\n\n"); }
  let done = false; req.on("close", () => { if (!done && u.searchParams.get("slow")) counters.serverSawAbort++; });
  const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => {
    if (u.searchParams.get("slow")) { setTimeout(() => { done = true; try { res.end("{}"); } catch {} }, 50); return; }
    if (u.pathname === "/eval-multi") { // 3 sequential server steps of stepMs each; ndjson=1 flushes one line per step, else one body at the end
      const stepMs = Number(u.searchParams.get("stepMs")), nd = u.searchParams.get("nd") === "1"; const lines = [];
      res.writeHead(200, { "content-type": nd ? "application/x-ndjson" : "application/json" });
      let i = 0; const next = () => { if (i === 3) { done = true; return res.end(nd ? "" : JSON.stringify(lines)); } busy(stepMs); const l = JSON.stringify({ step: i, count: 269 }); i++; if (nd) res.write(l + "\n"); else lines.push(l); setImmediate(next); }; return next();
    }
    busy(SERVICE_MS); done = true;
    if (u.pathname === "/eval-nd") { res.writeHead(200, { "content-type": "application/x-ndjson" }); res.write('{"counts":[269,269,269]}\n'); return res.end(RESULT + "\n"); }
    if (u.pathname === "/eval-sse") { const id = u.searchParams.get("id"); for (const s of streams) s.write("id: " + id + "\ndata: " + RESULT + "\n\n"); res.writeHead(202); return res.end(); }
    res.writeHead(200, { "content-type": "application/json" }); res.end(RESULT);
  });
}
const streams = new Set();
const h2s = http2.createSecureServer({ ...tls, allowHTTP1: false }, handler);
const h1s = https.createServer(tls, handler);
h1s.on('secureConnection', () => counters.h1Connections++); h2s.on('session', () => counters.h2Sessions++);
h1s.on("upgrade", (req, sock) => { // minimal hand-rolled RFC 6455 server: accept, read one masked text frame, reply with an unmasked text frame
  counters.upgrades++;
  const key = req.headers["sec-websocket-key"];
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64") + "\r\n\r\n");
  let buf = Buffer.alloc(0);
  sock.on("data", (d) => { buf = Buffer.concat([buf, d]); for (;;) {
    if (buf.length < 2) return; let len = buf[1] & 127, off = 2; if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
    if (buf.length < off + 4 + len) return; const op = buf[0] & 15; buf = buf.subarray(off + 4 + len); if (op === 8) return sock.end(); counters.wsMessages++;
    busy(SERVICE_MS); const p = Buffer.from(RESULT); const hdr = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 255]); sock.write(Buffer.concat([hdr, p])); } });
  sock.on("error", () => {});
});
(async () => {
  await new Promise((r) => h2s.listen(0, "127.0.0.1", r)); await new Promise((r) => h1s.listen(0, "127.0.0.1", r));
  const P2 = h2s.address().port, P1 = h1s.address().port, B2 = "https://localhost:" + P2, B1 = "https://localhost:" + P1;
  const browser = await chromium.launch({ headless: true, args: ["--ignore-certificate-errors"] });
  const out = { env: { node: process.version, chromium: browser.version(), playwrightCore: require.resolve(core), serviceMsSimulated: SERVICE_MS, note: "LOCAL LOOPBACK, TLS with a self-signed cert, no network RTT; server is Node, not Pekko/JVM" }, warm: {}, cold: {}, abort: {} };
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true }); const page = await ctx.newPage();
  await page.goto(B1 + "/"); // origin h1; h2 pages are fetched cross-origin below, so serve the page per origin
  const p2 = await ctx.newPage(); await p2.goto(B2 + "/");
  for (const kb of [1, 29]) {
    const k = kb + "KB-up";
    out.warm["rr-h1 " + k] = await page.evaluate(([b, kb]) => window.lab.rr(b, kb, 300, 0), [B1, kb]);
    out.warm["rr-h2 " + k] = await p2.evaluate(([b, kb]) => window.lab.rr(b, kb, 300, 0), [B2, kb]);
    out.warm["ndjson-h1 " + k] = await page.evaluate(([b, kb]) => window.lab.nd(b, kb, 300), [B1, kb]);
    out.warm["ndjson-h2 " + k] = await p2.evaluate(([b, kb]) => window.lab.nd(b, kb, 300), [B2, kb]);
    out.warm["sse-h1 " + k] = await page.evaluate(([b, kb]) => window.lab.sse(b, kb, 300), [B1, kb]);
    out.warm["sse-h2 " + k] = await p2.evaluate(([b, kb]) => window.lab.sse(b, kb, 300), [B2, kb]);
    out.warm["websocket(h1 upgrade) " + k] = await page.evaluate(([h, kb]) => window.lab.ws(h, kb, 300), ["localhost:" + P1, kb]);
  }
  // supersession: every 3rd edit aborts an in-flight request, then the next edit is measured (does the connection stay warm?)
  counters.serverSawAbort = 0;
  out.abort["rr-h1 (abort every 3rd)"] = await page.evaluate(([b]) => window.lab.rr(b, 1, 150, 3), [B1]); out.abort["rr-h1 serverSawAbort"] = counters.serverSawAbort; counters.serverSawAbort = 0;
  out.abort["rr-h2 (abort every 3rd)"] = await p2.evaluate(([b]) => window.lab.rr(b, 1, 150, 3), [B2]); out.abort["rr-h2 serverSawAbort"] = counters.serverSawAbort;
  out.abort["h1 connections / h2 sessions opened so far (whole warm+abort phase, 1 page each)"] = { h1Connections: counters.h1Connections, h2Sessions: counters.h2Sessions };
  out.multiStep = { "rr (json, one body) h2, 3 server steps x 30 ms": await p2.evaluate(([b]) => window.lab.multi(b, false, 60), [B2]), "ndjson (one line per step) h2, 3 server steps x 30 ms": await p2.evaluate(([b]) => window.lab.multi(b, true, 60), [B2]) };
  await ctx.close();
  // cold: a brand-new browser context per trial (no pooled connection, no TLS session cache) -> first edit includes connection setup
  for (const [name, kind, base, host] of [["rr-h1", "rr", B1, null], ["rr-h2", "rr", B2, null], ["websocket", "ws", B1, "localhost:" + P1]]) {
    const ts = [];
    for (let i = 0; i < 20; i++) { const c = await browser.newContext({ ignoreHTTPSErrors: true }); const pg = await c.newPage(); await pg.goto((kind === "ws" || base === B1 ? B1 : B2) + "/"); ts.push(await pg.evaluate(([k, b, h]) => window.lab.cold(k, b, h, 1), [kind, base, host])); await c.close(); }
    out.cold[name + " 1KB first-edit"] = (() => { const s = ts.sort((a, b) => a - b); return { n: s.length, median: +s[10].toFixed(2), p95: +s[18].toFixed(2), max: +s[19].toFixed(2) }; })();
  }
  out.serverCounters = counters;
  await browser.close(); h1s.close(); h2s.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(JSON.stringify(out, null, 2)); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
