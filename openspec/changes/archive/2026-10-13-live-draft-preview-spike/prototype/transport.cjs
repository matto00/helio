// THROWAWAY (HEL-1580 task 2). Local transport measurements against THIS worktree's backend.
// Usage: HELIO_DEV_EMAIL=... HELIO_DEV_PASSWORD=... BACKEND_PORT=9919 nice -n 19 node transport.cjs
// Creates 1 dataset source (500 rows) + 1 pipeline (3 steps) under the dev account, measures, then deletes both by exact id.
const BASE = `http://localhost:${process.env.BACKEND_PORT || 9919}`;
const H = { "X-Helio-Requested-With": "1", "Content-Type": "application/json" };
let cookie = "";
const stats = (a) => { const s = a.slice().sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, median: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1), min: +s[0].toFixed(1) }; };
async function api(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { ...H, cookie }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, json: t ? (() => { try { return JSON.parse(t); } catch { return t; } })() : null, headers: r.headers, bytes: Buffer.byteLength(t) };
}
(async () => {
  const created = { source: null, pipeline: null, steps: [] };
  const out = { base: BASE, note: "LOCAL loopback: no network RTT included" };
  try {
    const login = await fetch(BASE + "/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ email: process.env.HELIO_DEV_EMAIL, password: process.env.HELIO_DEV_PASSWORD }) });
    if (login.status !== 200) throw new Error("login " + login.status);
    cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const rows = []; const base = Date.UTC(2023, 0, 1);
    for (let i = 0; i < 500; i++) rows.push([new Date(base + i * 86400000).toISOString().slice(0, 10), rnd() < 0.9 ? "success" : "failed", Math.round(180 + rnd() * 180)]);
    let r = await api("POST", "/api/data-sources", { name: "HEL-1580 transport probe", type: "static", columns: [{ name: "date", type: "string", required: true }, { name: "status", type: "string", required: true }, { name: "duration_s", type: "integer", required: true }], rows });
    if (r.status !== 201) throw new Error("source " + r.status + JSON.stringify(r.json)); created.source = r.json.id;
    r = await api("POST", "/api/pipelines", { name: "HEL-1580 transport probe", roots: [{ sourceId: created.source }] });
    if (r.status !== 201) throw new Error("pipeline " + r.status + JSON.stringify(r.json)); created.pipeline = r.json.id;
    const defs = [
      { type: "filter", config: { combinator: "AND", conditions: [{ field: "duration_s", operator: ">=", value: "260" }] } },
      { type: "sort", config: { sortBy: [{ field: "date", direction: "asc" }] } },
      { type: "compute", config: { column: "duration_min", expression: "duration_s / 60", type: "number" } },
    ];
    for (const d of defs) { r = await api("POST", `/api/pipelines/${created.pipeline}/steps`, d); if (r.status !== 201) throw new Error("step " + r.status + JSON.stringify(r.json)); created.steps.push(r.json.id); }
    out.created = created;
    // step preview round trips (sequential; 25 on step 3 = the full 3-step closure, 5 on step 1)
    const timeGet = async (path, n) => { const ts = []; let last; for (let i = 0; i < n; i++) { const t0 = performance.now(); last = await api("GET", path); ts.push(performance.now() - t0); if (last.status !== 200) throw new Error(path + " " + last.status); } return { ...stats(ts), responseBytes: last.bytes, rowsReturned: (last.json.rows || []).length, totalCount: last.json.totalCount ?? last.json.rowCount }; };
    out.previewStep3_closure3 = await timeGet(`/api/pipelines/${created.pipeline}/steps/${created.steps[2]}/preview`, 25);
    out.previewStep1_closure1 = await timeGet(`/api/pipelines/${created.pipeline}/steps/${created.steps[0]}/preview`, 5);
    // baseline: a trivial authenticated GET (auth + RLS plumbing, no engine) to separate per-request floor from evaluation cost
    out.baselineAuthMe = await timeGet("/api/auth/me", 15).catch((e) => ({ error: String(e) }));
    // run-events: time from fetch() to response headers (no event is pending, so this is the connection-open cost)
    const opens = [];
    for (let i = 0; i < 15; i++) { const ac = new AbortController(); const t0 = performance.now(); const resp = await fetch(`${BASE}/api/pipelines/${created.pipeline}/run-events`, { headers: { cookie }, signal: ac.signal }); opens.push(performance.now() - t0); out.runEventsHeaders = { status: resp.status, contentType: resp.headers.get("content-type"), transferEncoding: resp.headers.get("transfer-encoding") }; ac.abort(); }
    out.runEventsOpenToHeaders = stats(opens);
    // small-diff probe: how big is a step-preview body vs the full 500-row frame the client would need
    out.fullFrameBytesEstimate = Buffer.byteLength(JSON.stringify(rows.map((x) => ({ date: x[0], status: x[1], duration_s: x[2] }))));
  } catch (e) { out.error = String(e); }
  finally {
    out.cleanup = {};
    if (created.pipeline) out.cleanup.pipelineDelete = (await api("DELETE", `/api/pipelines/${created.pipeline}`)).status;
    if (created.source) out.cleanup.sourceDelete = (await api("DELETE", `/api/data-sources/${created.source}`)).status;
    const pl = await api("GET", "/api/pipelines"); const dl = await api("GET", "/api/data-sources");
    const arr = (j) => Array.isArray(j) ? j : j.items || [];
    out.cleanup.pipelineStillListed = arr(pl.json).some((p) => p.id === created.pipeline);
    out.cleanup.sourceStillListed = arr(dl.json).some((p) => p.id === created.source);
  }
  console.log(JSON.stringify(out, null, 2));
})();
