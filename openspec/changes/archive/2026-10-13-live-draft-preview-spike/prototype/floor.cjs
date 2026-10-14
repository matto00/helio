// THROWAWAY (HEL-1580 owner ruling A). Where does the ~36 ms per-request floor come from? Times three GETs on this worktree's backend.
// Usage: HELIO_DEV_EMAIL=... HELIO_DEV_PASSWORD=... BACKEND_PORT=9919 nice -n 19 node floor.cjs
const BASE = `http://localhost:${process.env.BACKEND_PORT || 9919}`;
const H = { "X-Helio-Requested-With": "1", "Content-Type": "application/json" };
const stats = (a) => { const s = a.slice().sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, median: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), min: +s[0].toFixed(1) }; };
(async () => {
  const login = await fetch(BASE + "/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ email: process.env.HELIO_DEV_EMAIL, password: process.env.HELIO_DEV_PASSWORD }) });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const time = async (path, n, withCookie) => { const ts = []; for (let i = 0; i < n; i++) { const t = performance.now(); const r = await fetch(BASE + path, { headers: withCookie === "bogus" ? { cookie: "helio_session=not-a-real-token" } : withCookie ? { cookie } : {} }); await r.text(); ts.push(performance.now() - t); } return stats(ts); };
  const out = { note: "local loopback, plain HTTP/1.1 keep-alive, node fetch (undici)" };
  await time("/health", 10, false);
  out.health_noAuth = await time("/health", 60, false);
  out.api_noCookie_401_noDb = await time("/api/pipelines", 60, false);
  out.api_bogusCookie_401_oneSessionMiss = await time("/api/pipelines", 60, "bogus");
  out.authMe_session = await time("/api/auth/me", 60, true);
  out.listPipelines_session = await time("/api/pipelines", 60, true);
  console.log(JSON.stringify(out, null, 2));
})();
