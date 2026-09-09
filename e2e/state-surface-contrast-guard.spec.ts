import {
  expect,
  test,
  type APIRequestContext,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  CONTRAST_THRESHOLD,
  classifyState,
  compositeStack,
  parseColor,
  type StateVerdict,
} from "./support/stateContrast.mjs";
import { INTERACTIVE_SELECTOR } from "./support/stateContrastProbe";

// HEL-866 — the mechanical, RENDERED state-surface contrast guard (AC5,
// design.md D4). Walks the RUNNING app (not a static parse of theme.css or
// component CSS) enumerating interactive elements straight from the DOM,
// resolves each one's real painted backdrop by walking the rendered
// ancestor chain and accumulating alpha (D4.2), forces real hover/focus,
// alpha-composites the resulting colour over the resolved backdrop (D4.3),
// and fails on any pair measuring below CONTRAST_THRESHOLD (1.10, derived
// in design.md D3 / e2e/support/stateContrast.mjs).
//
// A static/grep design was proposed first and REJECTED at the design gate:
// it resolves the element's OWN base background, which is transparent for
// 72% of state declarations (including .command-palette__item, the exact
// call site HEL-496 fixed) and would require a ~116-entry hand-curated
// allowlist — precisely what AC5 forbids ("a hand-picked component list fed
// to an automated comparator is a manual check wearing a machine's
// clothes"). See design.md D4 for the full rewrite rationale.
//
// RUNTIME BUDGET (task 2.9): 10 views (1 shared chrome view + 6 route
// `<main>` bodies + modal + command palette + one ActionsMenu instance) x 2
// themes x up to MAX_ELEMENTS_PER_VIEW/view (SAMPLED across the full
// visible-match set, not the first N in DOM order) x 2 forced states
// (hover, focus) = a bounded, printed element count per run (task
// 2.7/5.2a), test.setTimeout(360_000) headroom. Single viewport (1440x900):
// no state-background declaration in this tree is @media-gated (verified:
// the app's only background @media overrides govern non-state surfaces),
// so viewport is not a dimension this guard's population varies over —
// recorded as a scope note rather than silently assumed.
//
// evaluation-1.md CR1 — corrected in place. The chrome (command bar +
// sidebar) used to be included in EVERY route's un-scoped `page.locator
// ("body")` query, and `collectCandidates` sliced the first
// MAX_ELEMENTS_PER_VIEW matches in DOM order BEFORE filtering for
// visibility. Chrome renders before `<main>` in the DOM, so ~10 shared
// elements identical on every route crowded out page content — measured
// live on `/settings`: the guard covered 2 of 36 in-`<main>` interactive
// elements (5.5%). Fixed two ways, not one: (1) chrome is now probed
// EXACTLY ONCE per theme, as its own view (`chrome`), scoped to
// `.app-command-bar, .app-sidebar__nav-row`; every route view is scoped to
// `page.locator("main")` so it measures page content only, never chrome.
// (2) `collectCandidates` now visibility-filters the FULL matched set
// first, then SAMPLES evenly across it (not `slice(0, cap)`), and returns
// the true total alongside the sampled count so a route with more elements
// than the cap is visibly under-sampled in the log rather than silently
// truncated from the front. AC2's "complete sweep" is scoped accordingly:
// complete within `<main>` + the named overlays, up to
// MAX_ELEMENTS_PER_VIEW per view (task 5.2a's per-view counts make the
// actual coverage legible rather than implied by a single headline total).
const CSRF_HEADER = "X-Helio-Requested-With";
const MAX_ELEMENTS_PER_VIEW = 24;

function uniqueEmail(label: string): string {
  return `hel866-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-866 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
  await expect(page.getByRole("button", { name: "Add dashboard" })).toBeVisible();
}

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Add dashboard" }).or(page.locator("body")),
  ).toBeVisible();
  await page.waitForTimeout(150); // settle theme-transition CSS (theme.css var(--app-transition))
}

interface Backdrop {
  layers: { bg: string }[];
  resolved: boolean;
}

interface Snapshot {
  ownBg: string;
  afterBg: string;
  beforeBg: string;
  boxShadow: string;
  borderColor: string;
  outlineColor: string;
}

async function readBackdrop(locator: Locator): Promise<Backdrop> {
  return locator.evaluate((el) => {
    const layers: { bg: string }[] = [];
    let node: Element | null = el.parentElement;
    let resolved = false;
    let guard = 0;
    while (node && guard < 64) {
      guard++;
      const style = window.getComputedStyle(node);
      if (style.opacity !== "" && parseFloat(style.opacity) < 1) {
        return { layers, resolved: false };
      }
      // evaluation-2.md cycle 3 — only bail to "unresolved" when this
      // ancestor's OWN background-color is itself non-transparent (a real
      // gradient/photo painted with an opaque-ish base, where compositing
      // genuinely is ill-defined). `<main class="app-content">` (every
      // route) carries `theme.css`'s neutral canvas dot-field texture
      // (`background-image: radial-gradient(rgba(...,0.07) 1px, ...)`) on
      // a fully TRANSPARENT `background-color` — confirmed live. That
      // layer contributes nothing opaque of its own; the walk must
      // continue past it to the real solid colour beneath (`--app-bg` on
      // an ancestor further up), or it silently reports "unresolved" for
      // EVERY element on EVERY route (this is what hid evaluation-2.md
      // CR6's `.source-list-table__row` regression: it measured
      // "unresolved", not "fail", so the guard never surfaced it at all).
      const bgColorHere = style.backgroundColor;
      const hasOpaqueishColor =
        bgColorHere && bgColorHere !== "rgba(0, 0, 0, 0)" && bgColorHere !== "transparent";
      if (style.backgroundImage && style.backgroundImage !== "none" && hasOpaqueishColor) {
        return { layers, resolved: false };
      }
      const bg = style.backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        layers.push({ bg });
        if (/^rgb\(/.test(bg.trim())) {
          resolved = true;
          break;
        }
      }
      node = node.parentElement;
    }
    return { layers, resolved };
  });
}

async function readSnapshot(locator: Locator): Promise<Snapshot> {
  return locator.evaluate((el) => {
    const own = window.getComputedStyle(el);
    const after = window.getComputedStyle(el, "::after");
    const before = window.getComputedStyle(el, "::before");
    return {
      ownBg: own.backgroundColor,
      afterBg: after.backgroundColor,
      beforeBg: before.backgroundColor,
      boxShadow: own.boxShadow,
      borderColor: own.borderColor,
      outlineColor: own.outlineColor,
    };
  });
}

function describeElement(el: {
  tag: string;
  role: string | null;
  text: string;
  index: number;
  className: string;
  ariaLabel: string | null;
}) {
  // evaluation-1.md CR5 — the bracketed token is the STABLE-IDENTITY one
  // exemptions match on, never `#index` (which shifts if any element
  // upstream in DOM order is added/removed and would silently exempt a
  // different, unrelated element next time this file is touched). Always
  // the first CSS class, not aria-label: a family of same-class buttons
  // (e.g. the 8 accent-picker swatches, each with its own colour-name
  // aria-label) needs ONE matchable identity across the whole family, which
  // only the shared class gives; aria-label is still carried in the
  // description text for human debugging, just not as the match key.
  const identity = el.className.split(/\s+/).filter(Boolean)[0] ?? "n/a";
  const ariaSuffix = el.ariaLabel ? ` aria="${el.ariaLabel}"` : "";
  return `${el.tag}${el.role ? `[role=${el.role}]` : ""} "${el.text}"${ariaSuffix} [${identity}] (#${el.index})`;
}

/**
 * Forces `:focus-visible` (and `:focus`) on `locator`'s element via the
 * Chrome DevTools Protocol's `CSS.forcePseudoState`, rather than
 * `locator.focus()`. Playwright/Chromium's `.focus()` performs a real
 * programmatic focus, but Chromium's own focus-visible heuristic does NOT
 * treat a programmatic focus as keyboard-originated, so it never matches
 * `:focus-visible` — confirmed the hard way: every `:focus-visible`-based
 * rule in this app (the dominant focus-state pattern here, e.g.
 * `.command-palette__item:focus-visible`) read as "nothing changed" under
 * plain `.focus()`, which would have been 100% FALSE FAILURES across the
 * whole focus-state population, not real absences. `CSS.forcePseudoState`
 * is the same mechanism DevTools' own "Force state" panel uses and is the
 * only reliable way to render the TRUE `:focus-visible` styling without a
 * real keyboard Tab sequence per element (which the runtime budget, task
 * 2.9, does not allow).
 */
async function forceFocusVisible(
  client: CDPSession,
  locator: Locator,
): Promise<() => Promise<void>> {
  const marker = "data-hel866-force-focus";
  await locator.evaluate((el, m) => el.setAttribute(m, "1"), marker);
  const { root } = await client.send("DOM.getDocument");
  const { nodeId } = await client.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: `[${marker}]`,
  });
  await client.send("CSS.forcePseudoState", {
    nodeId,
    forcedPseudoClasses: ["focus", "focus-visible"],
  });
  return async () => {
    try {
      await client.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
    } catch {
      // element may have detached (overlay closed) — nothing to clear.
    }
    await locator.evaluate((el, m) => el.removeAttribute(m), marker).catch(() => {});
  };
}

interface ElementResult {
  view: string;
  theme: string;
  desc: string;
  forced: "hover" | "focus";
  verdict: StateVerdict;
  ratio: number | null;
}

interface CandidateInfo {
  locator: Locator;
  tag: string;
  role: string | null;
  text: string;
  index: number;
  className: string;
  ariaLabel: string | null;
  docId: string | null;
}

const DOC_ID_ATTR = "data-hel866-doc-id";

/**
 * evaluation-3.md CR2 / skeptic-final-1.md CR3 / skeptic-final-1B.md CR2 —
 * THE STRUCTURAL FIX. The guard's view list (chrome / route / overlay) was
 * hand-enumerated three separate times (cycle 1's 12-element cap, cycle 3's
 * `tbody tr`/canvas-texture misses, and this cycle's sidebar-rail /
 * `/pipelines/:id` gap) and each time something real shipped through
 * whatever the list happened to omit — a hand-listed set of VIEWS is the
 * same hand-picked-input-set failure AC5 forbids at the element level, one
 * layer up. This makes the coverage claim SELF-CHECKING instead of trusting
 * the list: stamp every visible, enabled, `INTERACTIVE_SELECTOR`-matched
 * element in the CURRENT rendered document with a unique id, then after
 * probing every view this route/overlay declares, assert the union of
 * "covered" ids equals the full stamped set. A leftover element — one this
 * run's view list did not name — FAILS LOUDLY, naming it, rather than
 * silently never being measured (which is exactly how `.dashboard-list__
 * button` and `/pipelines/:id`'s step-card buttons shipped broken).
 */
async function stampDocument(page: Page): Promise<number> {
  return page.evaluate(
    ({ selector, attr }) => {
      const els = Array.from(document.querySelectorAll(selector)).filter((el) => {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const disabled =
          (el instanceof HTMLButtonElement && el.disabled) ||
          el.getAttribute("aria-disabled") === "true";
        return !disabled;
      });
      els.forEach((el, i) => el.setAttribute(attr, String(i)));
      return els.length;
    },
    { selector: INTERACTIVE_SELECTOR, attr: DOC_ID_ATTR },
  );
}

/**
 * Asserts every element stamped by `stampDocument` for the CURRENT document
 * state was covered by at least one of `coveredDocIdSets` (one per view
 * probed against this same document state). Throws, naming the leftover
 * elements' identities, if any were not — this is what actually enforces
 * "the whole document is partitioned", not merely documented as an intent.
 */
async function assertPartitioned(
  page: Page,
  label: string,
  totalStamped: number,
  coveredDocIdSets: Set<string>[],
): Promise<void> {
  const covered = new Set<string>();
  for (const s of coveredDocIdSets) for (const id of s) covered.add(id);
  if (covered.size >= totalStamped) return;
  const leftoverIds = await page.evaluate(
    ({ attr, coveredArr }) => {
      const coveredSet = new Set(coveredArr);
      return Array.from(document.querySelectorAll(`[${attr}]`))
        .filter((el) => !coveredSet.has(el.getAttribute(attr) ?? ""))
        .map((el) => {
          const tag = el.tagName.toLowerCase();
          const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/)[0];
          const text = (el.textContent ?? "").trim().slice(0, 30);
          const aria = el.getAttribute("aria-label");
          return `${tag}[${cls || "n/a"}]${aria ? ` aria="${aria}"` : ""} "${text}"`;
        });
    },
    { attr: DOC_ID_ATTR, coveredArr: Array.from(covered) },
  );
  throw new Error(
    `HEL-866 guard: partition assertion failed for "${label}" — ${totalStamped} interactive elements exist in the rendered document, but only ${covered.size} were covered by a declared view. Uncovered (not measured by ANY view — this is a real population gap, not a sampling artifact):\n` +
      leftoverIds.map((d) => `  ${d}`).join("\n"),
  );
}

/**
 * evaluation-1.md CR1 — visibility-filters the FULL matched set first
 * (never slices before filtering), then SAMPLES EVENLY across it if it
 * exceeds `cap`, rather than taking the first N in DOM order (which let
 * shared chrome, which always renders first, crowd out page content).
 * Returns the true visible total alongside the sampled candidates so a
 * route with more elements than the cap is visibly under-sampled in the
 * log (task 5.2a), not silently truncated from the front.
 */
async function collectCandidates(
  page: Page,
  scope?: Locator,
  cap = MAX_ELEMENTS_PER_VIEW,
  excludeSelector?: string,
): Promise<{ candidates: CandidateInfo[]; totalVisible: number; docIds: Set<string> }> {
  const root = scope ?? page.locator("body");
  const handles = await root.locator(INTERACTIVE_SELECTOR).all();
  const visible: CandidateInfo[] = [];
  const docIds = new Set<string>();
  for (let i = 0; i < handles.length; i++) {
    const loc = handles[i];
    const isVisible = await loc.isVisible().catch(() => false);
    if (!isVisible) continue;
    const info = await loc.evaluate(
      (el, { idx, docIdAttr, excludeSel }) => {
        if (excludeSel && el.closest(excludeSel)) {
          return { excluded: true } as const;
        }
        return {
          excluded: false as const,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role"),
          text: (el.textContent ?? "").trim().slice(0, 40),
          className: typeof el.className === "string" ? el.className : "",
          ariaLabel: el.getAttribute("aria-label"),
          docId: el.getAttribute(docIdAttr),
          // Real DOM disabled state (HTMLButtonElement.disabled / aria-
          // disabled), not a CSS class guess — a disabled control's own CSS
          // is `:hover:not(:disabled)` by convention across this app
          // (confirmed at every real instance this run hit: AddSourceModal's
          // "Test connection"/"Preview schema", ApiTokensSection's "Create
          // token", BetaAccessSection's "Redeem code" — all disabled at
          // rest by design, not silent absences).
          disabled:
            (el instanceof HTMLButtonElement && el.disabled) ||
            el.getAttribute("aria-disabled") === "true",
          index: idx,
        };
      },
      { idx: i, docIdAttr: DOC_ID_ATTR, excludeSel: excludeSelector },
    );
    if (info.excluded || info.disabled) continue;
    if (info.docId) docIds.add(info.docId);
    visible.push({ locator: loc, ...info });
  }
  if (visible.length <= cap) {
    return { candidates: visible, totalVisible: visible.length, docIds };
  }
  // Even-stride sample across the whole visible set (not the first `cap`)
  // so page content past the chrome's element count is represented too.
  const stride = visible.length / cap;
  const sampled: CandidateInfo[] = [];
  for (let i = 0; i < cap; i++) {
    sampled.push(visible[Math.floor(i * stride)]);
  }
  // docIds already covers every VISIBLE element regardless of sampling — the
  // partition assertion cares about coverage-by-a-view, not coverage-by-a-
  // MEASUREMENT, so a sampled-out element still counts as "in this view".
  return { candidates: sampled, totalVisible: visible.length, docIds };
}

/** Runs the full contrast probe (backdrop + before/during, both hover and
 *  focus) against every candidate in `view` under the current theme, and
 *  accumulates results into `results`/`counts`. */
async function probeView(
  page: Page,
  client: CDPSession,
  viewName: string,
  theme: string,
  scope: Locator | undefined,
  results: ElementResult[],
  counts: { resolved: number; unresolved: number; pass: number; fail: number; advisory: number },
  excludeSelector?: string,
): Promise<Set<string>> {
  const { candidates, totalVisible, docIds } = await collectCandidates(
    page,
    scope,
    MAX_ELEMENTS_PER_VIEW,
    excludeSelector,
  );
  // Task 5.2a — per-view visible/sampled counts, printed unconditionally so
  // a population collapse is visible in the log rather than hidden behind
  // a single run-wide total (evaluation-1.md CR1).
  console.log(
    `[HEL-866 guard] view "${viewName}" (${theme}): ${totalVisible} visible interactive element(s), sampled ${candidates.length}`,
  );
  for (const cand of candidates) {
    const backdrop = await readBackdrop(cand.locator);
    const base = await readSnapshot(cand.locator);

    for (const forced of ["hover", "focus"] as const) {
      let clearFocus: (() => Promise<void>) | null = null;
      try {
        if (forced === "hover") {
          // Cycle 4 — several row-hosted triggers (e.g. `.dashboard-list__
          // item-row .actions-menu__trigger`, and its `SourceListTable`/
          // `PipelinesPage` siblings, all newly reachable via the sidebar-
          // rail view) are clipped to a 1x1 box until their PARENT row's
          // own `:hover` reveals them (`DashboardList.css`) — hovering the
          // trigger directly, even with `force: true`, never triggers the
          // row's `:hover`, so the trigger's own hover styling never
          // engages and the probe reads a false "nothing changed". Hover
          // the immediate parent first (harmless where it isn't needed) so
          // any such reveal-on-ancestor-hover state actually activates.
          await cand.locator
            .locator("xpath=..")
            .hover({ force: true, timeout: 1000 })
            .catch(() => {});
          await cand.locator.hover({ force: true, timeout: 2000 });
        } else {
          clearFocus = await forceFocusVisible(client, cand.locator);
        }
      } catch {
        continue; // element not actionable for this state — skip, not a false pass
      }
      // Settle the transition before reading (design.md D4/"Repeat for
      // every theme"; theme.css's --app-transition is 0.16s — mid-
      // transition, Chromium serializes the interpolated colour as
      // `oklab(...)` rather than `rgb()`/`color(srgb ...)` (confirmed by
      // direct probe against this app), which stateContrast.mjs's
      // parseColor correctly refuses to guess at rather than mis-reading.
      // 400ms gives >2x margin over the declared 0.16s duration.
      await page.waitForTimeout(400);
      const state = await readSnapshot(cand.locator);
      // Reset WITHOUT Escape: an open overlay (command palette, modal,
      // ActionsMenu) treats Escape as "close me", which would detach every
      // remaining candidate in that view and hang subsequent `.evaluate()`
      // calls waiting on a now-gone element (confirmed the hard way — see
      // this comment's own history). Moving the mouse off-element and
      // blurring is enough to clear :hover/:focus-visible without
      // disturbing the overlay itself.
      await page.mouse.move(0, 0);
      await page
        .evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
        .catch(() => {});
      if (clearFocus) await clearFocus();

      const ownChanged = state.ownBg !== base.ownBg;
      const afterChanged = state.afterBg !== base.afterBg;
      const beforeChanged = state.beforeBg !== base.beforeBg;
      const backgroundChanged = ownChanged || afterChanged || beforeChanged;
      const otherChannelChanged =
        state.boxShadow !== base.boxShadow ||
        state.borderColor !== base.borderColor ||
        state.outlineColor !== base.outlineColor;

      const desc = describeElement(cand);

      if (!backdrop.resolved && backgroundChanged) {
        counts.unresolved++;
        results.push({
          view: viewName,
          theme,
          desc,
          forced,
          verdict: "unresolved" as StateVerdict,
          ratio: null,
        });
        continue;
      }

      if (!backgroundChanged) {
        counts.resolved++;
        const { verdict } = classifyState({
          backgroundChanged: false,
          otherChannelChanged,
          backdrop: parseColor("rgb(0,0,0)"),
          stateColor: parseColor("rgb(0,0,0)"),
        });
        if (verdict === "fail") counts.fail++;
        else counts.advisory++;
        results.push({ view: viewName, theme, desc, forced, verdict, ratio: null });
        continue;
      }

      counts.resolved++;
      const backdropLayers = backdrop.layers.map((l) => parseColor(l.bg));
      const backdropOpaque = compositeStack(
        backdropLayers.length ? backdropLayers : [parseColor("rgb(255,255,255)")],
      );
      const rawStateColor = ownChanged
        ? state.ownBg
        : afterChanged
          ? state.afterBg
          : state.beforeBg;
      const stateLayer = parseColor(rawStateColor);
      const compositedState = compositeStack([stateLayer, ...backdropLayers]);

      const { verdict, ratio } = classifyState({
        backgroundChanged: true,
        otherChannelChanged,
        backdrop: backdropOpaque,
        stateColor: compositedState,
        threshold: CONTRAST_THRESHOLD,
      });
      if (verdict === "pass") counts.pass++;
      else if (verdict === "fail") counts.fail++;
      else counts.advisory++;
      results.push({ view: viewName, theme, desc, forced, verdict, ratio });
    }
  }
  return docIds;
}

test.describe("HEL-866 state-surface contrast guard", () => {
  test.setTimeout(360_000);

  test("every interactive state background differs measurably from its resolved backdrop, in every theme", async ({
    page,
    request,
  }) => {
    const client = await page.context().newCDPSession(page);
    await client.send("DOM.enable");
    await client.send("CSS.enable");

    await registerAndLogin(page, request, "guard");

    // Give the account one dashboard so the ActionsMenu row overlay exists.
    await page.getByRole("button", { name: "Add dashboard" }).click();
    await page.getByLabel("Dashboard name").fill(`HEL-866 Guard Dashboard`);
    await page.getByRole("button", { name: "Create dashboard" }).click();
    const dashName = "HEL-866 Guard Dashboard";
    await expect(page.getByRole("button", { name: dashName, exact: true })).toBeVisible();

    // evaluation-2.md CR7 — a fresh account renders every list/table view
    // (/sources, /pipelines) as an EMPTY STATE, so the guard's population on
    // those routes was structurally 1 element regardless of the walk logic
    // (measured live in a populated account: /sources has 98 visible
    // interactive elements; a fresh account has 1). Table/list/card row
    // families — exactly where evaluation-2.md CR6 found real regressions
    // — never entered the walk at all. Seeded the same way `e2e/hel908-
    // full-flow.spec.ts` does (a real API-created static source + a
    // pipeline rooted on it), so /sources and /pipelines render a real row.
    const sourceRes = await request.post("/api/data-sources", {
      data: {
        name: "HEL-866 Guard Source",
        type: "static",
        columns: [
          { name: "amount", type: "integer" },
          { name: "category", type: "string" },
        ],
        rows: [
          [10, "a"],
          [20, "b"],
        ],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(sourceRes.status()).toBe(201);
    const source = await sourceRes.json();
    const pipelineRes = await request.post("/api/pipelines", {
      data: { name: "HEL-866 Guard Pipeline", roots: [{ sourceId: source.id }] },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = await pipelineRes.json();
    // skeptic-final-2.md / skeptic-final-2B.md CR2 — a pipeline with only a
    // root and no steps renders NO `.pipeline-detail-page__step-card` at
    // all (confirmed live: the earlier `--expanded`-branch fix's toggle
    // click silently no-op'd on a 0-count locator, wrapped in `if (await
    // toggle.count())`, so the mutation proof below would have gone
    // unnoticed without this). A real `limit` step gives the route a real
    // step card to expand.
    const stepRes = await request.post(`/api/pipelines/${pipeline.id}/steps`, {
      data: { type: "limit", config: { count: 2 } },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(stepRes.status()).toBe(201);

    const results: ElementResult[] = [];
    const counts = { resolved: 0, unresolved: 0, pass: 0, fail: 0, advisory: 0 };
    // skeptic-final-1.md CR3 — `/pipelines/:id` is a route this diff's own
    // CSS changes (PipelineDetailPage.css) render on, and was previously
    // absent from this list; the seeded pipeline's id makes it reachable.
    // `/sources/:id` and the `*/review` routes remain deliberately excluded
    // — named here rather than left implicit, per design.md D6.2.
    const routes = [
      "/",
      "/sources",
      "/pipelines",
      `/pipelines/${pipeline.id}`,
      "/connectors",
      "/chat",
      "/settings",
    ];

    for (const theme of ["dark", "light"] as const) {
      await setTheme(page, theme);

      // evaluation-1.md CR1 — chrome (command bar + sidebar) is probed
      // EXACTLY ONCE per theme, as its own view, instead of being re-swept
      // inside every route's un-scoped query (where it used to crowd out
      // page content). `.app-sidebar` itself is NOT the scope root — it
      // wraps BOTH the page-invariant nav (`.app-sidebar__nav-row`, links +
      // collapse toggle) AND a per-route rail region (e.g. the Data
      // Sources list on `/sources`) that is real page content, confirmed by
      // direct DOM inspection. Scoping to the whole `.app-sidebar` leaked
      // that rail's buttons into "chrome" (and, being probed once on `/`
      // only, made them measure the WRONG route's rail). `.app-command-bar,
      // .app-sidebar__nav-row` queries `INTERACTIVE_SELECTOR` within both
      // and unions the matches — nav links + collapse toggle only.
      // Cycle 4 — the partition assertion's first real catch: `.app-skip-
      // link` (route-invariant, off-screen-until-focused) sits as a
      // SIBLING BEFORE `.app-shell`, not inside `.app-command-bar`/
      // `.app-sidebar__nav-row`, so it could not be reached by scoping to
      // those two containers directly (a container-locator's own matched
      // roots are never themselves included in `root.locator(...)`'s
      // descendant search). Scoped to `body` instead, excluding `<main>`
      // and the sidebar's non-nav-row rail (probed separately below) —
      // this reaches the skip link, the command bar, and the sidebar nav
      // row without re-including page content.
      const CHROME_EXCLUDE = "main, .app-sidebar > :not(.app-sidebar__nav-row)";
      const chromeScope = page.locator("body");
      await page.goto("/");
      await expect(page.locator(".app-command-bar")).toBeVisible();
      await page.waitForTimeout(200);
      await probeView(page, client, "chrome", theme, chromeScope, results, counts, CHROME_EXCLUDE);

      // skeptic-final-1B.md CR1/CR2 — `.app-sidebar` wraps the page-
      // invariant nav row (probed above as "chrome") AND a per-route
      // content rail (`SidebarBody` → e.g. `DashboardList`) that is real
      // page content and was previously in NO view at all: neither
      // "chrome" (which explicitly excludes it) nor the route's `<main>`
      // scope (the rail renders inside `<aside>`, not `<main>`). Probed
      // per route, scoped to `.app-sidebar` with the nav row excluded (via
      // `el.closest()`, not re-probed) so this view's population is
      // exactly the rail, not a duplicate of "chrome".
      for (const route of routes) {
        await page.goto(route);
        // `location.href` re-checked before every reading, per CON-165.
        await expect(page).toHaveURL(
          new RegExp(`${route === "/" ? "/$" : route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
        );
        await page.waitForTimeout(200);

        // skeptic-final-2.md / skeptic-final-2B.md CR2 — `/pipelines/:id`
        // was previously visited only in its DEFAULT (collapsed) DOM state,
        // so the `--expanded` step-card branch (exactly where this
        // cycle's regression shipped) was exercised by no gate. Expand the
        // one seeded step card before probing this route so that state
        // enters the population too — an interaction-gated component
        // state, not a hand-enumerated one.
        if (route === `/pipelines/${pipeline.id}`) {
          // Asserted, not conditionally skipped (`if (await toggle.count())`
          // silently no-op'd here once already, when the seeded pipeline
          // had zero steps and this toggle never existed — the exact
          // silent-skip shape CR8 already forbade for the ActionsMenu
          // overlay). A missing toggle now fails the whole run loudly.
          const toggle = page.locator(".pipeline-detail-page__step-card-toggle").first();
          await expect(toggle).toHaveCount(1);
          await toggle.click();
          await expect(page.locator(".pipeline-detail-page__step-card--expanded")).toHaveCount(1);
        }

        // skeptic-final-1.md CR3 / skeptic-final-1B.md CR2 — THE STRUCTURAL
        // FIX: stamp every visible/enabled interactive element in this
        // route's rendered document, probe every declared view against it,
        // then assert nothing was left uncovered. A hand-enumerated view
        // list (chrome / sidebar-rail / main) is exactly the same hand-
        // picked-input-set AC5 forbids at the element level — this makes
        // that list self-checking instead of trusted.
        const totalStamped = await stampDocument(page);
        const sidebarRailDocIds = await probeView(
          page,
          client,
          `${route}:sidebar-rail`,
          theme,
          page.locator(".app-sidebar"),
          results,
          counts,
          ".app-sidebar__nav-row",
        );
        const main = page.locator("main");
        await expect(main).toBeVisible();
        const mainDocIds = await probeView(page, client, route, theme, main, results, counts);
        // Chrome's coverage on THIS route's fresh stamp — collected (not
        // re-probed; hover/focus already measured once, on "/") purely to
        // credit chrome's elements as covered for the partition check.
        const { docIds: chromeCoverageHere } = await collectCandidates(
          page,
          chromeScope,
          MAX_ELEMENTS_PER_VIEW,
          CHROME_EXCLUDE,
        );
        await assertPartitioned(page, route, totalStamped, [
          chromeCoverageHere,
          sidebarRailDocIds,
          mainDocIds,
        ]);
      }

      // Overlay: command palette (this ticket's canonical defect surface).
      await page.goto("/");
      await page.waitForTimeout(150);
      await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
      const palette = page.locator(".command-palette[open]");
      await expect(palette).toHaveCount(1);
      await page.waitForTimeout(150);
      await probeView(page, client, "command-palette", theme, palette, results, counts);
      await page.keyboard.press("Escape");
      await expect(palette).toHaveCount(0);

      // Overlay: modal (AddSourceModal, on /sources) — this ticket's other
      // canonical defect surface. NOTE: DashboardList's "Add dashboard"
      // control is an INLINE form (`<form className="dashboard-list__
      // create">`), not a `<Modal>`/native `<dialog>` — confirmed by direct
      // probe (0 open dialogs after clicking it) — so it does not exercise
      // the modal-hosted population this task requires; AddSourceModal
      // does (`frontend/src/features/sources/ui/AddSourceModal.tsx`, a
      // real `<Modal>`/`<dialog>`).
      await page.goto("/sources");
      const addSourceTrigger = page.getByRole("button", { name: "Add source" }).first();
      await expect(addSourceTrigger).toBeVisible();
      await addSourceTrigger.click();
      const modal = page.getByRole("dialog").filter({ visible: true }).first();
      await expect(modal).toBeVisible();
      await page.waitForTimeout(150);
      await probeView(page, client, "modal:add-source", theme, modal, results, counts);
      await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);
      await page.waitForTimeout(150);

      // Overlay: ActionsMenu (dashboard row). evaluation-2.md CR8 — this
      // used to be looked up while still on `/sources` (the previous
      // block's route), where the dashboard-row trigger never renders; the
      // lookup was wrapped in `if (await trigger.count())`, so the miss was
      // silently indistinguishable from a pass and this documented view
      // never actually ran. Navigate to `/`, where the dashboard row
      // genuinely renders, and assert the trigger exists rather than
      // conditionally skipping — a missing overlay now fails loudly.
      await page.goto("/");
      await expect(page.getByRole("button", { name: dashName, exact: true })).toBeVisible();
      const row = page.locator(".dashboard-list__item-row", { hasText: dashName });
      await expect(row).toHaveCount(1);
      const trigger = row.locator(`button[aria-label="${dashName} actions"]`);
      await expect(trigger).toHaveCount(1);
      // DashboardList.css clips the trigger to a 1x1 box until
      // `.dashboard-list__item-row:hover` (or `:focus-within`) reveals it —
      // hovering the TRIGGER itself (which a `force: true` click also
      // bypasses) is not enough, because the row's own `:hover` is what
      // actually undoes the clip; hover the row first.
      await row.hover();
      await expect(trigger).toBeVisible();
      await trigger.click();
      const menu = page
        .locator("[role=menu], .actions-menu__panel")
        .filter({ visible: true })
        .first();
      await expect(menu).toBeVisible();
      await page.waitForTimeout(150);
      await probeView(page, client, "actions-menu", theme, menu, results, counts);
      await page.keyboard.press("Escape");
    }

    // Task 2.7 — report resolved/unresolved and pass/fail/advisory counts
    // BEFORE remediation is evaluated. Printed unconditionally so a CI log
    // always carries this even when the run is green.
    //
    // skeptic-final-1.md CR5 / skeptic-final-1B.md CR3 — "N probed" is NOT
    // the same claim as "N asserted": `advisory` verdicts gate nothing
    // (D4a — a legitimate border/outline/shadow-only design, HEL-1044's
    // call, not this ticket's). Printing pass/advisory/exempt as a fraction
    // of probed makes that bound legible at the point a reader meets the
    // number, rather than requiring them to cross-reference the `advisory`
    // field themselves.
    const assertedFraction = (
      ((counts.pass + counts.fail) / Math.max(1, results.length)) *
      100
    ).toFixed(0);
    console.log(
      `[HEL-866 guard] elements probed: ${results.length}, resolved=${counts.resolved}, ` +
        `unresolved=${counts.unresolved}, pass=${counts.pass}, fail=${counts.fail}, ` +
        `advisory=${counts.advisory} — ${assertedFraction}% of probes are pass/fail-ASSERTED ` +
        `(the rest is advisory: a channel other than background conveyed the state, gates nothing here).`,
    );

    // Task 2.7 — "any exemption is a reviewed diff entry with a written
    // reason", never a bulk allowlist. These three are the ONLY exemptions
    // in this run, each independently confirmed by reading the real
    // component CSS, not guessed:
    //   1. `.accent-picker__swatch` (Settings, accent colour picker) — its
    //      hover feedback is `transform: scale(1.15)` (AccentPicker.css).
    //      Transform is a real, deliberate, visible state channel; this
    //      guard's D4a classifier (background/border/outline/box-shadow,
    //      per design.md) does not measure it, so it reads as "nothing
    //      changed" — a guard LIMITATION (routed as a D6 finding in the
    //      PR), not an app defect.
    //   2. The command-palette result row for the query's only/default
    //      match, and 3. AddSourceModal's default-selected "REST API" type
    //      tab — both already carry `[data-active="true"]`/`--selected`
    //      styling identical to their `:hover` styling AT REST (before any
    //      interaction), so hovering produces no INCREMENTAL change. The
    //      element is not silent — it already shows the state visually —
    //      this is a before/after-diff probe limitation for an
    //      already-active resting state, not the D4a "conveys nothing at
    //      all" absence this guard exists to catch.
    //   4. `.pipeline-detail-page__tab` (Steps/Outputs tabs on
    //      `/pipelines/:id`, newly reached by cycle 4's route addition) —
    //      its hover feedback is a text COLOUR change only
    //      (`color: var(--app-text-muted)` → `var(--app-text)`); the active
    //      state's own indicator is a `border-bottom` underline, a
    //      deliberate, visible, non-background channel (design.md's tab
    //      convention). This guard's D4a classifier (background/border/
    //      outline/box-shadow) does not track plain `color`, so it reads
    //      as "nothing changed" — the same guard LIMITATION shape as
    //      #1 (a real, visible channel outside what this guard measures),
    //      not an app defect.
    // evaluation-1.md CR5 / evaluation-2.md CR9 — keyed on STABLE IDENTITY
    // (the `[class]` token `describeElement` always emits), never on
    // `#index`: an ordinal shifts if any element upstream in DOM order
    // changes, which would silently exempt a different, unrelated element
    // next time — the curated-allowlist failure mode AC5 exists to forbid,
    // arriving by accident rather than by intent. All exemptions below key
    // on the bracketed `[class]` token (never rendered text), matching what
    // files-modified.md documents — evaluation-2.md CR9 caught a real drift
    // where two of the original three still matched on text.
    const isExempt = (r: ElementResult) =>
      r.forced === "hover" &&
      (r.desc.includes("[accent-picker__swatch]") ||
        r.desc.includes("[command-palette__item]") ||
        r.desc.includes("[add-source-modal__type-btn]") ||
        r.desc.includes("[pipeline-detail-page__tab]"));

    const failures = results.filter((r) => r.verdict === "fail" && !isExempt(r));
    const exempted = results.filter((r) => r.verdict === "fail" && isExempt(r));
    if (exempted.length > 0) {
      console.log(
        `[HEL-866 guard] ${exempted.length} reviewed exemption(s) applied (see the isExempt comment above):\n` +
          exempted.map((f) => `  [${f.theme}] ${f.view} :: ${f.desc} (${f.forced})`).join("\n"),
      );
    }
    if (failures.length > 0) {
      const lines = failures.map(
        (f) => `  [${f.theme}] ${f.view} :: ${f.desc} (${f.forced}) — ratio=${f.ratio ?? "n/a"}`,
      );
      throw new Error(
        `HEL-866 guard: ${failures.length} state(s) failed the ${CONTRAST_THRESHOLD} contrast threshold:\n${lines.join("\n")}`,
      );
    }

    // Ceiling check (task 2.7): an unresolved fraction this large means the
    // walk itself is defective, not that the tree needs exemptions.
    const unresolvedFraction = counts.unresolved / Math.max(1, counts.resolved + counts.unresolved);
    expect(unresolvedFraction).toBeLessThan(0.5);
  });
});
