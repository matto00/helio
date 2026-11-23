import { writeFileSync } from "node:fs";
import { type CDPSession, expect, type Locator, type Page, test } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { forceFocusVisible } from "./support/forceFocusVisible";
import { settleTransitions } from "./support/settleTransitions";
import {
  classifyState,
  compositeStack,
  CONTRAST_THRESHOLD,
  contrastRatio,
  parseColor,
} from "./support/stateContrast.mjs";
import { bisectHitExtent } from "./support/touchTargetProbe";
import {
  AUTH,
  CSRF,
  openPipeline,
  rectOf,
  seedPipeline,
  sheet,
  SIZES,
  THEMES,
} from "./support/hel1582Phone";

// HEL-1582: the sheet's Modal motion, the C8 move button, the "N fields" panel, the AC4 guard-can-fail probe and the phone hover / focus / pressed contrast.
// One of the `hel1582-mobile-pipeline-*.spec.ts` parts (HEL-1789 split the spec so CI's file-level sharding can place them on
// different legs); the file-level `test.use` is repeated here exactly. The shared fixtures live in support/hel1582Phone.ts.

test.use({
  viewport: { width: 375, height: 812 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});

test.describe("HEL-1582 phone pipeline page (live)", () => {
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
        const rows = page.getByRole("region", { name: /^Rows after step/ });
        await expect(rows).toBeVisible();
        // HEL-1826: the header's row count arrives with the preview response and reflows the header, moving the
        // "N fields" trigger from the right end of the first line to the line below. A tap aimed before that lands on
        // the neighbouring "+ column" chip and opens nothing (measured: t2-stale-tap.txt, CI trace tap point 319,312).
        await expect(
          rows.locator(".step-preview__count"),
          `${theme}: preview header settled`,
        ).toBeVisible();
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
