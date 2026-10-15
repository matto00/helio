import { expect, test, type Page } from "@playwright/test";

import { auditAccent } from "./support/accentAudit";
import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";

// HEL-1579 (design.md D11): the desktop pipeline page as a step spine, focused editor and preview table,
// proven against the running app. Seeds a 3-step pipeline over HTTP (user cleanup is the global teardown's,
// HEL-1301), runs it so the per-step counts are persisted, then checks the layout, selection, lanes and the
// accent discipline in both themes and two accent presets.

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1579", displayName: "HEL-1579", domain: "example.test" } as const;

interface Seeded {
  pipelineId: string;
  stepIds: string[];
}

async function seedPipeline(page: Page, withBranch = false, manyKinds = false): Promise<Seeded> {
  const post = async <T>(url: string, data: unknown): Promise<T> => {
    const res = await page.request.post(url, { data, headers: CSRF });
    expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as T;
  };
  const rows = Array.from({ length: 14 }, (_, i) => [
    `2026-09-${String(i + 10).padStart(2, "0")}`,
    i % 5 === 0 ? "failed" : "success",
    260 + i * 7,
  ]);
  const source = await post<{ id: string }>("/api/data-sources", {
    name: "newshist-src-runs",
    type: "static",
    columns: [
      { name: "date", type: "string" },
      { name: "status", type: "string" },
      { name: "duration_s", type: "integer" },
    ],
    rows,
  });
  const pipeline = await post<{ id: string }>("/api/pipelines", {
    name: "newshist-pipe-runs-trend",
    roots: [{ sourceId: source.id }],
  });
  const step = (type: string, config: unknown, extra: object = {}) =>
    post<{ id: string }>(`/api/pipelines/${pipeline.id}/steps`, { type, config, ...extra });
  const filter = await step("filter", {
    combinator: "and",
    conditions: [{ field: "duration_s", operator: ">=", value: "260" }],
  });
  const sort = await step("sort", { sortBy: [{ field: "date", direction: "asc" }] });
  const compute = await step("compute", {
    column: "duration_min",
    expression: "duration_s / 60",
    type: "float",
  });
  const stepIds = [filter.id, sort.id, compute.id];
  if (manyKinds) {
    // One step per op kind that has a hand-written editor, so the audit walks every editor's markup.
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
    for (const [type, config] of kinds) {
      try {
        const res = await page.request.post(`/api/pipelines/${pipeline.id}/steps`, {
          data: { type, config },
          headers: CSRF,
        });
        if (res.status() < 300) stepIds.push(((await res.json()) as { id: string }).id);
        else console.log(`[HEL-1579 e2e] seed skipped ${type}: ${res.status()}`);
      } catch (err) {
        console.log(`[HEL-1579 e2e] seed skipped ${type}: ${String(err)}`);
      }
    }
  }
  if (withBranch) {
    const branch = await step("limit", { count: 3 }, { parentStepId: sort.id, attachAsTail: true });
    stepIds.push(branch.id);
  }
  await post(`/api/pipelines/${pipeline.id}/outputs`, {
    kind: "table",
    name: "runs_trend",
    config: {},
    nodeStepId: compute.id,
  });
  await post(`/api/pipelines/${pipeline.id}/run`, {});
  return { pipelineId: pipeline.id, stepIds };
}

test.describe("HEL-1579 pipeline detail step spine (live)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("1280x800: spine, editor and at least 8 preview rows fit without page scroll", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "fit" });
    const { pipelineId } = await seedPipeline(page);
    await page.goto(`/pipelines/${pipelineId}`);

    const spine = page.getByLabel("Steps and outputs");
    await expect(spine.getByRole("button", { name: /^Step 1:/ })).toBeVisible();
    await expect(page.getByRole("region", { name: /^Rows after step/ })).toBeVisible();
    await expect(page.locator(".step-preview__body tbody tr").first()).toBeVisible();

    const viewport = page.viewportSize()!;
    const metrics = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    }));
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.innerHeight);

    for (const locator of [spine, page.getByRole("region", { name: /^Step 1 / })]) {
      const box = (await locator.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    const rows = page.locator(".step-preview__body tbody tr");
    expect(await rows.count()).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < 8; i++) {
      const box = (await rows.nth(i).boundingBox())!;
      expect(box.y + box.height, `preview row ${i} inside the viewport`).toBeLessThanOrEqual(
        viewport.height,
      );
    }
    await page.screenshot({ path: evidencePath("HEL-1579", "spine-1280x800-dark.png") });
  });

  test("1440x900 (HEL-1585 check for this page): the document does not scroll", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await registerAndLogin(page, request, { ...AUTH, label: "fit1440" });
    const { pipelineId } = await seedPipeline(page);
    await page.goto(`/pipelines/${pipelineId}`);
    await expect(page.getByRole("region", { name: /^Rows after step/ })).toBeVisible();
    const metrics = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
    }));
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.innerHeight);
    expect(metrics.scrollY).toBe(0);
    await page.screenshot({ path: evidencePath("HEL-1579", "spine-1440x900-dark.png") });
  });

  test("accent audit: only Run, the selected step and focus use the accent (every kind, both themes, two presets)", async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await registerAndLogin(page, request, { ...AUTH, label: "accent" });
    const { pipelineId } = await seedPipeline(page, true, true);
    for (const theme of ["dark", "light"] as const) {
      for (const accent of ["#ec4899", "#3b82f6"]) {
        await page.evaluate(
          ([t, a]) => {
            window.localStorage.setItem("helio-theme", t);
            window.localStorage.setItem("helio-accent", a);
          },
          [theme, accent],
        );
        await page.goto(`/pipelines/${pipelineId}`);
        await expect(page.getByRole("region", { name: /^Rows after step/ })).toBeVisible();
        const rows = page.locator(".spine-row__select");
        const count = await rows.count();
        expect(count).toBeGreaterThanOrEqual(10);
        const leaks: string[] = [];
        for (let i = 0; i < count; i++) {
          await rows.nth(i).click();
          await expect(rows.nth(i)).toHaveAttribute("aria-current", "true");
          await page.waitForTimeout(150);
          const hits = await auditAccent(page, accent);
          const name = await rows.nth(i).getAttribute("aria-label");
          for (const h of hits)
            leaks.push(`[${theme} ${accent}] ${name}: ${h.selector} ${h.property} ${h.value}`);
        }
        // The keyboard-focused control's ring is allowed; everything else on the page is not.
        await page.keyboard.press("Tab");
        for (const h of await auditAccent(page, accent))
          leaks.push(`[${theme} ${accent}] (tab focus): ${h.selector} ${h.property} ${h.value}`);
        expect(leaks, leaks.join("\n")).toEqual([]);
      }
    }
  });

  test("820/900/1100px: the header keeps one row and the page does not scroll (screenshots, both themes)", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "narrow" });
    const { pipelineId } = await seedPipeline(page);
    // A PAUSED schedule: its state must stay visible at every width (never dropped from the header).
    const put = await page.request.put(`/api/pipelines/${pipelineId}/schedule`, {
      data: { kind: "interval", expression: "15m", timezone: "UTC", enabled: false },
      headers: CSRF,
    });
    expect(put.status()).toBeLessThan(300);
    for (const theme of ["dark", "light"] as const)
      for (const width of [820, 900, 1100, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
        await page.goto(`/pipelines/${pipelineId}`);
        await expect(page.getByRole("region", { name: /^Rows after step/ })).toBeVisible();
        // Narrow desktop stays usable: each filter control is wide enough to show its value, and the page name
        // (which the command bar no longer shows) keeps at least about 8 characters.
        const row = page.locator(".pipeline-detail-page__filter-condition-row");
        await expect(row).toBeVisible();
        const fieldBox = (await row.locator("> *").nth(0).boundingBox())!;
        const valueBox = (await row.locator("input").last().boundingBox())!;
        expect(fieldBox.width).toBeGreaterThanOrEqual(120);
        expect(valueBox.width).toBeGreaterThanOrEqual(120);
        const nameText = await page.locator(".spine-header__name").evaluate((el) => ({
          visible: el.clientWidth,
          full: el.scrollWidth,
          text: el.textContent ?? "",
        }));
        expect(
          nameText.visible,
          `name "${nameText.text}" must stay readable`,
        ).toBeGreaterThanOrEqual(Math.min(nameText.full, 110));
        const chip = page.getByRole("button", { name: "Edit schedule" });
        await expect(chip).toBeVisible();
        await expect(chip).toContainText("Paused");
        await expect(chip).toHaveAttribute("title", /paused/);
        const chipBox = (await chip.boundingBox())!;
        expect(chipBox.x + chipBox.width, "schedule chip inside the viewport").toBeLessThanOrEqual(
          width,
        );
        // No header item may overlap the next (the pipeline name once ran under the status chip at 820px).
        await page.evaluate(() => document.fonts.ready);
        const boxes = await page.evaluate(() =>
          Array.from(
            document.querySelectorAll<HTMLElement>(
              ".spine-header__name, .spine-header__run-status, .spine-header__chip, .spine-header .ui-status-chip, .spine-header__meta, .spine-header__btn, .spine-header .popover__trigger",
            ),
          )
            .filter((el) => el.getClientRects().length > 0 && el.offsetWidth > 0)
            .map((el) => ({
              cls: el.className.toString().split(" ")[0],
              ...el.getBoundingClientRect().toJSON(),
            }))
            .sort((a, b) => a.x - b.x),
        );
        for (let i = 1; i < boxes.length; i++) {
          const prev = boxes[i - 1];
          expect(
            prev.right,
            `${width}px ${theme}: "${prev.cls}" (right ${prev.right}) overlaps "${boxes[i].cls}" (left ${boxes[i].x})`,
          ).toBeLessThanOrEqual(boxes[i].x + 0.5);
        }
        const header = page.locator(".spine-header");
        const box = (await header.boundingBox())!;
        // One row: the controls never wrap below the name (a wrapped header would be taller than one control row).
        expect(box.height).toBeLessThan(60);
        const metrics = await page.evaluate(() => ({
          sh: document.documentElement.scrollHeight,
          ih: window.innerHeight,
          sw: document.documentElement.scrollWidth,
          iw: window.innerWidth,
        }));
        expect(metrics.sh).toBeLessThanOrEqual(metrics.ih);
        expect(metrics.sw).toBeLessThanOrEqual(metrics.iw);
        await page.screenshot({
          path: evidencePath("HEL-1579", `spine-${width}x900-${theme}.png`),
        });
      }
  });

  test("selecting a step updates the focused editor heading and the preview header", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "select" });
    const { pipelineId } = await seedPipeline(page);
    await page.goto(`/pipelines/${pipelineId}`);
    await expect(page.getByRole("region", { name: "Step 1 Filter rows" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Rows after step 1" })).toBeVisible();

    await page.getByRole("button", { name: /^Step 2: Sort rows/ }).click();
    await expect(page.getByRole("region", { name: "Step 2 Sort rows" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Rows after step 2" })).toBeVisible();
    await expect(page).toHaveURL(/[?&]step=/);

    // The per-step counts persisted by the seed's run are shown on a fresh load (no in-session run).
    await page.reload();
    await expect(
      page.getByRole("button", { name: /^Step 3: Compute column, \d+ rows/ }),
    ).toBeVisible();
  });

  test("a branch renders as a labelled sub-spine and a lane row is selectable", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "lanes" });
    const { pipelineId } = await seedPipeline(page, true);
    await page.goto(`/pipelines/${pipelineId}`);
    const lane = page.getByRole("group", { name: "Lane" });
    await expect(lane).toBeVisible();
    await expect(lane.getByText(/^Lane 1 · from 2 Sort rows/)).toBeVisible();
    // Indented: the lane's rows start to the right of the trunk rows.
    const trunk = (await page.getByRole("button", { name: /^Step 2: Sort rows/ }).boundingBox())!;
    const branch = (await lane.getByRole("button", { name: /^Step 1: Limit rows/ }).boundingBox())!;
    expect(branch.x).toBeGreaterThan(trunk.x);
    await lane.getByRole("button", { name: /^Step 1: Limit rows/ }).click();
    await expect(page.getByRole("region", { name: "Step 1 Limit rows" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Rows after step 1" })).toBeVisible();
  });

  test("an edit made just before selecting another step is saved (no edit is lost)", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "flush" });
    const { pipelineId, stepIds } = await seedPipeline(page);
    await page.goto(`/pipelines/${pipelineId}`);
    const patched = page.waitForRequest(
      (req) => req.url().includes(`/api/pipeline-steps/${stepIds[0]}`) && req.method() === "PATCH",
    );
    await page.locator(".pipeline-detail-page__filter-condition-row input").last().fill("270");
    await page.getByRole("button", { name: /^Step 2: Sort rows/ }).click();
    const req = await patched;
    expect(req.postData()).toContain("270");
  });

  test("evidence: the running page at 1440, 1280 and 820 wide, in both themes", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await registerAndLogin(page, request, { ...AUTH, label: "evidence" });
    const { pipelineId } = await seedPipeline(page, true);
    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
      for (const [width, height] of [
        [1440, 900],
        [1280, 800],
        [820, 900],
      ] as const) {
        await page.setViewportSize({ width, height });
        await page.goto(`/pipelines/${pipelineId}`);
        await expect(page.getByRole("region", { name: /^Rows after step/ })).toBeVisible();
        await expect(page.locator(".step-preview__body tbody tr").first()).toBeVisible();
        const noScroll = await page.evaluate(
          () => document.documentElement.scrollHeight <= window.innerHeight,
        );
        expect(noScroll, `${width}x${height} ${theme}: the document must not scroll`).toBe(true);
        await page.screenshot({
          path: evidencePath("HEL-1579", `spine-${width}x${height}-${theme}.png`),
        });
      }
    }
  });

  // Every desktop width from 769 to 1100px, with the context list at its default (248px) and at its max (400px):
  // nothing in the header overflows or is clipped, Run and the actions menu stay inside the viewport, the editor's
  // action row stays inside the centre column and the document never scrolls. One page load per theme and list
  // width; the viewport is resized in a loop (8px steps plus 1100).
  test("sweep 769-1100px: header and editor actions fit, both themes, list at default and max width", async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await registerAndLogin(page, request, { ...AUTH, label: "sweep" });
    const { pipelineId } = await seedPipeline(page);
    const put = await page.request.put(`/api/pipelines/${pipelineId}/schedule`, {
      data: { kind: "interval", expression: "15m", timezone: "UTC", enabled: false },
      headers: CSRF,
    });
    expect(put.status()).toBeLessThan(300);
    const widths = [...Array.from({ length: 42 }, (_, i) => 769 + i * 8), 1100];
    const sampled = new Set([769, 825, 897, 1100]);
    for (const listWidth of ["default", "max"] as const) {
      for (const theme of ["dark", "light"] as const) {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
        await page.goto(`/pipelines/${pipelineId}`);
        await expect(page.getByRole("region", { name: /^Rows after step/ })).toBeVisible();
        if (listWidth === "max") {
          const handle = page.getByRole("separator").first();
          await handle.focus();
          await page.keyboard.press("End");
        }
        await page.evaluate(() => document.fonts.ready);
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          const m = await page.evaluate(() => {
            const vw = window.innerWidth;
            const header = document.querySelector<HTMLElement>(".spine-header")!;
            const items = Array.from(
              header.querySelectorAll<HTMLElement>(
                ".spine-header__name, .ui-status-chip, .spine-header__run-status, .spine-header__meta, .spine-header__chip, .spine-header__btn, .popover__trigger",
              ),
            )
              .filter((el) => el.offsetWidth > 0)
              .map((el) => ({
                cls: el.className.toString().split(" ")[0],
                ...el.getBoundingClientRect().toJSON(),
              }))
              .sort((a, b) => a.x - b.x);
            const main = document.querySelector(".spine-body__main")!.getBoundingClientRect();
            const actions = Array.from(
              document.querySelectorAll<HTMLElement>(".step-focused__actions button"),
            ).map((el) => el.getBoundingClientRect().right);
            const doc = document.documentElement;
            return {
              vw,
              headerOverflow: header.scrollWidth - header.clientWidth,
              items,
              mainRight: main.right,
              actionRights: actions,
              docH: doc.scrollHeight - window.innerHeight,
              docW: doc.scrollWidth - vw,
            };
          });
          const at = `${width}px ${theme} list=${listWidth}`;
          expect(
            m.headerOverflow,
            `${at}: header scrollWidth must not exceed clientWidth (over by ${m.headerOverflow}px; items ${m.items.map((i) => `${i.cls}:${Math.round(i.width)}`).join(" ")})`,
          ).toBeLessThanOrEqual(0);
          for (let i = 0; i < m.items.length; i++) {
            expect(
              m.items[i].right,
              `${at}: "${m.items[i].cls}" right edge inside the viewport`,
            ).toBeLessThanOrEqual(m.vw);
            if (i > 0)
              expect(
                m.items[i - 1].right,
                `${at}: "${m.items[i - 1].cls}" overlaps "${m.items[i].cls}"`,
              ).toBeLessThanOrEqual(m.items[i].x + 0.5);
          }
          for (const r of m.actionRights)
            expect(
              r,
              `${at}: editor action inside the centre column (rights ${m.actionRights.map(Math.round)} vs main ${Math.round(m.mainRight)})`,
            ).toBeLessThanOrEqual(m.mainRight + 0.5);
          expect(m.docH, `${at}: document must not scroll vertically`).toBeLessThanOrEqual(0);
          expect(m.docW, `${at}: document must not scroll horizontally`).toBeLessThanOrEqual(0);
          if (sampled.has(width)) {
            await page.getByRole("button", { name: "Pipeline actions" }).click();
            const menu = page.getByRole("menu", { name: "Pipeline actions" });
            await expect(menu, `${at}: actions menu opens`).toBeVisible();
            const box = (await menu.boundingBox())!;
            expect(box.x, `${at}: menu inside the viewport`).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width, `${at}: menu inside the viewport`).toBeLessThanOrEqual(width);
            await page.keyboard.press("Escape");
          }
        }
      }
    }
  });
});
