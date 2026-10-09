import { expect, test, type Page } from "@playwright/test";
import { isolateLivePage } from "./support/isolateLivePage";
import { registerAndLogin } from "./support/auth";

// HEL-1288 — parallel mode, scoped to this file: every test registers its own user and seeds its
// own data (no shared user/dashboard, no beforeAll/afterAll), so tests are independently
// schedulable — they spread across the 2 workers and across `--shard` boundaries instead of
// forming one serial group.
test.describe.configure({ mode: "parallel" });

// HEL-516 — real-browser proof for reach: the central hazard design.md and tasks.md both call
// out repeatedly. jsdom can prove DOM presence but never focus/visibility/computed style
// (evidence rule 3), and a test driven from the OWNING route proves nothing about reach at all
// (ticket.md's acceptance criteria say so explicitly) — every assertion below is driven from a
// route where the surface it opens is NOT mounted by that route itself. Follows the shape of
// e2e/hel510-keyboard-shortcuts.spec.ts / e2e/hel1003-actions-menu-keyboard-reach.spec.ts.

const CSRF_HEADER = "X-Helio-Requested-With";

// HEL-1030 — `waitForShell`: hold until the authenticated shell (and every `useShortcut` consumer
// mounted alongside it) has committed, before the first interaction. A precondition wait on a real,
// always-present post-mount element, not a retry/timeout loosening.
const AUTH = { prefix: "hel516", displayName: "HEL-516", waitForShell: true } as const;

async function openPalette(page: Page) {
  // Blur any currently-focused control (e.g. a just-clicked nav link) without hitting the
  // skip-link anchor that sits at the page's literal top-left corner.
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

async function runPaletteAction(page: Page, title: string) {
  await openPalette(page);
  await page.fill('input[aria-label="Search commands"]', title);
  await page.getByRole("option", { name: title }).click();
}

test.describe("HEL-516 palette quick-create — reach", () => {
  // Source: the owning route is /sources. Drive from /pipelines instead.
  test("Add source opens in place from /pipelines (host NOT mounted there)", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "source-reach" });
    await page.goto("/pipelines");

    await runPaletteAction(page, "Add source");

    await expect(page.getByRole("dialog", { name: "Add data source" })).toHaveAttribute("open");
    // No navigation happened — the ticket's D1 "no navigate-then-act" requirement.
    await expect(page).toHaveURL(/\/pipelines$/);
  });

  // Panel: the owning route is /. Drive from /pipelines, with a dashboard already selected.
  // A freshly-registered account has ZERO dashboards, and `useCreatePanelAction` reports
  // `disabled` (so the palette omits the action entirely, per task 2.3) with none selected — the
  // fixture below creates one via the same API the app itself uses, then / auto-selects it.
  test("Add panel opens in place from /pipelines (host NOT mounted there)", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "panel-reach" });
    // HEL-1300: seeding below must not race the live post-login `/`.
    await isolateLivePage(page);
    await request.post("/api/dashboards", {
      data: { name: "HEL-516 fixture dashboard" },
      headers: { [CSRF_HEADER]: "1" },
    });
    await page.goto("/");
    await expect(page.getByLabel("Active dashboard")).toBeVisible();
    await page.goto("/pipelines");

    await runPaletteAction(page, "Add panel");

    await expect(page.getByRole("dialog", { name: "Add panel" })).toHaveAttribute("open");
    await expect(page).toHaveURL(/\/pipelines$/);
  });

  // Pipeline: already shell-mounted pre-ticket (F-045) — regression-guard the existing reach
  // rather than re-deriving it, since this ticket's palette entry point is new even though the
  // shell mount itself isn't.
  test("New pipeline opens in place from /sources (host NOT mounted there)", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "pipeline-reach" });
    await page.goto("/sources");

    await runPaletteAction(page, "New pipeline");

    await expect(page.getByRole("dialog", { name: "Create pipeline" })).toHaveAttribute("open");
    await expect(page).toHaveURL(/\/sources$/);
  });

  // Dashboard: needs no host at all (design.md D2) — an immediate create, provable from
  // anywhere. /pipelines exercises the same "no navigation" claim as the others.
  test("New dashboard creates immediately from /pipelines, with no navigation", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "dashboard-reach" });
    await page.goto("/pipelines");

    await runPaletteAction(page, "New dashboard");

    await expect(page).toHaveURL(/\/pipelines$/);
    // The palette itself closed (no leftover dialog from the action).
    await expect(page.locator(".command-palette")).not.toHaveAttribute("open");
  });
});

test.describe("HEL-516 palette quick-create — never presented twice", () => {
  test("Add source on ITS OWN route (/sources) still shows exactly one dialog", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "source-owning" });
    await page.goto("/sources");

    await runPaletteAction(page, "Add source");

    await expect(page.locator('dialog[aria-label="Add data source"][open]')).toHaveCount(1);
  });

  test("Add panel on ITS OWN route (/) still shows exactly one dialog", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "panel-owning" });
    // HEL-1300: seeding below must not race the live post-login `/`.
    await isolateLivePage(page);
    await request.post("/api/dashboards", {
      data: { name: "HEL-516 fixture dashboard" },
      headers: { [CSRF_HEADER]: "1" },
    });
    await page.goto("/");
    await expect(page.getByLabel("Active dashboard")).toBeVisible();

    await runPaletteAction(page, "Add panel");

    await expect(page.locator('dialog[aria-label="Add panel"][open]')).toHaveCount(1);
  });

  // design.md Decision 7 / task 1.5 / evaluation-1.md CR2 — the NESTED case, which the route-skip
  // alone does not catch: `CreatePipelineModal` renders its own `AddSourceModal` from LOCAL
  // state (independent of the `addModalOpen` Redux flag), and is itself shell-mounted on every
  // non-/pipelines route, so a user can have that nested modal open and then run the palette's
  // "Add source" — this must still yield exactly one dialog, never two.
  test("Add source while a NESTED AddSourceModal (from CreatePipelineModal) is already open still shows exactly one dialog", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "source-nested" });
    await page.goto("/sources"); // off /pipelines, so CreatePipelineModal is the SHELL instance

    await runPaletteAction(page, "New pipeline");
    await expect(page.getByRole("dialog", { name: "Create pipeline" })).toHaveAttribute("open");
    await page.getByRole("button", { name: "Create a new source" }).click();
    await expect(page.locator('dialog[aria-label="Add data source"][open]')).toHaveCount(1);

    await runPaletteAction(page, "Add source");

    // evaluation-1.md re-review — Playwright's web-first `toHaveCount` resolves on the FIRST
    // observed match, not the SETTLED state: a bare `toHaveCount(1)` right after the click can
    // false-pass by catching a transient window where the collision guard's early return hasn't
    // been reached yet, before genuinely proving the second dialog never appears. Confirmed by
    // direct reproduction: with the guard temporarily removed, a second `AddSourceModal` DID
    // mount, but only after ~700-900ms — comfortably past a naive immediate assertion, and past
    // what a short fixed wait would have caught reliably either. Waiting for the dialog count to
    // hold steady at 1 for a full second (`toPass` polling against a real elapsed-time
    // requirement, not a single snapshot) is the honest, non-racy version of this assertion.
    let stableSince = Date.now();
    await expect(async () => {
      const count = await page.locator('dialog[aria-label="Add data source"][open]').count();
      if (count !== 1) {
        stableSince = Date.now();
        throw new Error(`expected exactly 1 dialog, saw ${count}`);
      }
      if (Date.now() - stableSince < 1000) {
        throw new Error("not yet held steady for 1000ms");
      }
    }).toPass({ timeout: 10000 });
  });
});

test.describe("HEL-516 design.md D3a — the StrictMode-masked production defect, positive direction", () => {
  // task 5.3 — asserts ONLY the positive reach direction here (failable in dev): the modal opens
  // IN PLACE on /sources/:id. The non-vacuous "never silently defers later" assertion is owned by
  // App.test.tsx's render-level (no-StrictMode) guard, task 1.3a — cross-referenced so this
  // section can't be read alone and reproduce the vacuous dev-server guard this ticket's design.md
  // explicitly rejected.
  test("Add source opens IN PLACE on /sources/:id (a sibling route, not a child of /sources)", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "strictmode-positive" });
    // HEL-1300: seeding below must not race the live post-login `/`.
    await isolateLivePage(page);
    await request.post("/api/data-sources", {
      data: {
        name: "HEL-516 fixture",
        type: "static",
        columns: [{ name: "value", type: "string" }],
        rows: [],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    await page.goto("/sources");
    const firstRow = page.locator(".source-list-table tbody tr").first();
    await firstRow.click();
    await page.waitForURL(/\/sources\/.+/);

    await runPaletteAction(page, "Add source");

    await expect(page.getByRole("dialog", { name: "Add data source" })).toHaveAttribute("open");
  });
});

// evaluation-1.md CR1 — real-browser cross-check for the nondeterministic Create-section-order
// bug (measured 5/6 `Navigation,General,Create` vs 1/6 `Create,Navigation,General` across
// identical boots before the `CreateCommandActions.tsx` memoization fix). WHAT THIS PROVES: the
// palette's top-level section order is identical across N independent, fresh page loads — a
// real mount path distinct from `CreateCommandActions.test.tsx`'s `render()`-based guard, which
// proves the render-level mechanism but not an actual browser boot. WHAT THIS CANNOT PROVE:
// anything about WHY the order is stable (that's the unit guard's job) — this only measures the
// user-visible symptom, repeatedly, in a real browser.
test.describe("HEL-516 palette quick-create — section order determinism", () => {
  test("section order is identical across 5 independent fresh page loads", async ({
    page,
    request,
  }) => {
    const orders: string[][] = [];
    for (let i = 0; i < 5; i++) {
      // Each iteration is a genuinely fresh boot: an already-authenticated session left over
      // from the PREVIOUS iteration makes `PublicOnlyRoute` redirect `/login` straight back to
      // `/`, unmounting the login form mid-interaction.
      await page.context().clearCookies();
      await registerAndLogin(page, request, { ...AUTH, label: `order-${i}` });
      await openPalette(page);
      const order = await page.locator(".command-palette__group-label").allTextContents();
      orders.push(order);
    }

    // skeptic-final-1.md CR1 — assert the DECLARED order (`SECTION_DISPLAY_ORDER`,
    // `builtInActions.ts`), not merely that the 5 boots agree with each other. The evaluator
    // noted 5 boots alone is only ~52% likely to catch a 1-in-6 mis-ordering standalone, so this
    // is deliberately a SECONDARY check behind `CommandPalette.test.tsx`'s render-level guard
    // (which is failable by mutation and doesn't depend on sample size) — but it should still
    // assert the actually-correct thing rather than a self-referential "boots agree" claim that
    // a consistently-WRONG order would also satisfy.
    for (const order of orders) {
      expect(order).toEqual(["Navigation", "General", "Create"]);
    }
  });
});

// design.md D3b / task 1.2a / evaluation-1.md re-review — the actual parity claim task 1.2a
// asked for, never previously tested: the shell-mounted `OutputPicker`'s "already on this
// board" marking off-route must match the `/` flow's POST-FETCH result for the SAME dashboard.
// Mounting/withholding alone (proven elsewhere) says nothing about whether the CONTENT the
// picker renders is correct once it does mount.
test.describe("HEL-516 design.md D3b — OutputPicker parity between / and off-route", () => {
  test("an Output already placed via / shows the SAME 'On this board' marking when the picker is reopened off-route", async ({
    page,
    request,
  }) => {
    const email = `hel516-parity-${Date.now()}@example.test`;
    console.log(`[HEL-1300 e2e] throwaway user: ${email}`);
    const password = "correcthorsebattery1";
    await request.post("/api/auth/register", {
      data: { email, password, displayName: "HEL-516 parity" },
      headers: { [CSRF_HEADER]: "1" },
    });
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL("/");
    // HEL-1300: seeding below must not race the live post-login `/`.
    await isolateLivePage(page);

    await request.post("/api/dashboards", {
      data: { name: "HEL-516 Parity Dashboard" },
      headers: { [CSRF_HEADER]: "1" },
    });

    const sourceRes = await request.post("/api/data-sources", {
      data: {
        name: "HEL-516 parity source",
        type: "static",
        columns: [{ name: "value", type: "integer" }],
        rows: [[1], [2]],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    const source = (await sourceRes.json()) as { id: string };

    const pipelineRes = await request.post("/api/pipelines", {
      data: { name: "HEL-516 parity pipeline", roots: [{ sourceId: source.id }] },
      headers: { [CSRF_HEADER]: "1" },
    });
    const pipeline = (await pipelineRes.json()) as { id: string };

    const outputRes = await request.post(`/api/pipelines/${pipeline.id}/outputs`, {
      data: {
        kind: "chart",
        name: "Parity Output",
        config: { chartType: "line", fieldMapping: { xAxis: "value", yAxis: "value" } },
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    await outputRes.json();

    // Select the dashboard (most-recently-updated auto-select already lands here, since it's
    // the only one, but navigate explicitly for clarity/robustness).
    await page.goto("/");
    await expect(page.getByLabel("Active dashboard")).toBeVisible();

    // Place the Output via the `/` flow's own "Add panel" trigger.
    await page.getByRole("button", { name: "Add panel" }).click();
    await expect(page.getByRole("dialog", { name: "Add panel" })).toHaveAttribute("open");
    await page.fill('[aria-label="Search outputs"]', "Parity Output");
    await page.getByRole("option", { name: /Parity Output/ }).click();
    // `placeOutput` dispatches `createPanel` and only closes the picker once that async thunk
    // resolves — waiting for the placed panel to actually appear in the grid is the honest
    // success signal (the dialog's own open/closed transition can otherwise be observed
    // mid-flicker by a bare attribute assertion).
    await expect(page.getByRole("heading", { name: "Parity Output", level: 3 })).toBeVisible({
      timeout: 15000,
    });

    // Reopen the SAME `/` picker and confirm the `/` flow itself marks it "On this board" —
    // this is the baseline the off-route mount must match. Once a dashboard HAS panels, "Add
    // panel" moves from the empty-state button into the header's "Dashboard actions" kebab menu
    // (CommandBar.tsx) — the standalone button no longer exists.
    await page.getByRole("button", { name: "Dashboard actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add panel" }).click();
    await page.fill('[aria-label="Search outputs"]', "Parity Output");
    await expect(
      page.getByRole("option", { name: /Parity Output.*already on this board/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // Now off-route: run the palette's "Add panel" from a route where OutputPicker is NOT
    // PanelList's own instance, and confirm the SAME marking.
    await page.goto("/pipelines");
    await runPaletteAction(page, "Add panel");
    await expect(page.getByRole("dialog", { name: "Add panel" })).toHaveAttribute("open");
    await page.fill('[aria-label="Search outputs"]', "Parity Output");
    await expect(
      page.getByRole("option", { name: /Parity Output.*already on this board/ }),
    ).toBeVisible();
  });
});
