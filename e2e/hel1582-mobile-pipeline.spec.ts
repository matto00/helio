import { writeFileSync } from "node:fs";

import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { forceFocusVisible } from "./support/forceFocusVisible";
import { settleTransitions } from "./support/settleTransitions";
import {
  CONTRAST_THRESHOLD,
  classifyState,
  compositeStack,
  contrastRatio,
  parseColor,
} from "./support/stateContrast.mjs";
import { bisectHitExtent } from "./support/touchTargetProbe";
import {
  AUTH,
  CSRF,
  SIZES,
  THEMES,
  assertFits,
  navTop,
  openPipeline,
  rectOf,
  seedPipeline,
  sheet,
  sweepFloor,
} from "./support/hel1582Phone";

// HEL-1582: the phone pipeline detail page (header, Steps / Preview / Runs tabs, the step list, the step sheet and
// the floating run pills) proven against the running app at 375x812, 390x844 and 768x1024 in both themes.
// AC1 fit, AC2 swipe + close + every step kind editable in the sheet, AC3 pill clearance, AC4 the 44px touch floor
// (hit extent, via the repo's own tap-target probe), plus phone hover / focus / pressed contrast for the new
// controls (the HEL-866 guard only measures desktop widths, HEL-1649). Each guard also proves it can go red: a
// mutation injected into the live page must fail the same assertion.

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

    // The pending-edit flush on dismiss: an edit made, then a swipe, is saved.
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
    await expect.poll(() => stepConfigPatches.length).toBeGreaterThan(0);
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

  test("the sheet composes HEL-1584's Modal motion: one entrance, no transform at rest, a held exit with no flash, an anchored popover, under Full, Subtle and Off in both themes", async ({
    page,
    request,
  }) => {
    test.setTimeout(590_000);
    await registerAndLogin(page, request, { ...AUTH, label: "sheet-motion" });
    const pipelineId = await seedPipeline(page);
    const client = await page.context().newCDPSession(page);
    const evidence: unknown[] = [];
    type Mode = "full" | "subtle" | "off";
    for (const mode of ["full", "subtle", "off"] as Mode[]) {
      const res = await request.patch("/api/users/me/preferences", {
        data: { motion: mode },
        headers: CSRF,
      });
      expect(res.status()).toBe(200);
      for (const theme of THEMES) {
        await page.waitForTimeout(6_000);
        await openPipeline(page, pipelineId, theme);
        await expect(page.locator("html")).toHaveAttribute("data-motion", mode);
        const cell = `${mode}/${theme}`;

        // Entrance: count the CSS animations that start on the dialog and on its backdrop.
        await page.evaluate(() => {
          const w = window as unknown as { __starts: string[] };
          w.__starts = [];
          document.addEventListener(
            "animationstart",
            (e) => {
              const target = e.target as HTMLElement;
              if (target.matches?.("dialog.bottom-sheet"))
                w.__starts.push(`${e.pseudoElement || "dialog"}:${e.animationName}`);
            },
            true,
          );
        });
        await page.locator(".spine-row__select").nth(1).tap();
        await expect(sheet(page)).toBeVisible();
        await sheet(page).evaluate((el) =>
          Promise.all(el.getAnimations().map((x) => x.finished.catch(() => undefined))),
        );
        await settleTransitions(page);
        const starts = await page.evaluate(
          () => (window as unknown as { __starts: string[] }).__starts,
        );
        const dialogStarts = starts.filter((x) => x.startsWith("dialog:"));
        const expected = { full: "bottom-sheet-in", subtle: "bottom-sheet-fade", off: "" }[mode];
        if (mode === "off") {
          expect(
            dialogStarts.filter((x) => x.includes("ui-modal-in")),
            cell,
          ).toEqual([]);
        } else {
          expect(
            dialogStarts,
            `${cell}: exactly the sheet's own entrance, never Modal's as well`,
          ).toEqual([`dialog:${expected}`]);
        }
        // C7: nothing transformed at rest while open.
        expect(
          await sheet(page).evaluate((el) => [
            getComputedStyle(el).transform,
            (el as HTMLElement).style.transform,
          ]),
          `${cell} at rest`,
        ).toEqual(["none", ""]);

        // A Select popover inside the sheet anchors under its trigger.
        const trigger = sheet(page).locator(".ui-select__trigger").first();
        await trigger.tap();
        const listbox = page.getByRole("listbox").first();
        await expect(listbox).toBeVisible();
        const [tb, lb] = await Promise.all([
          trigger.evaluate((el) => el.getBoundingClientRect()),
          listbox.evaluate((el) => el.getBoundingClientRect()),
        ]);
        expect(Math.abs(lb.top - tb.bottom), `${cell} popover anchor`).toBeLessThan(8);
        expect(Math.abs(lb.left - tb.left), `${cell} popover left`).toBeLessThan(2);
        await page.keyboard.press("Escape");
        await expect(listbox).toBeHidden();

        // Backdrop is there (the sheet is modal).
        expect(
          await sheet(page).evaluate((el) => getComputedStyle(el, "::backdrop").backgroundColor),
        ).not.toBe("rgba(0, 0, 0, 0)");

        // Held exit with no flash, for Close, Escape and a real touch swipe.
        const record = () =>
          page.evaluate(() => {
            const w = window as unknown as { __frames: string[]; __stop: boolean };
            w.__frames = [];
            w.__stop = false;
            const dlg = document.querySelector("dialog.bottom-sheet") as HTMLDialogElement;
            let seenMoving = false;
            const tick = () => {
              if (w.__stop) return;
              const cs = getComputedStyle(dlg);
              const rest = cs.transform === "none" && cs.opacity === "1";
              if (!rest) seenMoving = true;
              if (seenMoving && dlg.open && rest) w.__frames.push("open-at-rest");
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
        const stop = async () => {
          await page.waitForTimeout(150);
          return page.evaluate(() => {
            const w = window as unknown as { __frames: string[]; __stop: boolean };
            w.__stop = true;
            return w.__frames;
          });
        };
        for (const how of ["close", "escape", "swipe"] as const) {
          if (how !== "close") {
            await page.waitForTimeout(1_000);
            await page.locator(".spine-row__select").nth(1).tap();
            await expect(sheet(page)).toBeVisible();
            await sheet(page).evaluate((el) =>
              Promise.all(el.getAnimations().map((x) => x.finished.catch(() => undefined))),
            );
            await settleTransitions(page);
          }
          await record();
          if (how === "close") {
            await sheet(page).getByRole("button", { name: "Close" }).tap();
          } else if (how === "escape") {
            await page.keyboard.press("Escape");
          } else {
            const h = await rectOf(sheet(page).locator(".ui-modal__header"));
            const x = (h.left + h.right) / 2;
            const y = h.top + 14;
            await client.send("Input.dispatchTouchEvent", {
              type: "touchStart",
              touchPoints: [{ x, y }],
            });
            for (let i = 1; i <= 12; i++) {
              await client.send("Input.dispatchTouchEvent", {
                type: "touchMove",
                touchPoints: [{ x, y: y + (400 * i) / 12 }],
              });
              await page.waitForTimeout(16);
            }
            await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          }
          await expect(sheet(page)).toBeHidden();
          const frames = await stop();
          expect(frames, `${cell} ${how} exit: frames with the dialog open at rest`).toEqual([]);
          expect(await page.evaluate(() => document.querySelectorAll("dialog[open]").length)).toBe(
            0,
          );
        }
        evidence.push({ cell, starts });
      }
    }
    // Leave the account on the default motion level.
    await request.patch("/api/users/me/preferences", { data: { motion: null }, headers: CSRF });
    writeFileSync(
      evidencePath("HEL-1582", "sheet-motion-integration-1584.json"),
      JSON.stringify(evidence, null, 2),
    );
  });

  test('AC4 (C8): tapping the Analyze with AI "Move output field 2 up" button moves that field up, at the sheet\'s real hit area', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await registerAndLogin(page, request, { ...AUTH, label: "ai-move" });
    const pipelineId = await seedPipeline(page, true);
    await openPipeline(page, pipelineId);
    const rows = page.locator(".spine-row__select");
    const count = await rows.count();
    let opened = false;
    for (let i = 0; i < count && !opened; i++) {
      const title = (await rows.nth(i).locator(".spine-row__title").textContent()) ?? "";
      if (!/Analyze with AI/i.test(title)) continue;
      await rows.nth(i).scrollIntoViewIfNeeded();
      await rows.nth(i).tap();
      opened = true;
    }
    expect(opened, "an Analyze with AI step is in the list").toBe(true);
    await expect(sheet(page)).toBeVisible();
    await sheet(page).evaluate((el) =>
      Promise.all(el.getAnimations().map((x) => x.finished.catch(() => undefined))),
    );
    const names = () =>
      sheet(page)
        .getByPlaceholder("field name")
        .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(await names()).toEqual(["a", "b", "c", "d"]);
    const up = sheet(page).getByRole("button", { name: "Move output field 2 up" });
    await up.scrollIntoViewIfNeeded();
    // A real touch at the painted centre of the button.
    const tapCentre = async (locator: Locator) => {
      const box = (await locator.boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    };
    await tapCentre(up);
    await expect.poll(names).toEqual(["b", "a", "c", "d"]);
    // And the down button of field 3 moves it down.
    await tapCentre(sheet(page).getByRole("button", { name: "Move output field 3 down" }));
    await expect.poll(names).toEqual(["b", "a", "d", "c"]);
  });

  for (const size of SIZES.slice(0, 2)) {
    test(`the "N fields" panel opens fully on screen, above the sheet, with a real filter hit area, on a 3-step pipeline with a 17-column source at ${size.width}x${size.height}`, async ({
      page,
      request,
    }) => {
      test.setTimeout(300_000);
      await page.setViewportSize(size);
      await registerAndLogin(page, request, { ...AUTH, label: `panel${size.width}` });
      const pipelineId = await seedPipeline(page, false, true, true);
      for (const theme of THEMES) {
        await page.waitForTimeout(8_000);
        await openPipeline(page, pipelineId, theme);
        const checkPanel = async (where: string) => {
          const panel = page.getByRole("dialog", { name: "Output schema" });
          await expect(panel).toBeVisible();
          await page.waitForFunction(() =>
            document.getAnimations().every((x) => x.playState !== "running"),
          );
          const geometry = await panel.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return {
              top: r.top,
              left: r.left,
              right: r.right,
              bottom: r.bottom,
              vw: window.innerWidth,
              vh: window.innerHeight,
              centreInPanel: hit !== null && el.contains(hit),
            };
          });
          const cell = `${theme} ${where}`;
          expect(geometry.top, `${cell}: top inside the viewport`).toBeGreaterThanOrEqual(0);
          expect(geometry.left, `${cell}: left inside the viewport`).toBeGreaterThanOrEqual(0);
          expect(geometry.right, `${cell}: right inside the viewport`).toBeLessThanOrEqual(
            geometry.vw,
          );
          expect(geometry.bottom, `${cell}: bottom inside the viewport`).toBeLessThanOrEqual(
            geometry.vh,
          );
          expect(geometry.centreInPanel, `${cell}: the panel's centre hit-tests to the panel`).toBe(
            true,
          );
          const filter = panel.locator(".schema-field-viewer__filter");
          for (const axis of ["x", "y"] as const) await bisectHitExtent(page, filter, axis);
        };

        // (a) Preview tab, default state (no scrolling).
        await page.getByRole("tab", { name: "Preview" }).tap();
        await expect(page.getByRole("region", { name: /^Rows after step/ })).toBeVisible();
        await page.locator(".mobile-body .output-schema-disclosure__trigger").first().tap();
        await checkPanel("preview tab");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog", { name: "Output schema" })).toBeHidden();

        // (b) Inside the open step sheet.
        await page.getByRole("tab", { name: "Steps" }).tap();
        await page.locator(".spine-row__select").nth(0).tap();
        await expect(sheet(page)).toBeVisible();
        await sheet(page).evaluate((el) =>
          Promise.all(el.getAnimations().map((x) => x.finished.catch(() => undefined))),
        );
        await sheet(page).locator(".output-schema-disclosure__trigger").first().tap();
        await checkPanel("step sheet");
        await page.keyboard.press("Escape");
      }
    });
  }

  test('desktop (1440x900): the "N fields" panel opens on the side of its trigger with room, fully inside the viewport', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await registerAndLogin(page, request, { ...AUTH, label: "panel-desktop" });
    const pipelineId = await seedPipeline(page, false, true, true);
    await openPipeline(page, pipelineId);
    const trigger = page
      .locator(".step-preview__header .output-schema-disclosure__trigger")
      .first();
    await expect(trigger).toBeVisible();
    await trigger.click();
    const panel = page.getByRole("dialog", { name: "Output schema" });
    await expect(panel).toBeVisible();
    await page.waitForFunction(() =>
      document.getAnimations().every((x) => x.playState !== "running"),
    );
    const [t, p] = await Promise.all([
      trigger.evaluate((el) => el.getBoundingClientRect().toJSON()),
      panel.evaluate((el) => el.getBoundingClientRect().toJSON()),
    ]);
    // The trigger sits at y~320 here, with less than the panel's 384px above it: the panel opens below (before this
    // change it opened upward and its top edge left the viewport).
    expect(p.bottom <= t.top || p.top >= t.bottom, "does not cover its trigger").toBe(true);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.bottom).toBeLessThanOrEqual(900);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.right).toBeLessThanOrEqual(1440);
  });

  test("AC4 guard can fail: a shrunk tab and a removed hit expander are caught by the same probe", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await registerAndLogin(page, request, { ...AUTH, label: "touch-mutation" });
    const pipelineId = await seedPipeline(page);
    await openPipeline(page, pipelineId);
    const tab = page.getByRole("tab", { name: "Preview" });
    await bisectHitExtent(page, tab, "y");
    await page.addStyleTag({
      content:
        ".mobile-tabs__tab { height: 30px !important; } .mobile-tabs { align-items: flex-start; }",
    });
    await expect(bisectHitExtent(page, tab, "y")).rejects.toThrow();
    const pill = page.getByRole("button", { name: "Dry run" });
    await bisectHitExtent(page, pill, "y");
    await page.addStyleTag({ content: ".mobile-pill::after { display: none !important; }" });
    await expect(bisectHitExtent(page, pill, "y")).rejects.toThrow();
  });

  // ---- phone hover / focus / pressed contrast for the new controls ---------------------------------------------

  interface StateReading {
    ownBg: string;
    afterBg: string;
    beforeBg: string;
    color: string;
    outlineColor: string;
    outlineStyle: string;
    outlineWidth: string;
    boxShadow: string;
    borderColor: string;
    hasText: boolean;
  }
  const readState = (locator: Locator): Promise<StateReading> =>
    locator.evaluate((el) => {
      const own = getComputedStyle(el);
      return {
        ownBg: own.backgroundColor,
        afterBg: getComputedStyle(el, "::after").backgroundColor,
        beforeBg: getComputedStyle(el, "::before").backgroundColor,
        color: own.color,
        outlineColor: own.outlineColor,
        outlineStyle: own.outlineStyle,
        outlineWidth: own.outlineWidth,
        boxShadow: own.boxShadow,
        borderColor: own.borderColor,
        hasText: (el.textContent ?? "").trim().length > 0,
      };
    });
  const readBackdrop = (locator: Locator): Promise<string[]> =>
    locator.evaluate((el) => {
      const layers: string[] = [];
      let node: Element | null = el.parentElement;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
          layers.push(bg);
          if (/^rgb\(/.test(bg.trim())) break;
        }
        node = node.parentElement;
      }
      return layers;
    });

  interface StateResult {
    theme: string;
    control: string;
    state: "hover" | "focus" | "pressed";
    surfaceRatio: number | null;
    textRatio: number | null;
    indicatorRatio: number | null;
    verdict: string;
  }

  async function measureControl(
    page: Page,
    client: CDPSession,
    theme: string,
    control: string,
    locator: Locator,
    out: StateResult[],
  ) {
    await locator.scrollIntoViewIfNeeded();
    const rest = await readState(locator);
    const backdropLayers = (await readBackdrop(locator)).map((l) => parseColor(l));
    const backdrop = compositeStack(
      backdropLayers.length ? backdropLayers : [parseColor("rgb(255,255,255)")],
    );

    for (const state of ["hover", "focus", "pressed"] as const) {
      let clear: (() => Promise<void>) | null = null;
      if (state === "hover") {
        await locator.hover({ force: true });
      } else if (state === "focus") {
        clear = await forceFocusVisible(client, locator);
      } else {
        const marker = "data-hel1582-active";
        await locator.evaluate((el, m) => el.setAttribute(m, "1"), marker);
        const { root } = await client.send("DOM.getDocument");
        const { nodeId } = await client.send("DOM.querySelector", {
          nodeId: root.nodeId,
          selector: `[${marker}]`,
        });
        await client.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["active"] });
        clear = async () => {
          await client
            .send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] })
            .catch(() => {});
          await locator.evaluate((el, m) => el.removeAttribute(m), marker).catch(() => {});
        };
      }
      await settleTransitions(page);
      const now = await readState(locator);
      await page.mouse.move(0, 0);
      await page
        .evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
        .catch(() => {});
      if (clear) await clear();

      const ownChanged = now.ownBg !== rest.ownBg;
      const afterChanged = now.afterBg !== rest.afterBg && parseColor(now.afterBg).a > 0;
      const beforeChanged = now.beforeBg !== rest.beforeBg;
      const backgroundChanged = ownChanged || afterChanged || beforeChanged;
      const otherChanged =
        now.boxShadow !== rest.boxShadow ||
        now.borderColor !== rest.borderColor ||
        now.outlineColor !== rest.outlineColor ||
        now.outlineWidth !== rest.outlineWidth;

      const stateLayer = parseColor(
        ownChanged ? now.ownBg : afterChanged ? now.afterBg : now.beforeBg,
      );
      const surface = backgroundChanged
        ? compositeStack([stateLayer, ...backdropLayers])
        : compositeStack([parseColor(now.ownBg), ...backdropLayers]);
      let verdict = "n/a";
      let surfaceRatio: number | null = null;
      // The app declares no pressed (:active) style: "pressed" is recorded, and judged only when a style exists
      // (a pressed wash that does change must clear the same floor); hover must always change something.
      if (state === "pressed" && !backgroundChanged && !otherChanged) {
        verdict = "none-declared";
      } else if (state !== "focus") {
        const res = classifyState({
          backgroundChanged,
          otherChannelChanged: otherChanged,
          backdrop,
          stateColor: backgroundChanged ? surface : backdrop,
          threshold: CONTRAST_THRESHOLD,
        });
        verdict = res.verdict;
        surfaceRatio = res.ratio;
      }
      const textRatio = now.hasText
        ? contrastRatio(compositeStack([parseColor(now.color), surface]), surface)
        : null;
      let indicatorRatio: number | null = null;
      if (state === "focus") {
        const ringVisible = now.outlineStyle !== "none" && parseFloat(now.outlineWidth) > 0;
        const ring = ringVisible ? parseColor(now.outlineColor) : parseColor(now.borderColor);
        indicatorRatio = contrastRatio(compositeStack([ring, ...backdropLayers]), backdrop);
        verdict = indicatorRatio >= 3 ? "pass" : "fail";
      }
      out.push({ theme, control, state, surfaceRatio, textRatio, indicatorRatio, verdict });
    }
  }

  test("phone hover, focus and pressed states of the new controls clear the state-surface floor (1.10), text 4.5:1 and non-text 3:1, in both themes (and the measurement can fail)", async ({
    browser,
    baseURL,
    request,
  }) => {
    test.setTimeout(240_000);
    // HEL-1668 D5: hover fills apply only on hover-capable pointers, so hover is measured in a non-touch context at the
    // phone viewport (the touch side is covered by the hel1668 sticky-hover e2e).
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 375, height: 812 },
      isMobile: false,
      hasTouch: false,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    try {
      await registerAndLogin(page, request, { ...AUTH, label: "contrast" });
      const pipelineId = await seedPipeline(page);
      const client = await page.context().newCDPSession(page);
      await client.send("DOM.enable");
      await client.send("CSS.enable");
      const results: StateResult[] = [];

      for (const theme of THEMES) {
        await openPipeline(page, pipelineId, theme);
        const controls: [string, Locator][] = [
          ["tab (inactive)", page.getByRole("tab", { name: "Preview" })],
          ["step row", page.locator(".spine-row__select").nth(1)],
          ["add step row", page.locator(".spine-add-row")],
          ["Dry run pill", page.getByRole("button", { name: "Dry run" })],
          ["Run pipeline pill", page.getByRole("button", { name: "Run pipeline" })],
          ["back link", page.getByRole("link", { name: "Back to pipelines" })],
          ["actions menu trigger", page.getByRole("button", { name: "Pipeline actions" })],
          ["source name button", page.locator(".spine-card__name-btn")],
          ["source menu trigger", page.getByRole("button", { name: /^Source actions for/ })],
          ["output card", page.locator(".spine-card__open")],
          ["new output button", page.getByRole("button", { name: "New output" })],
          ["schedule chip", page.getByRole("button", { name: "Add schedule" })],
        ];
        for (const [name, locator] of controls) {
          await measureControl(page, client, theme, name, locator, results);
        }
      }
      writeFileSync(
        evidencePath("HEL-1582", "phone-state-contrast.json"),
        JSON.stringify(results, null, 2),
      );
      console.table(
        results.map((r) => ({
          theme: r.theme,
          control: r.control,
          state: r.state,
          surface: r.surfaceRatio?.toFixed(3) ?? "-",
          text: r.textRatio?.toFixed(2) ?? "-",
          indicator: r.indicatorRatio?.toFixed(2) ?? "-",
          verdict: r.verdict,
        })),
      );
      const failures = results.filter(
        (r) =>
          r.verdict === "fail" ||
          (r.textRatio !== null && r.textRatio < 4.5) ||
          (r.indicatorRatio !== null && r.indicatorRatio < 3),
      );
      expect(
        failures.map(
          (f) =>
            `${f.theme} ${f.control} ${f.state} surface=${f.surfaceRatio} text=${f.textRatio} ind=${f.indicatorRatio}`,
        ),
      ).toEqual([]);
      // HEL-1669: no exception remains -- the Run pill hover (ink on --app-accent-strong) is held to 4.5 by the
      // generic filter above; make sure that filter actually saw it, in both themes.
      const runPillHover = results.filter(
        (r) => r.control === "Run pipeline pill" && r.state === "hover" && r.textRatio !== null,
      );
      expect(runPillHover.map((r) => r.theme).sort()).toEqual([...THEMES].sort());

      // Mutation: a hover wash identical to the backdrop must read as "nothing changed" (a failing verdict).
      await openPipeline(page, pipelineId, "dark");
      await page.addStyleTag({
        content:
          ".mobile-tabs__tab:hover { background: transparent !important; color: var(--app-text-muted) !important; }",
      });
      const mutated: StateResult[] = [];
      await measureControl(
        page,
        client,
        "dark",
        "tab (mutated)",
        page.getByRole("tab", { name: "Runs" }),
        mutated,
      );
      expect(mutated.find((m) => m.state === "hover")?.verdict).toBe("fail");
    } finally {
      await context.close();
    }
  });

  test("HEL-1669: the Dry run hover is distinct from its rest fill (>= 1.10) and the Run pill rests on --app-accent / hovers on --app-accent-strong, in both themes", async ({
    browser,
    baseURL,
    request,
  }) => {
    test.setTimeout(120_000);
    // HEL-1668 D5: hover fills apply only on hover-capable pointers, so hover is measured in a non-touch context at the
    // phone viewport (the touch side is covered by the hel1668 sticky-hover e2e).
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 375, height: 812 },
      isMobile: false,
      hasTouch: false,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    try {
      await registerAndLogin(page, request, { ...AUTH, label: "hover-distinct" });
      const pipelineId = await seedPipeline(page);
      const bgOf = (locator: Locator) =>
        locator.evaluate((el) => getComputedStyle(el).backgroundColor);
      const token = (name: string) =>
        page.evaluate((n) => {
          const probe = document.createElement("div");
          probe.style.background = `var(${n})`;
          document.body.appendChild(probe);
          const v = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return v;
        }, name);
      const numbers: Record<string, unknown> = {};
      for (const theme of THEMES) {
        await openPipeline(page, pipelineId, theme);
        const dry = page.getByRole("button", { name: "Dry run" });
        const run = page.getByRole("button", { name: "Run pipeline" });

        const dryRest = await bgOf(dry);
        await dry.hover({ force: true });
        await settleTransitions(page);
        const dryHover = await bgOf(dry);
        await page.mouse.move(0, 0);
        await settleTransitions(page);
        const dryVsRest = contrastRatio(parseColor(dryHover), parseColor(dryRest));

        const runRest = await bgOf(run);
        await run.hover({ force: true });
        await settleTransitions(page);
        const runHover = await bgOf(run);
        await page.mouse.move(0, 0);

        numbers[theme] = { dryRest, dryHover, dryVsRest, runRest, runHover };
        expect(dryVsRest, `${theme}: Dry run hover vs rest`).toBeGreaterThanOrEqual(1.1);
        expect(runRest, `${theme}: Run pill rest is --app-accent`).toBe(
          await token("--app-accent"),
        );
        expect(runHover, `${theme}: Run pill hover is --app-accent-strong`).toBe(
          await token("--app-accent-strong"),
        );
      }
      console.log(JSON.stringify(numbers, null, 2));
    } finally {
      await context.close();
    }
  });
});
