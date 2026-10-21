import type { CDPSession, Page } from "@playwright/test";

// HEL-1691: where does the time of one draft edit go? CDP `Performance.getMetrics` deltas around each edit (cumulative renderer
// main-thread `ThreadTime`, `TaskDuration`, `ScriptDuration`, layout and style), logged as one line per edit plus one JSON line.
// The deltas include the CDP round trip's own work (median ~8 ms locally, ~21 ms on a CI runner), so they are an upper bound on
// the edit's main-thread work; wall time minus thread time shows whether the thread was busy or not scheduled.

const METRIC_KEYS = [
  "ThreadTime",
  "TaskDuration",
  "ScriptDuration",
  "LayoutDuration",
  "RecalcStyleDuration",
  "V8CompileDuration",
] as const;

type Metrics = Partial<Record<(typeof METRIC_KEYS)[number], number>>;

interface EditRow {
  edit: number;
  wallMs: number;
  /** Deltas in ms of the cumulative CDP metrics across the edit. */
  d1: Record<string, number>;
}

async function readMetrics(cdp: CDPSession): Promise<Metrics> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const out: Metrics = {};
  for (const m of metrics) {
    if ((METRIC_KEYS as readonly string[]).includes(m.name)) out[m.name as keyof Metrics] = m.value;
  }
  return out;
}

export interface Breakdown {
  /** Runs one timed edit and records the metric deltas around it; returns the edit's own wall time. */
  measure(edit: number, run: () => Promise<number>): Promise<number>;
  /** Logs one line per edit and one JSON line. */
  log(): void;
}

export async function startBreakdown(page: Page): Promise<Breakdown> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const rows: EditRow[] = [];
  return {
    async measure(edit, run) {
      const before = await readMetrics(cdp);
      const wallMs = await run();
      const after = await readMetrics(cdp);
      const d1: Record<string, number> = {};
      for (const key of METRIC_KEYS) {
        const a = after[key];
        const b = before[key];
        if (a !== undefined && b !== undefined) d1[key] = (a - b) * 1000;
      }
      rows.push({ edit, wallMs, d1 });
      return wallMs;
    },
    log() {
      const f = (n: number | undefined) => (n === undefined ? "n/a" : n.toFixed(1));
      for (const r of rows) {
        const d = r.d1;
        console.log(
          `[HEL-1691 breakdown] edit ${r.edit}: wall ${f(r.wallMs)} | thread ${f(d.ThreadTime)} task ${f(d.TaskDuration)} ` +
            `script ${f(d.ScriptDuration)} layout ${f(d.LayoutDuration)} style ${f(d.RecalcStyleDuration)} compile ${f(d.V8CompileDuration)}`,
        );
      }
      console.log(`[HEL-1691 json] ${JSON.stringify({ rows })}`);
    },
  };
}
