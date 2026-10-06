const { request } = require("/home/matt/Development/helio/node_modules/@playwright/test");
const fs = require("fs");
const H = { "X-Helio-Requested-With": "1" };
(async () => {
  const api = await request.newContext({ baseURL: "http://localhost:6695" });
  const email = `hel1263-measure-${Date.now()}@example.test`;
  const password = "correcthorsebattery1";
  const ok = async (res, s) => { if (res.status() !== s) throw new Error(`${res.url()} ${res.status()} ${await res.text()}`); return res.json(); };
  const reg = await ok(await api.post("/api/auth/register", { data: { email, password, displayName: "HEL-1263 measure" }, headers: H }), 201);
  await ok(await api.post("/api/auth/login", { data: { email, password }, headers: H }), 200).catch(()=>{});
  const me = await ok(await api.get("/api/auth/me"), 200);
  const ids = { user: me.id, email, password };
  const dash = await ok(await api.post("/api/dashboards", { data: { name: "HEL-1263 measure" }, headers: H }), 201);
  ids.dashboard = dash.id;
  const src = await ok(await api.post("/api/data-sources", { headers: H, data: { name: "HEL-1263 src", type: "static",
    columns: [{ name: "region", type: "string", required: true }, { name: "revenue", type: "integer", required: true }],
    rows: [["East",100],["West",150],["North",90],["South",120],["Central",60]] } }), 201);
  ids.source = src.id;
  const pl = await ok(await api.post("/api/pipelines", { headers: H, data: { name: "HEL-1263 pl", roots: [{ sourceId: src.id }] } }), 201);
  ids.pipeline = pl.id;
  const out = await ok(await api.post(`/api/pipelines/${pl.id}/outputs`, { headers: H, data: { kind: "chart", name: "HEL-1263 out", config: { chartType: "line", fieldMapping: { xAxis: "region", yAxis: "revenue" } } } }), 201);
  ids.output = out.id;
  await ok(await api.post(`/api/pipelines/${pl.id}/run`, { headers: H }), 200);
  ids.panels = {};
  const kinds = [["line",null],["bar",null],["scatter",null],["pie",null],["tinted-line","#ffd700"]];
  for (const [k, bg] of kinds) {
    const p = await ok(await api.post("/api/panels", { headers: H, data: { dashboardId: dash.id, title: `HEL-1263 ${k}`, type: "output", config: { outputId: out.id } } }), 201);
    ids.panels[k] = p.id;
    const ct = k.replace("tinted-","");
    await ok(await api.patch(`/api/panels/${p.id}`, { headers: H, data: { appearance: { background: bg ?? "transparent", color: "inherit", transparency: 0,
      chart: { seriesColors: [], legend: { show: true, position: "top" }, tooltip: { enabled: true }, axisLabels: { x: { show: true, label: "Region" }, y: { show: true, label: "Revenue" } }, chartType: ct } } } }), 200);
  }
  await ok(await api.post(`/api/dashboards/${dash.id}/auto-layout`, { headers: H, data: { items: Object.values(ids.panels).map((id) => ({ panelId: id, w: 6, h: 5 })) } }), 200);
  fs.writeFileSync("ids.json", JSON.stringify(ids, null, 2));
  await api.storageState({ path: "state.json" });
  console.log(JSON.stringify(ids));
  await api.dispose();
})().catch((e) => { console.error(e); process.exit(1); });
