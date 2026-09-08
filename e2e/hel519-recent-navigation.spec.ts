import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-519 — real-browser proof that recording ACTUALLY FIRES, per design.md's central hazard:
// a feature that records nothing is indistinguishable on screen from an empty history, and a
// fixture-fed (store-seeded) test proves ordering logic and nothing about observation. Every
// assertion below drives a real arrival (list click / direct URL / reload / back-forward /
// palette) and reads the palette's rendered Recent section afterward — never seeds
// `recentHistoryStore` directly. Follows the shape of e2e/hel510-keyboard-shortcuts.spec.ts /
// e2e/hel516-palette-quick-create.spec.ts.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel519-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

// tasks.md 6.2 — this file's OWN copy of the post-mount precondition wait, not a shared helper.
// `c317e244` fixed only 2 of 8 duplicated copies across the suite; omitting it here reintroduces
// the mount-timing race that took main red (a global shortcut fired before `useShortcut`'s
// window listener attaches, immediately post-navigation).
async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-519 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
  await expect(page.getByRole("button", { name: "Add dashboard" })).toBeVisible();
}

async function createStaticSource(request: APIRequestContext, name: string) {
  const res = await request.post("/api/data-sources", {
    data: { name, type: "static", columns: [{ name: "amount", type: "integer" }], rows: [[1]] },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

async function createPipeline(request: APIRequestContext, name: string, sourceId: string) {
  const res = await request.post("/api/pipelines", {
    data: { name, roots: [{ sourceId }] },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

async function openPalette(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect
    .poll(
      async () => {
        await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
        return page.locator(".command-palette[open]").count();
      },
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);
}

function recentGroupLabel(page: Page) {
  return page.locator(".command-palette__group-label", { hasText: "Recent" });
}

// skeptic-final-1.md CR1 — this helper predates the title-persistence fix and its ORIGINAL
// comment (removed) claimed resolving a title needed that kind's slice loaded into Redux,
// documenting a real limitation without ever flagging it as broken. It no longer needs to be
// true for correctness (an entry's title is now persisted at record time — see
// `recentHistoryStore.ts`'s `RecentEntry.title`), but this helper is kept anyway as the more
// realistic "how a user actually moves around the app" path, and because a full `page.goto`
// resets the app's client-side sidebar collapse/scroll state along with everything else.
async function navigateViaSidebar(page: Page, linkName: string) {
  await page.getByRole("link", { name: linkName, exact: true }).first().click();
}

test.describe("HEL-519 recent navigation — recording fires in a real browser", () => {
  // Matrix cell: source, list click.
  test("visiting a source from its list records it under Recent", async ({ page, request }) => {
    await registerAndLogin(page, request, "source-list");
    const source = await createStaticSource(request, "HEL-519 Source Alpha");

    await page.goto("/sources");
    await page.locator(".source-list-table__name", { hasText: source.name }).click();
    await page.waitForURL(new RegExp(`/sources/${source.id}$`));

    await navigateViaSidebar(page, "Data Pipelines");
    await openPalette(page);
    await expect(recentGroupLabel(page)).toBeVisible();
    await expect(page.getByRole("option", { name: source.name })).toBeVisible();
  });

  // Matrix cell: pipeline, direct URL — no list click involved at all.
  test("arriving at a pipeline via direct URL records it under Recent", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "pipeline-url");
    const source = await createStaticSource(request, "HEL-519 Source For Pipeline");
    const pipeline = await createPipeline(request, "HEL-519 Pipeline Direct", source.id);

    await page.goto(`/pipelines/${pipeline.id}`);
    await expect(page.getByRole("heading", { name: pipeline.name })).toBeVisible();

    await page.goto("/sources");
    await openPalette(page);
    await expect(page.getByRole("option", { name: pipeline.name })).toBeVisible();
  });

  // Matrix cell: pipeline, back/forward — proves the observation is arrival-based (the route
  // effect fires on the location change itself), not a click-handler side effect.
  test("back/forward between two pipelines records BOTH under Recent", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "pipeline-bf");
    const source = await createStaticSource(request, "HEL-519 Source BF");
    const pipelineA = await createPipeline(request, "HEL-519 Pipeline BF A", source.id);
    const pipelineB = await createPipeline(request, "HEL-519 Pipeline BF B", source.id);

    await page.goto(`/pipelines/${pipelineA.id}`);
    await expect(page.getByRole("heading", { name: pipelineA.name })).toBeVisible();
    await page.goto(`/pipelines/${pipelineB.id}`);
    await expect(page.getByRole("heading", { name: pipelineB.name })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: pipelineA.name })).toBeVisible();

    await openPalette(page);
    await expect(page.getByRole("option", { name: pipelineA.name })).toBeVisible();
    await expect(page.getByRole("option", { name: pipelineB.name })).toBeVisible();
  });

  // Matrix cell: dashboard, "direct URL" substitution — a dashboard has no route id (D1), so the
  // real cell here is a full page RELOAD landing on `/`, exercising `fetchDashboards.fulfilled`'s
  // auto-select — the exact path round-1 CR1 found an action-only listener would miss.
  test("a full reload's auto-selected dashboard is recorded under Recent", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "dashboard-reload");
    const dashRes = await request.post("/api/dashboards", {
      data: { name: "HEL-519 Reload Dashboard" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashRes.status()).toBe(201);
    const dashboard = (await dashRes.json()) as { id: string; name: string };

    await page.reload();
    await expect(page.getByLabel("Active dashboard")).toBeVisible();

    await page.goto("/pipelines");
    await openPalette(page);
    await expect(page.getByRole("option", { name: dashboard.name })).toBeVisible();
  });

  // Selecting FROM the palette (its own "recent" row) must itself count as an arrival, and
  // persistence must survive a real reload — both from the SAME session.
  test("selecting a recent entry from the palette navigates, and persists across reload", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "persist");
    const source = await createStaticSource(request, "HEL-519 Persisted Source");
    await page.goto("/sources");
    await page.locator(".source-list-table__name", { hasText: source.name }).click();
    await page.waitForURL(new RegExp(`/sources/${source.id}$`));

    await navigateViaSidebar(page, "Data Pipelines");
    await openPalette(page);
    await page.getByRole("option", { name: source.name }).click();
    await page.waitForURL(new RegExp(`/sources/${source.id}$`));

    // A real reload resets the whole app (Redux included) — persistence is proven by reading
    // localStorage's own survival, then re-observing the Recent entry once `/sources` (the one
    // route that loads BOTH sources and pipelines — `SidebarBody.tsx`) has re-populated the
    // list needed to resolve its title.
    await page.reload();
    await page.goto("/sources");
    await openPalette(page);
    await expect(page.getByRole("option", { name: source.name })).toBeVisible();
  });

  // A fresh account (no history yet) must show the pre-existing default presentation, not an
  // empty/broken palette — the empty-history fallback (task 6.3).
  test("a fresh profile shows no Recent section, and the default sections still render", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "fresh");
    await openPalette(page);
    await expect(recentGroupLabel(page)).toHaveCount(0);
    await expect(
      page.locator(".command-palette__group-label", { hasText: "Navigation" }),
    ).toBeVisible();
  });

  // Typing a query leaves recents behind — the palette-level half of design.md D5, proven in a
  // real browser rather than only in the jsdom-driven CommandPalette.test.tsx.
  test("typing a query hides the Recent section", async ({ page, request }) => {
    await registerAndLogin(page, request, "typing");
    const source = await createStaticSource(request, "HEL-519 Typed Away");
    await page.goto("/sources");
    await page.locator(".source-list-table__name", { hasText: source.name }).click();
    await page.waitForURL(new RegExp(`/sources/${source.id}$`));

    await navigateViaSidebar(page, "Data Pipelines");
    await openPalette(page);
    await expect(recentGroupLabel(page)).toBeVisible();

    await page.fill('input[aria-label="Search commands"]', "theme");
    await expect(recentGroupLabel(page)).toHaveCount(0);
  });

  // skeptic-final-1.md CR1 — the exact real-browser reproduction of the blocking defect: `/` is
  // the app's default landing route and NEVER fetches `sources`/`pipelines` (only
  // `SidebarBody.tsx`'s per-section effect does). A FULL RELOAD after visiting a source lands
  // fresh on `/` with a completely empty client-side Redux store — the precise condition under
  // which the pre-fix palette rendered zero source/pipeline rows. The title is now persisted at
  // record time, so it survives regardless of whether `sources.items` has loaded on this route.
  test("a source visited earlier renders under Recent on / after a full reload", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "root-landing");
    const source = await createStaticSource(request, "HEL-519 Root Landing Source");
    await page.goto("/sources");
    await page.locator(".source-list-table__name", { hasText: source.name }).click();
    await page.waitForURL(new RegExp(`/sources/${source.id}$`));
    // Precondition wait, not a retry/timeout loosening: `RecentVisitsRouteObserver`'s `useEffect`
    // (which writes `localStorage`) commits AFTER React's render/paint, strictly later than
    // `waitForURL` (which only observes the URL). A `page.goto` immediately after `waitForURL`
    // is a REAL browser navigation that can unload the page before that effect has flushed,
    // silently dropping the write — confirmed directly: without this wait, the very next
    // `page.goto("/")` below landed with `localStorage.getItem("helio.recentVisits")` still
    // `null`. Waiting for the detail page's own heading (a signal the mount, and therefore its
    // effects, have committed) closes that race.
    await expect(page.getByRole("heading", { name: source.name, exact: true })).toBeVisible();

    // A fresh registered account has no dashboards, so "Active dashboard" never appears here —
    // this file's own post-mount precondition wait ("Add dashboard" — see `registerAndLogin`
    // above) is what a full reload of `/` genuinely settles on for this account.
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Add dashboard" })).toBeVisible();

    await openPalette(page);
    await expect(recentGroupLabel(page)).toBeVisible();
    await expect(page.getByRole("option", { name: source.name })).toBeVisible();
  });
});
