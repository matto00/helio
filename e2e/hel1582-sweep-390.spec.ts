import { writeFileSync } from "node:fs";

import { expect, test, type Locator } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import {
  AUTH,
  SIZES,
  THEMES,
  openPipeline,
  seedPipeline,
  sheet,
  sweepFloor,
} from "./support/hel1582Phone";
import { settleTransitions } from "./support/settleTransitions";

// HEL-1582: the heavy phone sweeps at 390px, split out of `hel1582-mobile-pipeline.spec.ts` so CI's file-level sharding
// can put the three viewports on different shards (each sweep takes minutes). Test bodies are unchanged: the C8
// every-step-kind hit-area sweep and the MAXIMAL sweep of the widest fixture.

test.use({
  viewport: { width: 375, height: 812 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});

test.describe("HEL-1582 phone pipeline page (live)", () => {
  for (const size of SIZES.filter((s) => s.width === 390)) {
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
        const label = (await rows.nth(i).locator(".spine-row__title").textContent()) ?? `row ${i}`;
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

  for (const size of SIZES.filter((s) => s.width === 390)) {
    test(`MAXIMAL sweep (C8, both axes): header, every tab, every menu and every step kind's editor and preview on the widest fixture at ${size.width}x${size.height}`, async ({
      page,
      request,
    }) => {
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
          await sweep(page.locator("[role=dialog]:not(dialog)").last(), "schema disclosure panel");
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
          const inSheetTrigger = sheet(page).locator(".output-schema-disclosure__trigger").first();
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
            if (!onScreen.inside) failures.push(at("sheet disclosure panel: outside the viewport"));
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
