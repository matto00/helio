import { expect, test, type APIRequestContext, type CDPSession, type Page } from "@playwright/test";

import { FOCUSABLE_SELECTOR } from "./support/stateContrastProbe";
import { forceFocusVisible } from "./support/forceFocusVisible";
import { waitForSettingsAuditTable } from "./support/settingsReady";
import { settleTransitions } from "./support/settleTransitions";
import {
  readIndicatorSnapshot,
  measureOneElement,
  type Finding,
} from "./support/focusPresenceProbe";

// HEL-520 tasks 2.3-2.6c — AC2's actual measurement: does a focusable
// element's DECLARED focus indicator (accessible-focus-indicator/HEL-1050)
// actually PAINT, unclipped, at a conforming contrast — not merely "does
// the source declare one" (focusRingTokenGuard.css.test.ts already covers
// that, see design.md D1c). Occlusion is explicitly OUT of what this spec
// measures — see focusPresenceProbe.ts's module comment for why (a
// document.elementsFromPoint-based sampler was built, found
// methodologically unsound, and removed rather than shipped broken;
// CR3, evaluation-1.md). Reuses stateContrast.mjs's compositing/
// classification core UNCHANGED (parseColor/compositeStack/classifyState)
// and forceFocusVisible's CDP mechanism (design.md D2a: `.focus()` never
// matches `:focus-visible` in Chromium).
//
// D2b — deliberately UNCAPPED: every visible FOCUSABLE_SELECTOR match in
// each enumerated view is measured, not a sampled subset. The view list and
// measured-per-view count are both printed so the coverage claim is legible
// rather than implied (see console.log calls below and files-modified.md
// for the recorded runtime).
//
// Population note: `FOCUSABLE_SELECTOR` (stateContrastProbe.ts, D1d) is
// DELIBERATELY DIFFERENT from `INTERACTIVE_SELECTOR` used by the sibling
// HEL-866 hover/focus-surface guard — this spec answers "can this element
// take keyboard focus and does its indicator paint", not "does this
// element's SURFACE change colour on hover/focus". Do not merge the two
// populations or the two guards; each is scoped to a different question
// (design.md D1d).
const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel520-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-520 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  // HEL-1288: `register` already set the session cookie on `request`'s context; hand it to the
  // page's context and open `/`, instead of re-doing the same login through the UI form in every
  // cell (the guards never test login, and the sessions are identical: same httpOnly cookie).
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Add dashboard" })).toBeVisible();
}

// CR5 (evaluation-1.md) — the coverage claim must be SELF-CHECKING, not
// merely `totalMeasured > 0` (a headline total that seven empty views
// could satisfy). On the sibling HEL-866 guard's `stampDocument`/
// `assertPartitioned` pattern (state-surface-contrast-guard.spec.ts),
// adapted for this spec's simpler single-view-per-route shape (no
// chrome/sidebar-rail split to union): stamp every element THIS spec's
// own filter would accept (visible, enabled, `FOCUSABLE_SELECTOR`-matched)
// with a unique id, sweep as before while recording which ids were
// actually measured, then assert the two sets are equal — naming any
// leftover element loudly rather than letting a route that renders zero
// focusable elements pass silently.
const DOC_ID_ATTR = "data-hel520-doc-id";

async function stampFocusableDocument(page: Page): Promise<number> {
  return page.evaluate(
    ({ selector, attr }) => {
      const els = Array.from(document.querySelectorAll(selector)).filter((el) => {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const disabled =
          (el instanceof HTMLButtonElement && el.disabled) ||
          (el instanceof HTMLInputElement && el.disabled) ||
          el.getAttribute("aria-disabled") === "true";
        return !disabled;
      });
      els.forEach((el, i) => el.setAttribute(attr, String(i)));
      return els.length;
    },
    { selector: FOCUSABLE_SELECTOR, attr: DOC_ID_ATTR },
  );
}

/** Asserts every element `stampFocusableDocument` stamped was measured
 *  (its doc-id is in `coveredIds`). Throws, naming the leftover elements'
 *  identities, if any were not. */
async function assertRouteFullyCovered(
  page: Page,
  label: string,
  totalStamped: number,
  coveredIds: Set<string>,
): Promise<void> {
  // CR-B (evaluation-2.md) — `0 >= 0` let a view rendering zero focusable
  // elements pass silently (a login regression, an error boundary, a
  // seeding change). A per-view non-emptiness floor makes that its own
  // failure, distinct from and in addition to the partition check below.
  if (totalStamped === 0) {
    throw new Error(
      `HEL-520 focus-presence guard: "${label}" rendered ZERO focusable elements — a route that should ` +
        `have real content measured nothing. This is a coverage failure, not a legitimate empty view.`,
    );
  }
  if (coveredIds.size >= totalStamped) return;
  const leftoverIds = await page.evaluate(
    ({ attr, coveredArr }) => {
      const coveredSet = new Set(coveredArr);
      return Array.from(document.querySelectorAll(`[${attr}]`))
        .filter((el) => !coveredSet.has(el.getAttribute(attr) ?? ""))
        .map((el) => {
          const tag = el.tagName.toLowerCase();
          const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/)[0];
          const aria = el.getAttribute("aria-label");
          return `${tag}[${cls || "n/a"}]${aria ? ` aria="${aria}"` : ""}`;
        });
    },
    { attr: DOC_ID_ATTR, coveredArr: Array.from(coveredIds) },
  );
  throw new Error(
    `HEL-520 focus-presence guard: coverage-partition assertion failed for "${label}" — ${totalStamped} ` +
      `focusable element(s) exist in the rendered document, but only ${coveredIds.size} were measured. ` +
      `Uncovered:\n` +
      leftoverIds.map((d) => `  ${d}`).join("\n"),
  );
}

// HEL-1288 — split from ONE serial test (a ~3 min hard floor on any worker/shard) into one
// independently schedulable test per (theme x route) cell, so `--shard` and the 2 workers can
// spread the guard. The measured population is unchanged: the same routes, the same themes, the
// same per-element sweep. `mode: "parallel"` is scoped to this file only and there are NO
// beforeAll/afterAll hooks (hooks would make Playwright chunk the cells back into one group).
// Each cell registers its own fresh user and seeds its own data, so cells share nothing.
// The run-wide `totalMeasured > 0` vacuity floor became a per-cell `measured > 0` (stricter).
const THEMES = ["dark", "light"] as const;
type RouteKey = "/" | "/sources" | "source-detail" | "pipeline-detail" | "/settings";
const ROUTE_KEYS: RouteKey[] = ["/", "/sources", "source-detail", "pipeline-detail", "/settings"];

test.describe("HEL-520 focus-presence guard (AC2)", () => {
  test.describe.configure({ mode: "parallel" });
  test.setTimeout(120_000);

  for (const theme of THEMES) {
    for (const routeKey of ROUTE_KEYS) {
      test(`every focusable element on ${routeKey} presents an unclipped, conforming focus indicator (${theme})`, async ({
        page,
        request,
      }) => {
        const client = await page.context().newCDPSession(page);
        await client.send("DOM.enable");
        await client.send("CSS.enable");

        await registerAndLogin(page, request, "focus-presence");

        // Same minimal seed shape as the sibling HEL-866 guard — a real
        // dashboard, source, and pipeline so /sources, /pipelines and the
        // pipeline-detail route render real rows/fields rather than an empty
        // state with a structurally tiny population (evaluation-2.md CR7).
        // HEL-1288 cycle 4: the dashboard is created over the API (was three UI clicks); the page
        // loads it on its next navigation.
        const dashRes = await request.post("/api/dashboards", {
          data: { name: "HEL-520 Guard Dashboard" },
          headers: { [CSRF_HEADER]: "1" },
        });
        expect(dashRes.status()).toBe(201);

        const sourceRes = await request.post("/api/data-sources", {
          data: {
            name: "HEL-520 Guard Source",
            type: "static",
            columns: [{ name: "amount", type: "integer" }],
            rows: [[10], [20]],
          },
          headers: { [CSRF_HEADER]: "1" },
        });
        expect(sourceRes.status()).toBe(201);
        const source = await sourceRes.json();
        const pipelineRes = await request.post("/api/pipelines", {
          data: { name: "HEL-520 Guard Pipeline", roots: [{ sourceId: source.id }] },
          headers: { [CSRF_HEADER]: "1" },
        });
        expect(pipelineRes.status()).toBe(201);
        const pipeline = await pipelineRes.json();

        // HEL-1080 tasks.md 5.3 (design.md Decision 9): `/sources/:id` for the seeded dataset
        // ("static"-kind) source above, so this guard actually covers `DatasetRowGrid`'s gridMode
        // focus/tabindex markup. Runtime ids are resolved here, inside the cell; the cell title and
        // the logged view name use the static label.
        const routePaths: Record<RouteKey, string> = {
          "/": "/",
          "/sources": "/sources",
          "source-detail": `/sources/${source.id}`,
          "pipeline-detail": `/pipelines/${pipeline.id}`,
          "/settings": "/settings",
        };
        const route = routePaths[routeKey];
        const viewName = `${routeKey}(${theme})`;
        const findings: Finding[] = [];

        // Cycle 8 (production CI, run 34416621152) — a flat `waitForTimeout(200)`
        // after `page.goto(route)` is NOT sufficient to guarantee the seeded
        // content has rendered before the sweep stamps/measures the document
        // (on a clean CI database `/sources` rendered its loading frame at the
        // 200ms mark and the sweep measured zero). Each route below waits for
        // a route-specific marker proving ITS OWN seeded content rendered.
        const ROUTE_READY_MARKERS: Record<RouteKey, (p: Page) => Promise<unknown>> = {
          // `.first()` on each: the seeded name legitimately appears more than
          // once per route (breadcrumb, command palette, list row, etc.).
          "/": (p) =>
            expect(p.getByText("HEL-520 Guard Dashboard", { exact: true }).first()).toBeVisible(),
          "/sources": (p) =>
            expect(p.getByText("HEL-520 Guard Source", { exact: true }).first()).toBeVisible(),
          // The dataset row grid's "Add row" button is always present once `DatasetRowGrid` has
          // resolved the seeded source's declared schema + rows (HEL-1080).
          "source-detail": (p) => expect(p.getByRole("button", { name: "Add row" })).toBeVisible(),
          "pipeline-detail": (p) =>
            expect(p.getByText("HEL-520 Guard Pipeline", { exact: true }).first()).toBeVisible(),
          // "Appearance" is SettingsPage.tsx's first static `<h2>` section
          // heading — always present regardless of account data.
          "/settings": async (p) => {
            await expect(p.getByRole("heading", { name: "Appearance" })).toBeVisible();
            // async-loaded audit-log table: HEL-1336's shared readiness helper.
            await waitForSettingsAuditTable(p);
          },
        };

        // HEL-1288: the theme is stored and then applied by the route's own load (a separate
        // reload on `/` first only re-did that work); the `data-theme` assertion proves it took.
        await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
        await page.goto(route);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await ROUTE_READY_MARKERS[routeKey](page);
        await page.waitForTimeout(200); // settle any post-render CSS transition, not a substitute for the wait above

        const totalStamped = await stampFocusableDocument(page);
        const coveredIds = new Set<string>();
        const handles = await page.locator(FOCUSABLE_SELECTOR).all();
        let measuredThisView = 0;
        for (const handle of handles) {
          const isVisible = await handle.isVisible().catch(() => false);
          if (!isVisible) continue;
          const disabled = await handle
            .evaluate(
              (el) =>
                (el instanceof HTMLButtonElement && el.disabled) ||
                (el instanceof HTMLInputElement && el.disabled) ||
                el.getAttribute("aria-disabled") === "true",
            )
            .catch(() => false);
          if (disabled) continue;

          const docId = await handle
            .evaluate((el, attr) => el.getAttribute(attr), DOC_ID_ATTR)
            .catch(() => null);
          if (docId) coveredIds.add(docId);

          const desc = await handle
            .evaluate((el) => {
              const tag = el.tagName.toLowerCase();
              const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/)[0];
              const aria = el.getAttribute("aria-label");
              return `${tag}[${cls || "n/a"}]${aria ? ` aria="${aria}"` : ""}`;
            })
            .catch(() => "unknown");

          const base = await readIndicatorSnapshot(handle);

          let clearFocus: (() => Promise<void>) | null = null;
          try {
            // Real `.focus()` FIRST, then layer the CDP `:focus-visible`
            // force on top — confirmed live (a real defect this harness
            // itself hit, not the app): several row-hosted triggers
            // (`.dashboard-list__item-row .popover.actions-menu`, the
            // per-row actions-menu trigger) are deliberately clipped to
            // 1x1/`clip: rect(0,0,0,0)` at REST and only reveal via a
            // `:focus-within` rule on an ANCESTOR (a documented, correct
            // `.sr-only`-style keep-focusable-but-hidden pattern — see that
            // rule's own comment in DashboardList.css). `:focus-within`
            // reflects genuine `document.activeElement` state, which
            // `CSS.forcePseudoState` alone never changes (it only affects
            // style *matching* on the exact forced node, not real focus).
            // A real `.focus()` sets `document.activeElement` correctly,
            // so the ancestor `:focus-within` reveal cascades exactly as
            // it does for an actual keyboard user; the CDP force is still
            // required on top because `:focus-visible` (unlike
            // `:focus-within`) is a heuristic real focus alone does not
            // set (design.md D2a). Without the real `.focus()` call, this
            // measurement mis-reported the reveal-on-ancestor-focus
            // pattern as "clipped" — a harness bug, not a live app defect;
            // confirmed by live DOM inspection (ancestor chain has exactly
            // one `overflow: hidden` box, sized 1x1, that a real focus
            // event un-clips).
            await handle.focus();
            clearFocus = await forceFocusVisible(client, handle);
          } catch {
            continue; // not actionable (e.g. detached mid-sweep)
          }
          // 400ms, not 200 -- matches the sibling HEL-866 guard's own
          // margin exactly (theme.css's --app-transition is 0.16s; 400ms
          // gives >2x headroom). Confirmed live this matters here: the
          // skip link's `:focus-visible` rule transitions `top` from
          // -100% to its revealed position (App.css), and a shorter wait
          // caught it mid-transition, producing a false "clipped" finding
          // (this measurement predates occlusion detection's removal —
          // see focusPresenceProbe.ts's module comment — but the
          // transition-timing hazard is the same for any ring-geometry
          // read taken too early).
          // HEL-1288: settled by awaiting the running CSS transitions (including the skip
          // link's `top` transition named above), not a fixed 400 ms sleep.
          await settleTransitions(page);

          // Everything that depends on the REVEALED (focused) DOM state —
          // the forced snapshot itself, ancestor clip boxes, and the
          // backdrop walk — must run BEFORE focus is cleared below, or an
          // ancestor `:focus-within` reveal (see the comment above)
          // collapses back to its resting/clipped shape and every one of
          // those reads silently measures the WRONG state. `finally`
          // guarantees focus is cleared even if a measurement throws or
          // `continue`s early.
          let finding: Finding;
          try {
            finding = await measureOneElement(handle, base, viewName, theme, desc);
          } finally {
            await clearFocus();
            await page
              .evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
              .catch(() => {});
          }
          findings.push(finding);
          measuredThisView++;
        }

        console.log(
          `[HEL-520 focus-presence guard] view "${viewName}": ${measuredThisView} focusable element(s) measured (uncapped)`,
        );
        await assertRouteFullyCovered(page, viewName, totalStamped, coveredIds);

        const failures = findings.filter((f) => f.verdict !== "pass");
        if (failures.length > 0) {
          const grouped = failures
            .map((f) => `  [${f.verdict}] ${f.view} ${f.desc} — ${f.detail}`)
            .join("\n");
          throw new Error(
            `HEL-520 focus-presence guard: ${failures.length}/${measuredThisView} measured element(s) did not present a conforming, unclipped focus indicator:\n${grouped}`,
          );
        }

        expect(measuredThisView).toBeGreaterThan(0);
      });
    }
  }
});
