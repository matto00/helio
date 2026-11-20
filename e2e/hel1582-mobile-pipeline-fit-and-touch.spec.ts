import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { settleTransitions } from "./support/settleTransitions";
import {
  assertFits,
  AUTH,
  navTop,
  openPipeline,
  rectOf,
  seedPipeline,
  sheet,
  SIZES,
  sweepFloor,
  THEMES,
} from "./support/hel1582Phone";

// HEL-1582: the phone pipeline detail page (header, Steps / Preview / Runs tabs, the step list, the step sheet and
// the floating run pills) proven against the running app at 375x812, 390x844 and 768x1024 in both themes.
// AC1 fit, AC2 swipe + close + every step kind editable in the sheet, AC3 pill clearance, AC4 the 44px touch floor
// (hit extent, via the repo's own tap-target probe), plus phone hover / focus / pressed contrast for the new
// controls (the HEL-866 guard only measures desktop widths, HEL-1649). Each guard also proves it can go red: a
// mutation injected into the live page must fail the same assertion.
//
// HEL-1582: AC1 fit, AC2 sheet gestures and editors, AC3 pill clearance and the AC4 44px touch floor (the loops over the three viewports).
// One of the `hel1582-mobile-pipeline-*.spec.ts` parts (HEL-1789 split the spec so CI's file-level sharding can place them on
// different legs); the file-level `test.use` is repeated here exactly. The shared fixtures live in support/hel1582Phone.ts.

test.use({
  viewport: { width: 375, height: 812 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});

test.describe("HEL-1582 phone pipeline page (live)", () => {
  test("AC1: at 375x812 the source, all 3 steps and the Output fit without scrolling, in both themes", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await registerAndLogin(page, request, { ...AUTH, label: "fit" });
    const pipelineId = await seedPipeline(page);
    const evidence: Record<string, unknown> = {};
    for (const theme of THEMES) {
      await openPipeline(page, pipelineId, theme);
      evidence[theme] = await assertFits(page);
      await page.screenshot({ path: evidencePath("HEL-1582", `steps-375x812-${theme}.png`) });
    }
    writeFileSync(evidencePath("HEL-1582", "fit-375x812.json"), JSON.stringify(evidence, null, 2));
  });

  test("AC1 guard can fail: a taller row makes the fit assertion go red", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await registerAndLogin(page, request, { ...AUTH, label: "fit-mutation" });
    const pipelineId = await seedPipeline(page);
    await openPipeline(page, pipelineId);
    await page.addStyleTag({
      content: ".spine-row--phone .spine-row__select { min-height: 150px !important; }",
    });
    await expect(assertFits(page)).rejects.toThrow();
  });

  test("AC2: a touch drag on the handle dismisses the sheet; a short drag returns it; the body never drags it; the close control closes it", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await registerAndLogin(page, request, { ...AUTH, label: "swipe" });
    const pipelineId = await seedPipeline(page);
    await openPipeline(page, pipelineId);
    const client = await page.context().newCDPSession(page);

    /** A real CDP touch drag; `whileDown` runs with the finger still down (to read the sheet mid-gesture). */
    const touchDrag = async (
      x: number,
      fromY: number,
      toY: number,
      stepMs: number,
      whileDown?: () => Promise<void>,
      steps = 12,
    ) => {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y: fromY }],
      });
      for (let i = 1; i <= steps; i++) {
        await client.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: fromY + ((toY - fromY) * i) / steps }],
        });
        await page.waitForTimeout(stepMs);
      }
      if (whileDown) await whileDown();
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    const inlineTransform = () => sheet(page).evaluate((el) => (el as HTMLElement).style.transform);
    /** Opens a step's sheet and waits for its entrance animation to finish, so geometry is read at rest. */
    const open = async (n: number) => {
      // Chromium drops the click of a tap that lands while the previous touch gesture is still latched (right
      // after a swipe), so the tap is retried until the sheet opens: the retry is the readiness condition.
      await expect(async () => {
        await page.locator(".spine-row__select").nth(n).tap();
        await expect(sheet(page)).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 10_000 });
      await sheet(page).evaluate((el) =>
        Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))),
      );
      await settleTransitions(page);
    };

    await open(1);
    const header = await rectOf(sheet(page).locator(".ui-modal__header"));
    const handleX = (header.left + header.right) / 2;
    const handleY = header.top + 14;

    // A short, slow drag follows the finger, then springs back and leaves no transform at rest.
    await touchDrag(handleX, handleY, handleY + 40, 40, async () => {
      expect(await inlineTransform(), "the sheet follows the finger").toMatch(
        /translateY\(([2-4]\d)/,
      );
    });
    await expect(sheet(page)).toBeVisible();
    await expect
      .poll(() => sheet(page).evaluate((el) => getComputedStyle(el).transform))
      .toBe("none");
    expect(await inlineTransform()).toBe("");

    // A drag inside the body scrolls the body, never the sheet, and never dismisses it.
    const body = await rectOf(sheet(page).locator(".ui-modal__body"));
    await touchDrag((body.left + body.right) / 2, body.top + 40, body.top + 500, 20, async () => {
      expect(await inlineTransform(), "the body never moves the sheet").toBe("");
    });
    await expect(sheet(page)).toBeVisible();
    expect(await inlineTransform()).toBe("");

    // A long drag dismisses.
    await touchDrag(handleX, handleY, handleY + 400, 16);
    await expect(sheet(page)).toBeHidden();

    // The visible close control dismisses too (the same request path).
    await open(0);
    await sheet(page).getByRole("button", { name: "Close" }).tap();
    await expect(sheet(page)).toBeHidden();
    await expect(page.locator("dialog[open]")).toHaveCount(0);

    // HEL-1631: an edit made, then a swipe, stays in the unsaved draft (no request); the action bar shows it.
    await open(1);
    const stepConfigPatches: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().includes("/api/pipeline-steps/"))
        stepConfigPatches.push(r.url());
    });
    const sortSelect = sheet(page)
      .getByRole("button", { name: /asc|desc/i })
      .first();
    await sortSelect.tap();
    await touchDrag(handleX, handleY, handleY + 400, 16);
    await expect(sheet(page)).toBeHidden();
    await expect(page.locator('[data-slot="draft-status"]')).toHaveText("Draft · unsaved changes");
    await page.waitForTimeout(1200);
    expect(stepConfigPatches).toEqual([]);
  });

  test("AC2: the sheet's Step actions menu opens above the modal, Move step down works from it, and focus stays in the sheet", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await registerAndLogin(page, request, { ...AUTH, label: "sheet-menu" });
    const pipelineId = await seedPipeline(page);
    await openPipeline(page, pipelineId);
    const titles = () => page.locator(".spine-row__title").allTextContents();
    const before = await titles();
    await page.locator(".spine-row__select").nth(0).tap();
    await expect(sheet(page)).toBeVisible();
    await settleTransitions(page);
    const trigger = sheet(page).getByRole("button", { name: /^Step actions for/ });
    await trigger.tap();
    const item = page.getByRole("menuitem", { name: /^Move step down/ });
    await expect(item).toBeVisible();
    // The panel is inside the modal dialog (top layer): the item is what a touch at its centre actually hits.
    const hit = await item.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === el || el.contains(top);
    });
    expect(hit, "the menu item is not occluded by the modal").toBe(true);
    expect(await item.evaluate((el) => el.closest("dialog") !== null)).toBe(true);
    const reordered = page.waitForRequest(
      (r) => r.method() === "PUT" && r.url().endsWith("/steps/order"),
    );
    await item.tap();
    await reordered;
    await expect(sheet(page)).toBeVisible();
    await expect.poll(titles).not.toEqual(before);
    // Focus stays inside the sheet, on its Step actions trigger (never dropped to the body).
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement;
          return {
            inSheet: active?.closest("dialog[open]") !== null && active !== document.body,
            label: active?.getAttribute("aria-label") ?? "",
          };
        }),
      )
      .toMatchObject({ inSheet: true, label: expect.stringMatching(/^Step actions for/) });
  });

  test("AC2: every step kind's editor opens in the sheet at 375px with every control inside it", async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await registerAndLogin(page, request, { ...AUTH, label: "kinds" });
    const pipelineId = await seedPipeline(page, true);
    await openPipeline(page, pipelineId);
    const rows = page.locator(".spine-row__select");
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(10);
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      await rows.nth(i).scrollIntoViewIfNeeded();
      await rows.nth(i).tap();
      await expect(sheet(page)).toBeVisible();
      await settleTransitions(page);
      const label = (await rows.nth(i).locator(".spine-row__title").textContent()) ?? "";
      labels.push(label);
      const geometry = await sheet(page).evaluate((dialog) => {
        const d = dialog.getBoundingClientRect();
        const outside: string[] = [];
        for (const el of dialog.querySelectorAll<HTMLElement>(
          "input, select, textarea, button, [role=combobox]",
        )) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.left < d.left - 0.5 || r.right > d.right + 0.5)
            outside.push(
              `${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 24)} ${Math.round(r.left)}-${Math.round(r.right)}`,
            );
        }
        return {
          overflow: dialog.scrollWidth - dialog.clientWidth,
          outside,
          sheet: [d.left, d.right],
        };
      });
      expect(geometry.overflow, `${label}: no horizontal overflow`).toBeLessThanOrEqual(1);
      expect(geometry.outside, `${label}: controls inside the sheet ${geometry.sheet}`).toEqual([]);
      // The editor really rendered (not the "Configure this ... step" fallback).
      await expect(sheet(page).locator(".step-focused__body")).toBeVisible();
      await expect(sheet(page).getByText(/^Configure this .* step\.?$/)).toHaveCount(0);
      await sheet(page).getByRole("button", { name: "Close" }).tap();
      await expect(sheet(page)).toBeHidden();
    }
    console.log(`[HEL-1582 e2e] editors opened in the sheet: ${labels.join(", ")}`);
    writeFileSync(
      evidencePath("HEL-1582", "sheet-step-kinds.json"),
      JSON.stringify(labels, null, 2),
    );
  });

  test("AC3: scrolled to the end the last item clears the pills and the pills clear the nav (and the guard can fail)", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await registerAndLogin(page, request, { ...AUTH, label: "clear" });
    const pipelineId = await seedPipeline(page, true);
    await openPipeline(page, pipelineId);

    const measure = async () => {
      const body = page.locator(".mobile-body");
      // Scrolled to the end twice: the bar's ResizeObserver may grow the body's padding after the first scroll.
      for (let pass = 0; pass < 2; pass++) {
        await body.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await settleTransitions(page);
      }
      const lastItem = page.locator(".mobile-body button:visible").last();
      const last = await rectOf(lastItem);
      const bar = await rectOf(page.locator(".mobile-actions"));
      const nav = await navTop(page);
      return { last, bar, nav };
    };
    const assertClear = async () => {
      const { last, bar, nav } = await measure();
      expect(last.bottom, "last item ends above the action bar").toBeLessThanOrEqual(bar.top - 8);
      expect(bar.bottom, "the action bar ends above the navigation").toBeLessThanOrEqual(nav);
    };
    expect(
      await page.locator(".mobile-body").evaluate((el) => el.scrollHeight - el.clientHeight),
      "the seeded pipeline scrolls",
    ).toBeGreaterThan(100);
    await assertClear();
    const { last, bar, nav } = await measure();
    writeFileSync(
      evidencePath("HEL-1582", "clearance-375x812.json"),
      JSON.stringify(
        { lastItemBottom: last.bottom, barTop: bar.top, barBottom: bar.bottom, navTop: nav },
        null,
        2,
      ),
    );
    await page.screenshot({
      path: evidencePath("HEL-1582", "steps-scrolled-end-375x812-dark.png"),
    });

    // The bar's height drives the body's clearance: a taller bar (the HEL-1631 slot filled) keeps it.
    await page.evaluate(() => {
      const slot = document.querySelector('[data-slot="draft-status"]') as HTMLElement;
      slot.textContent = "Draft · unsaved changes";
      slot.style.padding = "12px";
    });
    await assertClear();

    // Mutation: with no bottom padding the last item sits under the pills.
    await page.addStyleTag({ content: ".mobile-body { padding-bottom: 0 !important; }" });
    await expect(assertClear()).rejects.toThrow();
  });

  for (const size of SIZES) {
    test(`AC4: every interactive element of each tab and the open sheet clears the 44px touch floor at ${size.width}x${size.height}`, async ({
      page,
      request,
    }) => {
      test.setTimeout(240_000);
      await page.setViewportSize(size);
      await registerAndLogin(page, request, { ...AUTH, label: `touch${size.width}` });
      // A wide source, so the step preview shows its "N fields" disclosure rather than the chip row.
      const pipelineId = await seedPipeline(page, false, true, true);
      await openPipeline(page, pipelineId);

      const counts: Record<string, number> = {};
      const header = page.locator(".mobile-header");
      const tabs = page.locator(".mobile-tabs");
      const bar = page.locator(".mobile-actions");

      counts.steps =
        (await sweepFloor(page, header, "header")) +
        (await sweepFloor(page, tabs, "tabs")) +
        (await sweepFloor(page, page.locator(".mobile-body"), "steps")) +
        (await sweepFloor(page, bar, "pills"));

      await page.getByRole("tab", { name: "Preview" }).tap();
      await expect(page.getByRole("region", { name: /^Rows after step/ })).toBeVisible();
      counts.preview = await sweepFloor(page, page.locator(".mobile-body"), "preview");

      // The seed's own run succeeded (no log toggle), so the run history response carries a failed run too: the
      // list, its "Show log" toggle and the expanded log are the real components.
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
              errorLog: "out of memory error",
              triggerSource: "scheduled",
              assertions: { passed: 0, warnFailed: 0, errorFailed: 0, failures: [] },
            },
            ...runs,
          ],
        });
      });
      await page.getByRole("tab", { name: "Runs" }).tap();
      await expect(page.locator(".run-history-modal__row").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Show log" })).toBeVisible();
      counts.runs = await sweepFloor(page, page.locator(".mobile-body"), "runs");

      await page.getByRole("tab", { name: "Steps" }).tap();
      await page.locator(".spine-row__select").nth(0).tap();
      await expect(sheet(page)).toBeVisible();
      await settleTransitions(page);
      counts.sheet = await sweepFloor(page, sheet(page), "sheet");
      writeFileSync(
        evidencePath("HEL-1582", `touch-floor-${size.width}x${size.height}.json`),
        JSON.stringify(counts, null, 2),
      );
    });
  }

  for (const size of SIZES) {
    test(`AC4: the header of a never-run pipeline (and in rename mode) clears the 44px touch floor at ${size.width}x${size.height}`, async ({
      page,
      request,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(size);
      await registerAndLogin(page, request, { ...AUTH, label: `header${size.width}` });
      const pipelineId = await seedPipeline(page, false, false);
      await openPipeline(page, pipelineId);
      const header = page.locator(".mobile-header");
      // No status label: the "Add schedule" chip starts the status line right under the back link.
      await expect(header.locator(".spine-header__status-label")).toHaveCount(0);
      const never = await sweepFloor(page, header, "never-run header");
      // Rename mode with the dirty Save / Cancel row between the name row and the status line.
      await page.getByRole("button", { name: "Pipeline actions" }).tap();
      await page.getByRole("menuitem", { name: "Rename" }).tap();
      await page.getByRole("textbox", { name: "Pipeline name" }).fill("hel1582-renamed");
      await expect(page.getByRole("button", { name: "Save pipeline" })).toBeVisible();
      const rename = await sweepFloor(page, header, "rename header");
      writeFileSync(
        evidencePath("HEL-1582", `header-never-run-${size.width}x${size.height}.json`),
        JSON.stringify({ never, rename }, null, 2),
      );
    });
  }

  test("AC1: a never-run pipeline fits at 375x812 too (the status line has no label)", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await registerAndLogin(page, request, { ...AUTH, label: "fit-never" });
    const pipelineId = await seedPipeline(page, false, false);
    await openPipeline(page, pipelineId);
    writeFileSync(
      evidencePath("HEL-1582", "fit-never-run-375x812.json"),
      JSON.stringify(await assertFits(page), null, 2),
    );
  });

  test("AC1: the Output card still clears the action bar at 375x812 while a Run is queued and after it succeeds (the persisted last-run meta is not shown beside the in-session status)", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await registerAndLogin(page, request, { ...AUTH, label: "fit-run" });
    const pipelineId = await seedPipeline(page);
    // The realistic wide case: a run recorded hours ago with a large row count, so the persisted meta text is as long
    // as it gets ("12,345 rows written · 3 hours ago") beside the in-session "Snapshot replaced: N rows".
    await page.route(new RegExp(`/api/pipelines/${pipelineId}$`), async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      body.lastRunAt = new Date(Date.now() - 3 * 3600_000).toISOString();
      body.lastRunRowCount = 12345;
      return route.fulfill({ response, json: body });
    });
    await openPipeline(page, pipelineId);
    const evidence: Record<string, unknown> = {};
    // Hold the run request so the in-session "Queued…" status is on screen while measuring.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/api\/pipelines\/[^/]+\/run$/, async (route) => {
      await gate;
      await route.continue();
    });
    await page.getByRole("button", { name: "Run pipeline" }).tap();
    await expect(page.getByLabel("Run status: queued")).toBeVisible();
    evidence.queued = await assertFits(page);
    release();
    await expect(page.getByLabel(/^Run status: (succeeded|dry_run)$/)).toBeVisible({
      timeout: 30_000,
    });
    evidence.statusLine = await page.locator(".mobile-header__status").evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      text: el.textContent,
    }));
    evidence.succeeded = await assertFits(page);
    // The cause of the third status line: the stale persisted meta is hidden while an in-session status shows.
    await expect(page.getByLabel("Last run metadata")).toHaveCount(0);
    writeFileSync(
      evidencePath("HEL-1582", "fit-in-session-run-375x812.json"),
      JSON.stringify(evidence, null, 2),
    );
  });

  test("AC1: a truncated last run with an 8-digit row count and a paused cron chip still fits at 375x812 on page open, with the Partial badge visible", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await registerAndLogin(page, request, { ...AUTH, label: "fit-partial" });
    const pipelineId = await seedPipeline(page);
    await page.route(new RegExp(`/api/pipelines/${pipelineId}$`), async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      body.lastRunAt = new Date(Date.now() - 3 * 3600_000).toISOString();
      body.lastRunRowCount = 12_345_678;
      body.lastRunTruncated = true;
      return route.fulfill({ response, json: body });
    });
    await page.route(new RegExp(`/api/pipelines/${pipelineId}/schedule$`), async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        json: {
          id: "sch-fit",
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
    await openPipeline(page, pipelineId);
    await expect(page.getByRole("button", { name: "Edit schedule, paused" })).toBeVisible();
    const fit = await assertFits(page);
    const status = await page.locator(".mobile-header__status").evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      text: el.textContent,
    }));
    await expect(
      page.locator(".mobile-header__status").getByRole("img", { name: /^Partial/ }),
    ).toBeVisible();
    writeFileSync(
      evidencePath("HEL-1582", "fit-partial-8digit-375x812.json"),
      JSON.stringify({ status, fit }, null, 2),
    );
  });

  test("a long step list never lets the page scroll away its header: the visually hidden headings stay inside the scroller", async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await registerAndLogin(page, request, { ...AUTH, label: "scrollaway" });
    const pipelineId = await seedPipeline(page, true);
    await openPipeline(page, pipelineId);
    const root = page.locator(".pipeline-detail-page--mobile");
    const dims = await root.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(dims.scrollHeight, "the overflow:hidden page is not taller than its box").toBe(
      dims.clientHeight,
    );
    const headerTop = () =>
      page.locator(".mobile-header").evaluate((el) => el.getBoundingClientRect().top);
    const before = await headerTop();
    // What a screen reader's cursor or find-in-page does on the hidden "Outputs" heading.
    const hidden = page.locator(".mobile-body .sr-only").first();
    await expect(hidden).toHaveCount(1);
    await hidden.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
    expect(await headerTop()).toBe(before);
    expect(await root.evaluate((el) => el.scrollTop)).toBe(0);
  });
});
