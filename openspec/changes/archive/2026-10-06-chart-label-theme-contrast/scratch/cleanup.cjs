const { request } = require("/home/matt/Development/helio/node_modules/@playwright/test");
const fs = require("fs");
const H = { "X-Helio-Requested-With": "1" };
(async () => {
  const ids = JSON.parse(fs.readFileSync("ids.json"));
  const api = await request.newContext({ baseURL: "http://localhost:6695", storageState: "state.json" });
  const del = async (u) => { const r = await api.delete(u, { headers: H }); console.log("DELETE", u, r.status()); };
  for (const id of Object.values(ids.panels)) await del(`/api/panels/${id}`);
  await del(`/api/dashboards/${ids.dashboard}`);
  await del(`/api/outputs/${ids.output}`);
  await del(`/api/pipelines/${ids.pipeline}`);
  await del(`/api/data-sources/${ids.source}`);
  for (const [u, k] of [["/api/dashboards", ids.dashboard], ["/api/outputs", ids.output], ["/api/pipelines", ids.pipeline], ["/api/data-sources", ids.source]]) {
    const r = await api.get(u); const b = await r.json(); const arr = Array.isArray(b) ? b : b.items ?? [];
    console.log("re-query", u, r.status(), "still-present:", arr.some((x) => x.id === k));
  }
  await api.dispose();
})();
