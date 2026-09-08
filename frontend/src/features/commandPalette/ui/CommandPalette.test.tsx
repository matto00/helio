import { fireEvent, render, screen, waitFor } from "@testing-library/react";

beforeEach(() => {
  // jsdom does not implement showModal/close natively; stub them (mirrors Modal.test.tsx /
  // App.test.tsx's own setup).
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { CommandPaletteProvider } from "../CommandPaletteProvider";
import { GlobalCommandShortcuts } from "../GlobalCommandShortcuts";
import { useCommandActions } from "../hooks";
import { OverlayProvider } from "../../../shared/chrome/OverlayProvider";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { outputsReducer } from "../../pipelines/state/outputsSlice";
import { pipelinesReducer } from "../../pipelines/state/pipelinesSlice";
import { sourcesReducer } from "../../sources/state/sourcesSlice";
import { recentHistoryStore } from "../model/recentHistoryStore";
import type { CommandAction } from "../model/types";
import { CommandPalette } from "./CommandPalette";

function Registrant({ actions }: { actions: CommandAction[] }) {
  useCommandActions(actions);
  return null;
}

// HEL-519 — `CommandPalette` now reads `state.dashboards`/`sources`/`pipelines` (recents' title
// lookup) and the router (`useResourceNavigator`), so every render here needs a real Provider +
// Router, not just the palette's own context. A fresh store per render keeps tests isolated from
// each other's dispatched state.
function renderPalette(actions: CommandAction[] = [], initialPath = "/") {
  const onOpenQuickLauncher = jest.fn();
  const store = configureStore({
    reducer: {
      dashboards: dashboardsReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
      outputs: outputsReducer,
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialPath]}>
        <OverlayProvider>
          <CommandPaletteProvider>
            <GlobalCommandShortcuts onOpenQuickLauncher={onOpenQuickLauncher} />
            <Registrant actions={actions} />
            <button type="button">Prior focus target</button>
            <CommandPalette />
          </CommandPaletteProvider>
        </OverlayProvider>
      </MemoryRouter>
    </Provider>,
  );
  return { onOpenQuickLauncher, store };
}

function makeAction(id: string, title: string, run: () => void = jest.fn()): CommandAction {
  return { id, title, run };
}

// `role="dialog"` queries are unreliable for a `<dialog>` that has no `open` attribute (jsdom's
// UA stylesheet renders it `display: none`, which most accessible-name/role machinery treats as
// absent even with `hidden: true`) — use the DOM node directly for open/closed assertions.
function getDialog(): HTMLDialogElement {
  return document.querySelector(".command-palette") as HTMLDialogElement;
}

describe("CommandPalette", () => {
  it("Cmd/Ctrl+K opens the palette with its input focused", async () => {
    renderPalette();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    await waitFor(() => expect(getDialog()).toHaveAttribute("open"));
    await waitFor(() => expect(screen.getByLabelText("Search commands")).toHaveFocus());
  });

  it("Ctrl+J does not open the palette", () => {
    renderPalette();

    fireEvent.keyDown(window, { key: "j", ctrlKey: true });

    expect(getDialog()).not.toHaveAttribute("open");
  });

  // Focus restore on close is native <dialog> behavior (Modal.tsx), inherited rather than
  // reimplemented here — untestable under jsdom's stubbed showModal/close (see Modal.test.tsx,
  // which doesn't assert it either); this test covers the palette's own close-on-Escape wiring.
  it("Escape closes the palette", async () => {
    renderPalette();
    const trigger = screen.getByRole("button", { name: "Prior focus target" });
    trigger.focus();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(getDialog()).toHaveAttribute("open"));

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(getDialog()).not.toHaveAttribute("open"));
  });

  it("arrow keys move the active result and wrap at the ends", async () => {
    renderPalette([makeAction("a", "Alpha"), makeAction("b", "Beta")]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByLabelText("Search commands");

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
  });

  it("Enter runs the active result exactly once and closes the palette", async () => {
    const run = jest.fn();
    renderPalette([makeAction("a", "Alpha", run)]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByLabelText("Search commands");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getDialog()).not.toHaveAttribute("open"));
  });

  it("shows the empty state when the query matches nothing, and Enter is a no-op", async () => {
    const run = jest.fn();
    renderPalette([makeAction("a", "Alpha", run)]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByLabelText("Search commands");

    fireEvent.change(input, { target: { value: "zzz-no-match" } });

    expect(await screen.findByText("No matching commands")).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(run).not.toHaveBeenCalled();

    expect(getDialog()).toHaveAttribute("open");
  });

  it("reopening starts from a clean query showing the full default list", async () => {
    renderPalette([makeAction("a", "Alpha"), makeAction("b", "Beta")]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    let input = await screen.findByLabelText("Search commands");
    fireEvent.change(input, { target: { value: "Alpha" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(getDialog()).not.toHaveAttribute("open"));

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    input = await screen.findByLabelText("Search commands");
    expect(input).toHaveValue("");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  // HEL-510 tasks.md 3.1 — the palette renders AS a Modal, so `command-palette` must NOT set
  // `guardWhileOverlayOpen`, and its typing exemption must still apply while focus is inside its
  // own (typing-target) search input, once the palette is already open.
  it("Cmd/Ctrl+K still fires while the palette is open, with focus inside its own search input", async () => {
    renderPalette([makeAction("a", "Alpha")]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByLabelText("Search commands");
    expect(getDialog()).toHaveAttribute("open");

    fireEvent.change(input, { target: { value: "Alpha" } });
    fireEvent.keyDown(input, { key: "k", ctrlKey: true });

    expect(getDialog()).toHaveAttribute("open");
    expect(input).toHaveValue("Alpha");
  });

  // HEL-516 tasks.md 4.2/4.4 — an action with a `shortcut` shows caps; one without shows none,
  // and rendering nothing reserves no space (asserted structurally here via absence; the visual
  // "no misalignment" claim itself is verified in a real browser per evidence rule 3, not here).
  it("renders a KeyCap per token for an action with a shortcut, and none for an action without", async () => {
    renderPalette([
      { id: "with-combo", title: "With combo", shortcut: { key: "j", mod: true }, run: jest.fn() },
      makeAction("without-combo", "Without combo"),
    ]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await screen.findByLabelText("Search commands");

    const withComboItem = screen.getByText("With combo").closest("button")!;
    const withoutComboItem = screen.getByText("Without combo").closest("button")!;

    expect(withComboItem.querySelectorAll(".ui-keycap")).toHaveLength(2);
    expect(withoutComboItem.querySelectorAll(".ui-keycap")).toHaveLength(0);
  });

  // skeptic-final-1.md CR1 — the top-level section order is DECLARED data
  // (`SECTION_DISPLAY_ORDER`), not an emergent property of registration/encounter order.
  //
  // WHAT THIS PROVES: even when the underlying (already-ranked) action list encounters sections
  // in the WRONG order first (`Create` before `Navigation`/`General` here — the exact shape a
  // future render-churn bug like the fixed `HelpOverlay` one would reproduce), the rendered
  // group order still matches the declared `SECTION_DISPLAY_ORDER`. WHAT THIS CANNOT PROVE:
  // that every REAL registrant in the live app registers in a stable, non-churning way — that is
  // `CreateCommandActions.test.tsx`'s and `HelpOverlay`'s own concern; this test is about the
  // DISPLAY layer's independence from whatever order it's handed.
  //
  // FAILABLE BY MUTATION: reordering `SECTION_DISPLAY_ORDER`'s declaration (e.g. putting
  // `Create` first) turns this red — verified by making that exact edit during development,
  // observing the failure, and reverting it.
  it("renders sections in the DECLARED order, even when the action list encounters them out of order", async () => {
    renderPalette([
      { id: "create.dashboard", title: "New dashboard", section: "Create", run: jest.fn() },
      { id: "nav.dashboards", title: "Go to Dashboards", section: "Navigation", run: jest.fn() },
      { id: "general.theme", title: "Switch theme", section: "General", run: jest.fn() },
    ]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await screen.findByLabelText("Search commands");

    const labels = Array.from(document.querySelectorAll(".command-palette__group-label")).map(
      (el) => el.textContent,
    );

    expect(labels).toEqual(["Navigation", "General", "Create"]);
  });
});

// HEL-519 design.md D5, tasks 5.1/5.2 — the Recent section: prepends on empty query, never
// replaces HEL-516's existing sections, and disappears once the user types.
describe("CommandPalette — Recent section (HEL-519)", () => {
  afterEach(() => {
    // The palette reads the real, module-singleton `recentHistoryStore` (not an injectable test
    // double — see design.md D2's non-unification rationale) so every recorded entry must be
    // cleaned up, or it would leak into the tests above/below.
    for (const entry of recentHistoryStore.getEntries()) {
      recentHistoryStore.pruneMissing(entry.kind, new Set());
    }
  });

  it("prepends Recent AND still renders the pre-existing sections on an empty query", async () => {
    const store = configureStore({
      reducer: {
        dashboards: dashboardsReducer,
        sources: sourcesReducer,
        pipelines: pipelinesReducer,
        outputs: outputsReducer,
      },
      preloadedState: {
        sources: {
          items: [{ id: "s1", name: "My Source" } as never],
          status: "succeeded" as const,
          error: null,
          errorKind: null,
          selectedSourceId: null,
          addModalOpen: false,
        },
      },
    });
    recentHistoryStore.recordVisit("source", "s1");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/"]}>
          <OverlayProvider>
            <CommandPaletteProvider>
              <Registrant
                actions={[
                  { id: "nav.a", title: "Go to Dashboards", section: "Navigation", run: jest.fn() },
                ]}
              />
              <CommandPalette />
            </CommandPaletteProvider>
          </OverlayProvider>
        </MemoryRouter>
      </Provider>,
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await screen.findByLabelText("Search commands");

    const labels = Array.from(document.querySelectorAll(".command-palette__group-label")).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(["Recent", "Navigation"]);
    expect(screen.getByText("My Source")).toBeInTheDocument();
  });

  // evaluation-1.md CR1 — the previous version of this test was unfailable for TWO independent
  // reasons, both fixed here:
  //   1. It recorded a visit for a source id ("s1") that was never present in ANY store's
  //      `sources.items`, so `useRecentPaletteActions`'s `resolveTitle` always returned `null`
  //      and `recentActions` was ALWAYS empty — the assertion passed whether or not
  //      `CommandPalette.tsx`'s empty-query gate existed. The evaluator proved this by deleting
  //      that gate (`query.trim() === ""` at `CommandPalette.tsx:112`) and watching all tests,
  //      including this one, stay green.
  //   2. Independently (found while fixing #1): this test's render tree never mounted
  //      `GlobalCommandShortcuts`, the ONLY thing that wires Ctrl/Cmd+K to `open()`
  //      (`GlobalCommandShortcuts.tsx`). Without it the keydown below is a no-op, the palette's
  //      `<dialog>` never receives its `open` attribute, and every `getByRole` query below would
  //      have silently failed to find anything (`Modal` still renders its children
  //      unconditionally into the DOM, so `getByText`/`querySelector` — used by the "prepends
  //      Recent" test above — would have stayed vacuously true regardless).
  //
  // FIX: preload the SAME store shape the "prepends Recent" test above uses so "My Source" is
  // genuinely resolvable, AND mount `GlobalCommandShortcuts` so Ctrl+K genuinely opens the
  // palette (`getDialog()` asserts the `open` attribute directly, matching this file's other
  // real-open tests).
  //
  // WHAT THIS PROVES: once a query is non-empty, a recent entry that DOES resolve to a real,
  // renderable, on-screen action is excluded from the result list — not merely "an
  // already-empty/never-opened list stayed empty". WHAT THIS CANNOT PROVE: recents contributing
  // nothing to SCORING/ordering for a query that happens to textually match a recent's title (no
  // registered action here shares a name with "My Source", so that overlap case is untested here;
  // `ranking.test.ts` covers `rankActions`'s own scoring behavior in isolation).
  //
  // FAILABLE BY MUTATION — run, not merely asserted: reverting `CommandPalette.tsx:112` to drop
  // the `query.trim() === ""` check (prepending `recentActions` unconditionally) turns this test
  // RED (`getAllByRole("option")` returns 2 — "My Source" survives the "dashboards" filter);
  // restoring the gate turns it back green. Both runs observed directly, not inferred.
  it("typing a query leaves recents behind (task 5.1/D5)", async () => {
    const store = configureStore({
      reducer: {
        dashboards: dashboardsReducer,
        sources: sourcesReducer,
        pipelines: pipelinesReducer,
        outputs: outputsReducer,
      },
      preloadedState: {
        sources: {
          items: [{ id: "s1", name: "My Source" } as never],
          status: "succeeded" as const,
          error: null,
          errorKind: null,
          selectedSourceId: null,
          addModalOpen: false,
        },
      },
    });
    recentHistoryStore.recordVisit("source", "s1");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/"]}>
          <OverlayProvider>
            <CommandPaletteProvider>
              {/* GlobalCommandShortcuts is what actually wires Ctrl/Cmd+K to `open()` — without
                it, the keydown below is a no-op and the palette's `<dialog>` never gets its
                `open` attribute, which silently starves every `getByRole` query below (content
                still exists in the DOM either way, since `Modal` doesn't conditionally mount its
                children — only `getByText`/`querySelector`, used elsewhere in this file, survive
                that). Omitting this mount was the root cause of evaluation-1.md CR1: this test's
                FIRST version never actually opened the palette, so `getAllByRole("option")`
                would have thrown regardless of which code path ran. */}
              <GlobalCommandShortcuts onOpenQuickLauncher={() => {}} />
              <Registrant actions={[makeAction("nav.a", "Go to Dashboards")]} />
              <CommandPalette />
            </CommandPaletteProvider>
          </OverlayProvider>
        </MemoryRouter>
      </Provider>,
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByLabelText("Search commands");
    expect(getDialog()).toHaveAttribute("open");

    // Sanity precondition: "My Source" IS present before typing (otherwise this test would be
    // exactly the unfailable shape it's replacing).
    expect(screen.getByRole("option", { name: "My Source" })).toBeInTheDocument();

    // Nothing named "My Source" matches "dashboards", so once typing starts the result must
    // filter to exactly the one real registered action — recents contribute nothing.
    fireEvent.change(input, { target: { value: "dashboards" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("Go to Dashboards")).toBeInTheDocument();
    expect(screen.queryByText("My Source")).not.toBeInTheDocument();
  });

  it("an empty history leaves the default presentation COMPLETELY unchanged", async () => {
    renderPalette([makeAction("nav.a", "Go to Dashboards")]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await screen.findByLabelText("Search commands");

    const labels = Array.from(document.querySelectorAll(".command-palette__group-label")).map(
      (el) => el.textContent,
    );
    expect(labels).not.toContain("Recent");
  });

  // skeptic-final-1.md CR1 — THE missing test that let the defect through. `/` is the app's
  // default landing route and NEVER fetches `sources`/`pipelines` (only `SidebarBody.tsx`'s
  // per-section effect does, gated on the pathname's picker section) — a lazy-resolve-only
  // design rendered exactly one of three recorded kinds there. `sources`/`pipelines` are left at
  // their genuinely-empty initial state below (NOT preloaded), on `/`, to reproduce that exact
  // condition; only the PERSISTED `title` on each entry (`recordVisit`'s third argument) can
  // make all three render here.
  //
  // WHAT THIS PROVES: on the route users land on by default, with all three kinds' slices
  // unloaded, all three recorded kinds render. WHAT THIS CANNOT PROVE: that every real recording
  // site actually supplies a title in production (`recentVisitsListeners.test.ts`'s "persists
  // the dashboard's title" and `RecentVisitsRouteObserver.test.tsx`'s equivalent test cover
  // that, at the two real call sites, directly).
  //
  // FAILABLE BY MUTATION — run, not merely asserted: reverting `recordVisit`'s calls in this test
  // to omit the title argument (simulating the pre-fix "resolve from slice only" behavior) turns
  // this test RED — ALL THREE rows vanish here, since this test's own store (unlike the real
  // app's `AppShell`) never dispatches `fetchDashboards()` either, so `dashboards.items` is
  // empty too. That is a STRONGER red than the real app would show (where `fetchDashboards()`
  // does fire unconditionally on boot, so only source/pipeline would actually vanish in
  // production) — confirmed by running the mutation and observing the failure directly, not
  // assumed from reasoning. Restoring the title arguments turns it back green.
  it("renders all three kinds on / with NO slice loaded (skeptic-final-1.md CR1)", async () => {
    recentHistoryStore.recordVisit("dashboard", "d1", "My Dashboard");
    recentHistoryStore.recordVisit("source", "s1", "My Source");
    recentHistoryStore.recordVisit("pipeline", "p1", "My Pipeline");

    renderPalette([makeAction("nav.a", "Go to Dashboards")], "/");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await screen.findByLabelText("Search commands");

    expect(screen.getByRole("option", { name: "My Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "My Source" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "My Pipeline" })).toBeInTheDocument();
  });
});

// Skeptic-final-1 CR2 (final gate, round 1) — the overflow-count row ("+N more … refine your
// search") must never be a selectable option: the skeptic clicked it live and found it closed
// the palette, cleared the query, and navigated nowhere — "appears to work and goes nowhere",
// the exact pattern this ticket's own premise corrections cite as the reason `connector` was
// excluded from scope (ticket.md).
describe("CommandPalette — search-result overflow row is non-interactive (skeptic-final-1.md CR2)", () => {
  function manySourcesStore() {
    return configureStore({
      reducer: {
        dashboards: dashboardsReducer,
        sources: sourcesReducer,
        pipelines: pipelinesReducer,
        outputs: outputsReducer,
      },
      preloadedState: {
        sources: {
          // 7 matches for "alpha" — one more than `SEARCH_RESULTS_PER_KIND_CAP` (5), so exactly
          // one overflow notice ("+2 more …") is produced.
          items: Array.from({ length: 7 }, (_, i) => ({
            id: `s${i}`,
            name: `Alpha Source ${i}`,
          })) as never,
          status: "succeeded" as const,
          error: null,
          errorKind: null,
          selectedSourceId: null,
          addModalOpen: false,
        },
      },
    });
  }

  function renderWithManySources() {
    const store = manySourcesStore();
    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/"]}>
          <OverlayProvider>
            <CommandPaletteProvider>
              <GlobalCommandShortcuts onOpenQuickLauncher={() => {}} />
              <Registrant actions={[]} />
              <CommandPalette />
            </CommandPaletteProvider>
          </OverlayProvider>
        </MemoryRouter>
      </Provider>,
    );
  }

  // WHAT THIS PROVES: with 7 sources matching "alpha" and a cap of 5, the palette renders
  // exactly 5 selectable options (never 6 or 7 — the overflow count is never itself an option)
  // AND the "+2 more …" text is visible somewhere on screen. WHAT IT CANNOT PROVE: a REAL
  // browser's keyboard-focus/click behavior — that's the skeptic's live-click finding plus a
  // real-browser check in the e2e spec.
  //
  // FAILABLE BY MUTATION, RUN AND CONFIRMED (see files-modified.md): restoring the overflow
  // notice as a `CommandAction` with a no-op `run` (its pre-fix shape) turns `getAllByRole
  // ("option")` back up to 6 and the "+2 more" text is found INSIDE an element with
  // `role="option"` — this test's assertions both fail; the current shape (a plain, roleless
  // `<div>`) turns them green.
  it("the overflow notice is on screen but is NOT among the palette's options", async () => {
    renderWithManySources();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByLabelText("Search commands");
    fireEvent.change(input, { target: { value: "alpha" } });

    // The search-result match is DEBOUNCED (design.md D6) -- wait for it to settle rather than
    // asserting immediately after the synchronous `fireEvent.change`.
    const options = await waitFor(() => {
      const found = screen.getAllByRole("option");
      expect(found).toHaveLength(5);
      return found;
    });
    expect(options.every((el) => !/more.*match/i.test(el.textContent ?? ""))).toBe(true);

    const notice = await screen.findByText(/\+2 more sources match/i);
    expect(notice).toBeInTheDocument();
    expect(notice.closest('[role="option"]')).toBeNull();
    expect(notice.closest("button")).toBeNull();
  });

  // WHAT THIS PROVES: ArrowDown cycling through every option (starting from index 0) never
  // lands on the overflow notice — `activeIndex` only ever indexes `results`, which never
  // contains it. WHAT IT CANNOT PROVE: real keyboard focus ordering in a browser (jsdom has no
  // native tab/arrow focus traversal) — covered by the e2e spec instead.
  it("arrowing through every option never reaches the overflow notice", async () => {
    renderWithManySources();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByLabelText("Search commands");
    fireEvent.change(input, { target: { value: "alpha" } });

    const options = await waitFor(() => {
      const found = screen.getAllByRole("option");
      expect(found).toHaveLength(5);
      return found;
    });
    // Cycle one full loop plus one extra step — if the overflow notice were reachable as an
    // option, `results.length` (and therefore the modulo wrap in `handleKeyDown`) would be 6,
    // and this loop would land on a 6th `aria-selected="true"` element that does not exist here.
    for (let i = 0; i < 6; i++) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }
    const selected = options.filter((el) => el.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
  });
});
