import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  assertPartitioned,
  CHROME_EXCLUDE,
  collectCandidates,
  type Counts,
  DASH_NAME,
  DOC_ID_ATTR,
  type ElementResult,
  finishCell,
  MAX_ELEMENTS_PER_VIEW,
  newCell,
  PIPELINE_NAME,
  probeView,
  type RouteKey,
  SOURCE_NAME,
  stampDocument,
  THEMES,
} from "./state-surface-contrast-guard";

// HEL-1649: the narrow half of the HEL-866 guard. The 1440px parts never render the layouts the redesign added at
// narrower widths (phone shell and its command bar / chip row / bottom nav, the mobile pipeline, the 1100px
// responsive tweaks), so a hover that is invisible only there (HEL-1628's spine-card refresh, 1.03 against a 1.10
// floor) passed CI. Same machinery as the 1440 cells (stamp, probe each declared view, assert the partition,
// fail under CONTRAST_THRESHOLD); only the viewport and the per-width view list differ.
//
// POINTER (design.md D1): fine at every width. The phone shell and mobile pipeline are WIDTH-gated
// (`max-width: 768px`), so a hover-capable 768/390 context renders them, and HEL-1735 gates feature hover rules
// behind `@media (hover: hover)`, so a touch context would render no hover at all and could never report an invisible
// one. Not measured here: layouts gated only on `(pointer: coarse)` above 768px (a touch tablet), for focus.
//
// POPULATION (design.md D2): only where the layout actually changes. 1100px: /home, /connectors. 768 and 390
// (phone shell): pipeline-detail, /dashboards, /home, /connectors (`DataSectionLinks` is shared with /sources, so
// /sources is covered once through /connectors). 2 + 4 x 2 = 6 width/route pairs x 2 themes, 20 cells with 768/390.

export interface NarrowWidth {
  width: number;
  height: number;
  routes: readonly RouteKey[];
}

export const NARROW_WIDTHS: readonly NarrowWidth[] = [
  { width: 1100, height: 900, routes: ["/home", "/connectors"] },
  {
    width: 768,
    height: 1024,
    routes: ["pipeline-detail", "/dashboards", "/home", "/connectors"],
  },
  {
    width: 390,
    height: 844,
    routes: ["pipeline-detail", "/dashboards", "/home", "/connectors"],
  },
];

const PHONE_MAX_WIDTH = 768;

export function registerNarrowCells(widths: readonly NarrowWidth[]) {
  for (const { width, height, routes } of widths) {
    const phone = width <= PHONE_MAX_WIDTH;
    for (const routeKey of routes) {
      for (const theme of THEMES) {
        test(`${routeKey} @${width}px: every interactive state background differs measurably from its resolved backdrop (${theme})`, async ({
          page,
          request,
        }) => {
          // Set before the first `goto` (newCell's), so the app boots in the target layout.
          await page.setViewportSize({ width, height });
          const { client, pipelineId } = await newCell(page, request, theme, {
            seedHomeActivity: routeKey === "/home",
            secondDashboard: phone,
          });
          const results: ElementResult[] = [];
          const counts: Counts = { resolved: 0, unresolved: 0, pass: 0, fail: 0, advisory: 0 };
          const route = routeKey === "pipeline-detail" ? `/pipelines/${pipelineId}` : routeKey;
          const viewName = `${routeKey === "pipeline-detail" ? "/pipelines/:id" : routeKey}@${width}`;

          await page.goto(route);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await expect(page).toHaveURL(
            new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
          );
          await awaitReady(page, routeKey, phone);
          await page.waitForTimeout(200); // post-render CSS settle only; readiness is gated above

          const totalStamped = await stampDocument(page);
          const covered: Set<string>[] = [];
          // HEL-1649 (skeptic-design-4 note 2): a view with more visible elements than MAX_ELEMENTS_PER_VIEW is
          // SAMPLED, and a sampled-out element still satisfies the partition check while never being measured.
          // Every narrow view must therefore be fully sampled; if one ever is not, split the view rather than
          // raise the cap.
          const fullySampled = async (label: string, scope: Locator, exclude?: string) => {
            const { candidates, totalVisible } = await collectCandidates(
              page,
              scope,
              MAX_ELEMENTS_PER_VIEW,
              exclude,
            );
            expect(
              candidates.length,
              `narrow view "${label}" is under-sampled (${candidates.length}/${totalVisible}); split it`,
            ).toBe(totalVisible);
          };
          // Chrome outside `<main>`: the command bar, the rail (>768), and on the phone the chip row's host chrome,
          // the mobile nav trigger and the bottom nav. Probed in THIS cell, because the narrow-only chrome is the
          // point (the 1440 chrome cell cannot see it).
          covered.push(
            await probeView(
              page,
              client,
              `chrome@${width}`,
              theme,
              page.locator("body"),
              results,
              counts,
              CHROME_EXCLUDE,
            ),
          );
          if (!phone) {
            // At <= 768 there is no `.context-list` (App.tsx `showRail = !isPhoneShell`).
            covered.push(
              await probeView(
                page,
                client,
                `${viewName}:sidebar-rail`,
                theme,
                page.locator(".context-list"),
                results,
                counts,
              ),
            );
          }
          const main = page.locator("main");
          await expect(main).toBeVisible();
          covered.push(await probeView(page, client, viewName, theme, main, results, counts));
          await fullySampled(`chrome@${width}`, page.locator("body"), CHROME_EXCLUDE);
          await fullySampled(viewName, main);
          if (routeKey === "pipeline-detail") {
            // M1's target: the spine card's sample-refresh button must be a measured candidate in this view.
            const refreshId = await page
              .getByRole("button", { name: `Refresh sample of ${SOURCE_NAME}` })
              .getAttribute(DOC_ID_ATTR);
            expect(refreshId, "refresh button was stamped").not.toBeNull();
            expect(covered.some((s) => s.has(refreshId ?? ""))).toBe(true);
            console.log(
              `[HEL-1649 guard] "Refresh sample of ${SOURCE_NAME}" probed at ${width}px (${theme}) in view "${viewName}" (doc id ${refreshId})`,
            );
          }
          await assertPartitioned(page, viewName, totalStamped, covered);
          finishCell(`${viewName}(${theme})`, results, counts);
        });
      }
    }
  }
}

async function awaitReady(page: Page, routeKey: RouteKey, phone: boolean) {
  const seeded = (scope: Locator, text: string) =>
    expect(scope.getByText(text, { exact: true }).first()).toBeVisible();
  if (routeKey === "/home") {
    await seeded(page.locator("main"), PIPELINE_NAME);
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    // The runs timeline is a `group` on the wide Home and a `list` (RunDisclosureList) on the phone.
    await expect(
      page.getByRole(phone ? "list" : "group", { name: "Pipeline runs, last 24 hours" }),
    ).toBeVisible();
  } else if (routeKey === "/dashboards") {
    // No context list on the phone; the seeded name is the phone chip.
    await expect(page.getByRole("button", { name: DASH_NAME, exact: true })).toBeVisible();
  } else if (routeKey === "pipeline-detail") {
    await seeded(page.locator("main"), PIPELINE_NAME);
    if (phone) await expect(page.locator(".pipeline-detail-page--mobile")).toBeVisible();
    // Absent until access resolves, disabled while the sample loads (and the stamp skips disabled elements).
    const refresh = page.getByRole("button", { name: `Refresh sample of ${SOURCE_NAME}` });
    await expect(refresh).toBeVisible();
    await expect(refresh).toBeEnabled();
  } else {
    await expect(page.locator("main")).toBeVisible();
  }
}
