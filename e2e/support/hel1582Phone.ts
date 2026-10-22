// Shared fixtures and probes for the HEL-1582 phone pipeline e2e specs (`hel1582-mobile-pipeline.spec.ts` and the
// per-viewport sweep specs `hel1582-sweep-<width>.spec.ts`): the seed (`seedPipeline`), the AC1 fit assertion and the
// two-axis touch-floor sweep (`sweepFloor`). Split out so the heavy sweeps can land on different CI shards.

import { writeFileSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { registerAndLogin } from "./auth";
import { evidencePath } from "./evidencePath";
import { settleTransitions } from "./settleTransitions";

import { bisectHitExtent } from "./touchTargetProbe";

export const CSRF = { "X-Helio-Requested-With": "1" };
export const AUTH = { prefix: "hel1582", displayName: "HEL-1582", domain: "example.test" } as const;
export const THEMES = ["dark", "light"] as const;
export const SIZES = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
] as const;

/** `wide` adds columns so the step preview's "N fields" disclosure renders (it replaces the chip row above 12 fields);
 *  `maximal` is the deliberately widest fixture: long names, an 8-field AI step, a branch lane and several Outputs. */
export async function seedPipeline(
  page: Page,
  manyKinds = false,
  run = true,
  wide = false,
  maximal = false,
): Promise<string> {
  wide = wide || manyKinds || maximal;
  const longTag = maximal
    ? "-with-a-deliberately-very-long-name-that-cannot-fit-on-one-line-at-375"
    : "";
  const extraColumns = wide
    ? Array.from(
        { length: 14 },
        (_, i) =>
          `extra_column_${String(i + 1).padStart(2, "0")}${longTag.slice(0, maximal ? 40 : 0)}`,
      )
    : [];
  const post = async <T>(url: string, data: unknown): Promise<T> => {
    const res = await page.request.post(url, { data, headers: CSRF });
    expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as T;
  };
  const rows = Array.from({ length: 14 }, (_, i) => [
    `2026-09-${String(i + 10).padStart(2, "0")}`,
    i % 5 === 0 ? "failed" : "success",
    260 + i * 7,
    ...extraColumns.map((_c, j) => `v${i}-${j}`),
  ]);
  const source = await post<{ id: string }>("/api/data-sources", {
    name: `hel1582-src-runs${longTag}`,
    type: "static",
    columns: [
      { name: "date", type: "string" },
      { name: "status", type: "string" },
      { name: "duration_s", type: "integer" },
      ...extraColumns.map((name) => ({ name, type: "string" })),
    ],
    rows,
  });
  const pipeline = await post<{ id: string }>("/api/pipelines", {
    name: `hel1582-pipe-runs-trend${longTag}`,
    roots: [{ sourceId: source.id }],
  });
  const step = (type: string, config: unknown) =>
    post<{ id: string }>(`/api/pipelines/${pipeline.id}/steps`, { type, config });
  const filter = await step("filter", {
    combinator: "and",
    conditions: [{ field: "duration_s", operator: ">=", value: "260" }],
  });
  const sort = await step("sort", { sortBy: [{ field: "date", direction: "asc" }] });
  const compute = await step("compute", {
    column: "duration_min",
    expression: "$duration_s / 60",
    type: "float",
  });
  if (manyKinds) {
    // One step per op kind that has a hand-written editor, so the sheet sweep walks every editor's markup.
    const kinds: [string, unknown][] = [
      ["cast", { casts: { duration_s: "float" } }],
      ["rename", { renames: { status: "state" } }],
      ["datebucket", { field: "date", granularity: "month", outputColumn: "month" }],
      ["dedupe", { keys: ["date"], keep: "first" }],
      ["fillnull", { columns: ["duration_min"], strategy: "constant", value: "0" }],
      ["stringops", { operation: "upper", field: "state", outputColumn: "state_up" }],
      [
        "window",
        {
          partitionBy: [],
          orderBy: [{ field: "date", direction: "asc" }],
          function: "row_number",
          outputColumn: "rn",
        },
      ],
      ["select", { fields: ["date", "state", "duration_s", "duration_min", "rn"] }],
      ["limit", { count: 20 }],
      ["assert", { rules: [{ kind: "notNull", field: "date", params: {}, severity: "warn" }] }],
      [
        "aggregate",
        {
          groupBy: [{ name: "state", type: "string" }],
          aggregations: [{ alias: "n", fn: "count", field: "date" }],
        },
      ],
      ["pivot", { index: ["state"], column: "state", values: "n", agg: "sum" }],
      ["unpivot", { idVars: ["state"], valueVars: ["n"], varName: "k", valueName: "v" }],
      ["splittext", { field: "state", mode: "paragraph", headingLevel: 1, indexField: "i" }],
    ];
    // A second source for the union step's "Other source" picker.
    const other = await post<{ id: string }>("/api/data-sources", {
      name: "hel1582-src-other",
      type: "static",
      columns: [
        { name: "date", type: "string" },
        { name: "status", type: "string" },
        { name: "duration_s", type: "integer" },
      ],
      rows: [["2026-09-01", "ok", 1]],
    });
    kinds.push([
      "union",
      { secondaryInput: { kind: "source", dataSourceId: other.id }, mode: "byPosition" },
    ]);
    // The remaining OP_TYPES kinds, so the sheet sweeps cover every editor the server accepts. `analyzewithai` has four
    // output fields so its middle rows have both move buttons enabled.
    const sec = { kind: "source", dataSourceId: other.id };
    kinds.push(
      ["join", { secondaryInput: sec, joinKey: "date", joinType: "inner" }],
      [
        "lookup",
        { secondaryInput: sec, sourceKey: "date", lookupKey: "date", columns: ["status"] },
      ],
      ["upsertsource", { target: { kind: "newSource", name: "hel1582-upsert" }, mode: "append" }],
      ["extractheadings", { field: "state", indexField: "hi", levelField: "hl" }],
      [
        "chunkbytokencount",
        {
          field: "state",
          targetTokenCount: 100,
          encoding: "o200k_base",
          indexField: "ci",
          tokenCountField: "ct",
        },
      ],
      ["convertformat", { field: "state", from: "csv", to: "json", outputField: "cf" }],
      [
        "analyzewithai",
        {
          inputField: "state",
          instruction: "Summarise",
          outputSchema: (maximal
            ? ["a", "b", "c", "d", "e", "f", "g", "h"]
            : ["a", "b", "c", "d"]
          ).map((name) => ({
            name: maximal ? `${name}_a_long_output_field_name_for_wrapping` : name,
            type: "string",
          })),
        },
      ],
      ["generatetext", { inputField: "state", instruction: "Write", outputField: "gt" }],
    );
    const rejected: string[] = [];
    for (const [type, config] of kinds) {
      const res = await page.request.post(`/api/pipelines/${pipeline.id}/steps`, {
        data: { type, config },
        headers: CSRF,
      });
      if (res.status() >= 300)
        rejected.push(`${type}:${res.status()} ${(await res.text()).slice(0, 160)}`);
    }
    // Fail loudly: a kind the server rejects would silently drop out of the every-editor sweeps.
    expect(rejected, "step kinds the server refused to seed").toEqual([]);
  }
  if (maximal) {
    // A branch lane off the compute step, and several Outputs with long names.
    await post(`/api/pipelines/${pipeline.id}/steps`, {
      type: "limit",
      config: { count: 5 },
      parentStepId: compute.id,
      attachAsTail: true,
    });
    for (const [i, nodeStepId] of [filter.id, sort.id].entries()) {
      await post(`/api/pipelines/${pipeline.id}/outputs`, {
        kind: "table",
        name: `extra_output_${i + 1}${longTag}`,
        config: {},
        nodeStepId,
      });
    }
  }
  await post(`/api/pipelines/${pipeline.id}/outputs`, {
    kind: "table",
    name: `runs_trend${longTag}`,
    config: {},
    nodeStepId: compute.id,
  });
  // A never-run pipeline (every newly created one) has no status label: the schedule chip starts the status line.
  if (run) await post(`/api/pipelines/${pipeline.id}/run`, {});
  return pipeline.id;
}

export async function openPipeline(
  page: Page,
  pipelineId: string,
  theme: "dark" | "light" = "dark",
) {
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
  await page.goto(`/pipelines/${pipelineId}`);
  await expect(page.locator(".spine-row").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.evaluate(() => document.fonts.ready);
}

export const sheet = (page: Page) => page.getByRole("dialog", { name: "Step editor" });
export const navTop = (page: Page) =>
  page
    .getByRole("navigation", { name: "Primary" })
    .evaluate((el) => el.getBoundingClientRect().top);

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
export const rectOf = (locator: Locator): Promise<Rect> =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });

// ---- AC1: fit -----------------------------------------------------------------------------------------------

/** The Steps tab at scrollTop 0 shows the source card, every step row and every Output card, fully inside the
 *  scroller and above the floating action bar. Returns the measurements for the evidence file. */
export async function assertFits(page: Page) {
  const body = page.locator(".mobile-body");
  expect(await body.evaluate((el) => el.scrollTop)).toBe(0);
  const scroller = await rectOf(body);
  const barTop = (await rectOf(page.locator(".mobile-actions"))).top;
  const items = {
    source: page.locator(".spine-source-card"),
    rows: page.locator(".spine-row"),
    outputs: page.locator(".spine-output-card"),
  };
  expect(await items.rows.count()).toBe(3);
  expect(await items.outputs.count()).toBe(1);
  const measured: Record<string, Rect> = {};
  const check = async (name: string, locator: Locator) => {
    const r = await rectOf(locator);
    measured[name] = r;
    expect(r.top, `${name} starts inside the scroller`).toBeGreaterThanOrEqual(scroller.top - 0.5);
    expect(r.bottom, `${name} ends inside the scroller`).toBeLessThanOrEqual(scroller.bottom + 0.5);
    expect(r.bottom, `${name} ends above the action bar`).toBeLessThanOrEqual(barTop + 0.5);
  };
  await check("source", items.source);
  for (let i = 0; i < 3; i++) await check(`row${i + 1}`, items.rows.nth(i));
  await check("output", items.outputs.first());
  return { scroller, barTop, ...measured };
}

// ---- AC4 helper -----------------------------------------------------------------------------------------------

/** Asserts every visible interactive element in `scope` has a >=44px hit area on both axes; returns how many it
 *  measured. Failures are collected so one run names every offender. */
export async function sweepFloor(
  page: Page,
  scope: Locator,
  label: string,
  allowEmpty = false,
  sink?: string[],
) {
  const handles = await scope
    .locator(
      "a[href], button, [role=tab], [role=combobox], input:not([type=hidden]), select, textarea, [role=menuitem]",
    )
    .all();
  let measured = 0;
  const failures: string[] = [];
  for (const el of handles) {
    if (!(await el.isVisible())) continue;
    const box = await el.boundingBox();
    if (!box || box.width < 2 || box.height < 2) continue;
    // A checkbox or radio is touched through its label (the native box is 14px): measure the label's hit area.
    const isToggle = await el.evaluate((node) =>
      node.matches("input[type=checkbox], input[type=radio]"),
    );
    if (isToggle) {
      const labelBox = el.locator("xpath=ancestor::label[1]");
      if ((await labelBox.count()) === 0) {
        failures.push(`${label}: a bare checkbox/radio has no label to touch`);
        continue;
      }
      await labelBox.evaluate((n) => n.scrollIntoView({ block: "center" }));
      for (const axis of ["x", "y"] as const) {
        try {
          await bisectHitExtent(page, labelBox, axis);
        } catch (err) {
          failures.push(
            `${label}: checkbox label ${axis}: ${(err as Error).message.split("\n")[0]}`,
          );
        }
      }
      measured += 1;
      continue;
    }
    // Centre it in its scroller: a 44px expander at the very edge of a scroll viewport is cut by the viewport, which
    // is scrolling, not a tap-target defect.
    await el.evaluate((n) => n.scrollIntoView({ block: "center" }));
    const name =
      (await el.getAttribute("aria-label")) ?? ((await el.textContent()) ?? "").trim().slice(0, 28);
    // C8: the real tap area, by elementFromPoint bisection on both axes, for every control (selects, inputs and
    // labels included): a painted box is not a hit area when a neighbour's expander overlaps it.
    for (const axis of ["x", "y"] as const) {
      try {
        await bisectHitExtent(page, el, axis);
      } catch (err) {
        failures.push(`${label}: "${name}" ${axis}: ${(err as Error).message.split("\n")[0]}`);
      }
    }
    measured += 1;
  }
  if (!allowEmpty) {
    expect(measured, `${label}: the sweep measured controls`).toBeGreaterThan(0);
  }
  if (sink) sink.push(...failures);
  else expect(failures, failures.join("\n")).toEqual([]);
  return measured;
}

type Viewport = (typeof SIZES)[number];

/** Registers the two heavy sweeps (the every-step-kind C8 hit-area sweep and the MAXIMAL sweep) for one viewport. Each
 *  `hel1582-sweep-<width>.spec.ts` calls it with its own size so CI's file-level sharding can place them apart. */
export function registerHeavySweeps(size: Viewport) {
  test.use({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  test.describe("HEL-1582 phone pipeline page (live)", () => {
    {
      test(`AC4 (C8): every step kind's editor in the sheet clears the 44px touch floor by real hit area at ${size.width}x${size.height}`, async ({
        page,
        request,
      }) => {
        test.setTimeout(480_000);
        await page.setViewportSize(size);
        await registerAndLogin(page, request, { ...AUTH, label: `touch-kinds${size.width}` });
        const pipelineId = await seedPipeline(page, true);
        await openPipeline(page, pipelineId);
        const rows = page.locator(".spine-row__select");
        const count = await rows.count();
        expect(count).toBeGreaterThanOrEqual(10);
        const counts: Record<string, number> = {};
        const allFailures: string[] = [];
        for (let i = 0; i < count; i++) {
          const label =
            (await rows.nth(i).locator(".spine-row__title").textContent()) ?? `row ${i}`;
          await rows.nth(i).scrollIntoViewIfNeeded();
          await rows.nth(i).tap();
          await expect(sheet(page)).toBeVisible();
          await sheet(page).evaluate((el) =>
            Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))),
          );
          await settleTransitions(page);
          counts[`${i + 1} ${label}`] = await sweepFloor(
            page,
            sheet(page),
            `sheet ${label}`,
            false,
            allFailures,
          );
          await sheet(page).getByRole("button", { name: "Close" }).tap();
          await expect(sheet(page)).toBeHidden();
        }
        writeFileSync(
          evidencePath("HEL-1582", `touch-floor-sheet-kinds-${size.width}x${size.height}.json`),
          JSON.stringify(counts, null, 2),
        );
        expect(allFailures, allFailures.join("\n")).toEqual([]);
      });
    }

    {
      test(`MAXIMAL sweep (C8, both axes): header, every tab, every menu and every step kind's editor and preview on the widest fixture at ${size.width}x${size.height}`, async ({
        page,
        request,
      }) => {
        // Owner ruling (HEL-1582): the 390 and 768 maximal sweeps run only in the slow lane (HELIO_E2E_SLOW=1), because
        // each takes about 3 minutes and would crowd CI's 25-minute e2e leg timeout. The 375 maximal sweep and every
        // every-kind C8 sweep stay in PR CI. The slow lane is .github/workflows/e2e-slow.yml (weekly + workflow_dispatch).
        test.skip(
          size.width !== 375 && process.env.HELIO_E2E_SLOW !== "1",
          "slow lane only (HELIO_E2E_SLOW=1): runs in .github/workflows/e2e-slow.yml (weekly + dispatch); owner ruling",
        );
        test.setTimeout(1_500_000);
        await page.setViewportSize(size);
        await registerAndLogin(page, request, { ...AUTH, label: `maximal${size.width}` });
        const pipelineId = await seedPipeline(page, true, true, true, true);
        const failures: string[] = [];
        const counts: Record<string, number> = {};
        // Partial last run with an 8-digit count, a paused cron schedule and a failed run with a long error.
        await page.route(new RegExp(`/api/pipelines/${pipelineId}$`), async (route) => {
          if (route.request().method() !== "GET") return route.continue();
          const response = await route.fetch();
          const body = (await response.json()) as Record<string, unknown>;
          Object.assign(body, {
            lastRunAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
            lastRunRowCount: 12_345_678,
            lastRunTruncated: true,
          });
          return route.fulfill({ response, json: body });
        });
        await page.route(new RegExp(`/api/pipelines/${pipelineId}/schedule$`), async (route) => {
          if (route.request().method() !== "GET") return route.continue();
          return route.fulfill({
            json: {
              id: "sch-max",
              pipelineId,
              kind: "cron",
              expression: "0 6 * * 1-5",
              enabled: false,
              timezone: "UTC",
              nextRunAt: null,
              lastRunAt: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          });
        });
        await page.route("**/api/pipelines/*/run-history", async (route) => {
          const real = await route.fetch();
          const runs = (await real.json()) as unknown[];
          await route.fulfill({
            response: real,
            json: [
              {
                id: "hel1582-failed-run",
                pipelineId,
                status: "failed",
                startedAt: "2026-05-01T11:00:00Z",
                completedAt: "2026-05-01T11:00:05Z",
                rowCount: null,
                errorLog: "out of memory error while reading the very large source ".repeat(6),
                triggerSource: "scheduled",
                assertions: { passed: 0, warnFailed: 0, errorFailed: 0, failures: [] },
              },
              ...runs,
            ],
          });
        });

        for (const theme of THEMES) {
          await page.waitForTimeout(8_000);
          await openPipeline(page, pipelineId, theme);
          const at = (surface: string) => `${theme} ${surface}`;
          const sweep = async (scope: Locator, name: string) => {
            counts[at(name)] = await sweepFloor(page, scope, at(name), true, failures);
          };
          const noOverflow = async (name: string) => {
            const over = await page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            if (over > 0) failures.push(`${at(name)}: horizontal overflow ${over}px`);
          };

          await sweep(page.locator(".mobile-header"), "header");
          await sweep(page.locator(".mobile-tabs"), "tabs");
          await sweep(page.locator(".mobile-body"), "steps");
          await sweep(page.locator(".mobile-actions"), "pills");
          await noOverflow("steps");

          // Every menu on the Steps tab: pipeline actions, the source card's and an Output card's.
          const menus: [string, Locator][] = [
            ["pipeline actions menu", page.getByRole("button", { name: "Pipeline actions" })],
            [
              "source actions menu",
              page.getByRole("button", { name: /^Source actions for/ }).first(),
            ],
            [
              "output card menu",
              page.locator(".spine-output-card button[aria-haspopup=menu]").first(),
            ],
          ];
          for (const [name, trigger] of menus) {
            if ((await trigger.count()) === 0) {
              failures.push(`${at(name)}: trigger not found`);
              continue;
            }
            await trigger.scrollIntoViewIfNeeded();
            await trigger.tap();
            await sweep(page.locator("[role=menu]"), name);
            await page.keyboard.press("Escape");
          }

          // Preview: the step chooser, its listbox and the schema disclosure.
          await page.getByRole("tab", { name: "Preview" }).tap();
          await expect(page.getByRole("region", { name: /^Rows after step/ })).toBeVisible();
          await sweep(page.locator(".mobile-body"), "preview");
          const chooser = page.locator(".mobile-body .ui-select__trigger").first();
          await chooser.tap();
          await sweep(page.getByRole("listbox"), "preview chooser listbox");
          await page.keyboard.press("Escape");
          const disclosure = page.locator(".output-schema-disclosure__trigger").first();
          if ((await disclosure.count()) > 0) {
            await disclosure.tap();
            // The popover's entrance must finish before its geometry is measured.
            await page.waitForFunction(() =>
              document.getAnimations().every((x) => x.playState !== "running"),
            );
            await settleTransitions(page);
            await sweep(
              page.locator("[role=dialog]:not(dialog)").last(),
              "schema disclosure panel",
            );
            await page.keyboard.press("Escape");
          }
          await noOverflow("preview");

          // Runs, with the failed run's log expanded.
          await page.getByRole("tab", { name: "Runs" }).tap();
          await expect(page.locator(".run-history-modal__row").first()).toBeVisible();
          await sweep(page.locator(".mobile-body"), "runs");
          const showLog = page.getByRole("button", { name: "Show log" }).first();
          if ((await showLog.count()) > 0) {
            await showLog.tap();
            await sweep(page.locator(".mobile-body"), "runs (log expanded)");
          }
          await noOverflow("runs");

          // Every step kind's editor and preview in the open sheet.
          await page.getByRole("tab", { name: "Steps" }).tap();
          const rows = page.locator(".spine-row__select");
          const count = await rows.count();
          for (let i = 0; i < count; i++) {
            const label =
              (await rows.nth(i).locator(".spine-row__title").textContent()) ?? `row ${i}`;
            await rows.nth(i).scrollIntoViewIfNeeded();
            await rows.nth(i).tap();
            await expect(sheet(page)).toBeVisible();
            await sheet(page).evaluate((el) =>
              Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))),
            );
            await settleTransitions(page);
            await sweep(sheet(page), `sheet ${i + 1} ${label}`);
            await noOverflow(`sheet ${label}`);
            // The "N fields" panel opened inside the sheet: above the dialog and fully on screen.
            const inSheetTrigger = sheet(page)
              .locator(".output-schema-disclosure__trigger")
              .first();
            if (i === 0 && (await inSheetTrigger.count()) > 0) {
              await inSheetTrigger.tap();
              await page.waitForFunction(() =>
                document.getAnimations().every((x) => x.playState !== "running"),
              );
              await settleTransitions(page);
              const panel = page.getByRole("dialog", { name: "Output schema" });
              const onScreen = await panel.evaluate((el) => {
                const r = el.getBoundingClientRect();
                const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                return {
                  inside:
                    r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
                  centreInPanel: hit !== null && el.contains(hit),
                };
              });
              if (!onScreen.inside)
                failures.push(at("sheet disclosure panel: outside the viewport"));
              if (!onScreen.centreInPanel)
                failures.push(
                  at("sheet disclosure panel: behind the sheet (centre misses the panel)"),
                );
              await sweep(panel, "sheet disclosure panel");
              // Dismissed through its scrim: Escape would also close the sheet behind it.
              await page.locator(".popover__scrim").tap({ position: { x: 3, y: 3 } });
              await expect(panel).toBeHidden();
              await expect(sheet(page)).toBeVisible();
            }
            await sheet(page).getByRole("button", { name: "Close" }).tap();
            await expect(sheet(page)).toBeHidden();
          }
          counts[at("step rows")] = count;
        }
        writeFileSync(
          evidencePath("HEL-1582", `maximal-sweep-${size.width}x${size.height}.json`),
          JSON.stringify({ counts, failures }, null, 2),
        );
        expect(failures, failures.join("\n")).toEqual([]);
      });
    }
  });
}
