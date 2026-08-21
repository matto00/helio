import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LayoutDashboard } from "lucide-react";
import { useEffect, useState } from "react";

import type { CreateActionResult } from "../../features/dashboards/hooks/useCreateDashboardAction";
import { MobileNavSheet, type MobileNavSheetItem } from "./MobileNavSheet";
import { OverlayProvider } from "./OverlayProvider";

// `PointerEvent`/`setPointerCapture` polyfills for the drag-to-dismiss tests
// below live in `src/test/jest.setup.ts` (jsdom implements neither).

const items: MobileNavSheetItem[] = [
  { id: "dash-1", name: "Ops Overview", isActive: true },
  { id: "dash-2", name: "Growth", isActive: false },
];

const emptyState = {
  icon: <LayoutDashboard />,
  title: "No dashboards yet",
  description: "Create your first dashboard to start visualizing data.",
};

function makeCreateAction(overrides: Partial<CreateActionResult> = {}): CreateActionResult {
  return {
    cta: {
      label: "New dashboard",
      icon: <span data-testid="create-icon" />,
      onClick: jest.fn(),
    },
    error: null,
    isPending: false,
    ...overrides,
  };
}

function renderSheet(overrides: Partial<Parameters<typeof MobileNavSheet>[0]> = {}) {
  const onClose = jest.fn();
  const onSelect = jest.fn();
  const baseProps: Parameters<typeof MobileNavSheet>[0] = {
    open: true,
    onClose,
    title: "Dashboards",
    items,
    onSelect,
    emptyState,
    createAction: null,
    emptyCreateAction: null,
    ...overrides,
  };
  const utils = render(
    <OverlayProvider>
      <MobileNavSheet {...baseProps} />
    </OverlayProvider>,
  );
  // Re-renders with a shallow-merged prop set, keeping the same onClose/
  // onSelect unless the caller overrides them — used to simulate a create
  // hook's state settling across renders (idle -> pending -> settled),
  // mirroring how `usePickerSelection` would flow a real hook's state down.
  function rerenderWith(nextOverrides: Partial<Parameters<typeof MobileNavSheet>[0]>) {
    const nextProps = { ...baseProps, ...nextOverrides };
    utils.rerender(
      <OverlayProvider>
        <MobileNavSheet {...nextProps} />
      </OverlayProvider>,
    );
  }
  return { ...utils, onClose, onSelect, rerenderWith };
}

type HarnessPhase = "idle" | "pending" | "settled";

/**
 * A real, self-updating create-action hook stand-in — unlike `renderSheet`'s
 * plain-prop `createAction`, this owns its OWN `useState` and flips it
 * inside the SAME synchronous click handler `handleCreateClick` calls,
 * mirroring `useCreateDashboardAction`'s real shape
 * (`setIsPending(true)`/`setError(null)` as the first two lines of
 * `handleCreate`, both batched into the SAME React commit as
 * `MobileNavSheet`'s own `setAttemptFired(true)`). A plain manually-`
 * rerender`ed prop object (as `renderSheet` uses elsewhere in this file)
 * cannot reproduce that same-tick batching — the mock `onClick` it passes
 * never touches the prop itself, so a naive test would observe a stale
 * "still idle" read on the very next effect pass and dismiss the sheet
 * immediately even for the one hook that's supposed to stay open while
 * pending (design.md D9). `settle()` (exposed via a ref) simulates the
 * async operation resolving, wrapped in `act()` like awaiting a real
 * promise would be.
 */
function renderPendingCapableHarness({
  items: harnessItems = items,
  shouldFail = false,
}: { items?: MobileNavSheetItem[]; shouldFail?: boolean } = {}) {
  const onClose = jest.fn();
  const settleRef: { current: () => void } = { current: () => {} };

  function Harness() {
    const [phase, setPhase] = useState<HarnessPhase>("idle");
    // Published in an effect, not during render — mutating a captured
    // closure variable belongs among the side effects React's purity rules
    // ("components should be pure" — the same rule this component group's
    // hand-rolled trap/portal effects already respect) allow there.
    useEffect(() => {
      settleRef.current = () => setPhase("settled");
    }, []);

    function handleClick() {
      setPhase("pending");
    }

    const action: CreateActionResult =
      phase === "pending"
        ? { cta: { label: "Creating...", onClick: handleClick }, error: null, isPending: true }
        : {
            cta: { label: "New dashboard", onClick: handleClick },
            error: phase === "settled" && shouldFail ? "Failed to create dashboard." : null,
            isPending: false,
          };

    return (
      <MobileNavSheet
        open
        onClose={onClose}
        title="Dashboards"
        items={harnessItems}
        onSelect={jest.fn()}
        emptyState={emptyState}
        createAction={action}
        emptyCreateAction={action}
      />
    );
  }

  const utils = render(
    <OverlayProvider>
      <Harness />
    </OverlayProvider>,
  );

  return { ...utils, onClose, settle: () => act(() => settleRef.current()) };
}

describe("MobileNavSheet", () => {
  it("renders nothing when closed", () => {
    render(
      <OverlayProvider>
        <MobileNavSheet
          open={false}
          onClose={jest.fn()}
          title="Dashboards"
          items={items}
          onSelect={jest.fn()}
          emptyState={emptyState}
          createAction={null}
          emptyCreateAction={null}
        />
      </OverlayProvider>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens from the title and lists items from the store-derived props, active item marked", () => {
    renderSheet();

    const dialog = screen.getByRole("dialog", { name: "Dashboards" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ops Overview/ })).toHaveClass(
      "mobile-nav-sheet__item--active",
    );
    expect(screen.getByRole("button", { name: /Growth/ })).not.toHaveClass(
      "mobile-nav-sheet__item--active",
    );
  });

  it("dispatches selection and dismisses on pick", () => {
    const { onSelect, onClose } = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: /Growth/ }));

    expect(onSelect).toHaveBeenCalledWith(items[1]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses on backdrop tap", () => {
    const { onClose } = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses on Escape via the shared overlay registry", () => {
    const { onClose } = renderSheet();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // HEL-773 design.md D13/task 5.2 — narrowed, not deleted: the sheet now
  // permits exactly one section-appropriate create action (AC3), so a blind
  // "no /add/i button" assertion would fail against "Add source" — this
  // scopes the guard to the affordances that are STILL prohibited
  // (rename/delete/duplicate/import/export/actions-menu) and separately
  // locks "at most one create action".
  it("renders no CRUD affordances beyond a single create action — no rename, delete, duplicate, import, export, or actions-menu controls", () => {
    renderSheet({ createAction: makeCreateAction() });

    expect(screen.queryByRole("button", { name: /rename/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /duplicate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /import/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /export/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /actions/i })).not.toBeInTheDocument();
  });

  it("never renders two create affordances at once, whether or not the section has items", () => {
    const createAction = makeCreateAction();
    const { rerenderWith } = renderSheet({ createAction, emptyCreateAction: createAction });

    expect(screen.getAllByRole("button", { name: "New dashboard" })).toHaveLength(1);

    rerenderWith({ items: [] });

    expect(screen.getAllByRole("button", { name: "New dashboard" })).toHaveLength(1);
  });

  it("shows the shared EmptyState primitive (not a bare paragraph) when there are no items", () => {
    renderSheet({ items: [] });

    expect(screen.getByText("No dashboards yet")).toBeInTheDocument();
    expect(
      screen.getByText("Create your first dashboard to start visualizing data."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ops Overview/ })).not.toBeInTheDocument();
    expect(document.querySelector(".mobile-nav-sheet__empty")).not.toBeInTheDocument();
  });

  it("renders the empty branch message-only (no CTA) when the section has no create action", () => {
    renderSheet({ items: [], createAction: null, emptyCreateAction: null });

    expect(screen.queryByRole("button", { name: "New dashboard" })).not.toBeInTheDocument();
  });

  it("renders the empty branch's CTA from emptyCreateAction, not createAction", () => {
    const headerAction = makeCreateAction({ cta: { label: "Header action", onClick: jest.fn() } });
    const emptyAction = makeCreateAction({ cta: { label: "Empty action", onClick: jest.fn() } });
    renderSheet({ items: [], createAction: headerAction, emptyCreateAction: emptyAction });

    expect(screen.getByRole("button", { name: "Empty action" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Header action" })).not.toBeInTheDocument();
  });

  it("takes the header create action's label and icon from the hook's cta, authoring no local strings", () => {
    renderSheet({
      createAction: makeCreateAction({
        cta: {
          label: "New dashboard",
          icon: <span data-testid="create-icon" />,
          onClick: jest.fn(),
        },
      }),
    });

    const button = screen.getByRole("button", { name: "New dashboard" });
    expect(button).toHaveTextContent("New dashboard");
    expect(button.querySelector('[data-testid="create-icon"]')).toBeInTheDocument();
    expect(button.textContent).not.toMatch(/\+/);
  });

  it("gives the header create action a 44px min-height at the mobile breakpoint (CSS lock covers computed value)", () => {
    renderSheet({ createAction: makeCreateAction() });

    expect(screen.getByRole("button", { name: "New dashboard" })).toHaveClass(
      "mobile-nav-sheet__create-action",
    );
  });

  it("clicking the create action runs the hook's onClick", () => {
    const onClick = jest.fn();
    renderSheet({ createAction: makeCreateAction({ cta: { label: "New dashboard", onClick } }) });

    fireEvent.click(screen.getByRole("button", { name: "New dashboard" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // design.md D9 — flag-flip actions (sources/pipelines/registry) dismiss
  // the sheet as soon as they fire, since `isPending`/`error` never change.
  it("dismisses immediately when a create action that cannot fail (isPending always false) is fired", async () => {
    const onClick = jest.fn();
    const { onClose } = renderSheet({
      createAction: makeCreateAction({ cta: { label: "Add source", onClick } }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Add source" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  // design.md D9 — dashboards' create action can go pending; the sheet must
  // stay open while pending, and only its own true -> false transition
  // (with error === null) should dismiss it. Uses `renderPendingCapableHarness`
  // (a real `useState`-backed stand-in), not a manually-rerendered prop —
  // see that helper's docblock for why a plain prop swap can't reproduce the
  // real hook's same-tick pending flip.
  it("keeps the sheet open while a pending create action is in flight, then dismisses on success", async () => {
    const { onClose, settle } = renderPendingCapableHarness();

    fireEvent.click(screen.getByRole("button", { name: "New dashboard" }));
    expect(onClose).not.toHaveBeenCalled();
    // Pending state is not disabled (design.md D9/task 3.8).
    expect(screen.getByRole("button", { name: "Creating..." })).not.toBeDisabled();

    settle();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("stays open and shows an error-intent EmptyState in the empty branch when a create action fails", async () => {
    const { onClose, settle } = renderPendingCapableHarness({ items: [], shouldFail: true });

    fireEvent.click(screen.getByRole("button", { name: "New dashboard" }));
    settle();

    expect(await screen.findByText("Failed to create dashboard.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the shared inline-error primitive beside the header action in the list branch when a create fails", async () => {
    const { onClose, settle } = renderPendingCapableHarness({ shouldFail: true });

    fireEvent.click(screen.getByRole("button", { name: "New dashboard" }));
    settle();

    expect(await screen.findByText("Failed to create dashboard.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not resurface a stale failure when the sheet is reopened", () => {
    const onClick = jest.fn();
    const idleAction = makeCreateAction({ cta: { label: "New dashboard", onClick } });
    const { rerenderWith } = renderSheet({
      createAction: idleAction,
      emptyCreateAction: idleAction,
    });

    fireEvent.click(screen.getByRole("button", { name: "New dashboard" }));

    const failedAction = makeCreateAction({
      cta: { label: "New dashboard", onClick },
      error: "Failed to create dashboard.",
    });
    rerenderWith({ open: false, createAction: failedAction, emptyCreateAction: failedAction });

    // Reopen with the SAME (still-failed) action reference — the hook's
    // state genuinely persists across opens (`MobileShell` never unmounts).
    rerenderWith({ open: true, createAction: failedAction, emptyCreateAction: failedAction });

    expect(screen.queryByText("Failed to create dashboard.")).not.toBeInTheDocument();
  });

  // CR1/CR2 (evaluation-1.md cycle 2) — a stale `attemptFired` surviving a
  // close used to self-close the very next open again (a ~14ms flash
  // requiring a second tap). The stable `jest.fn()` every other test in
  // this file passes as `onClose` cannot observe this: `App.tsx` recreates
  // its `onClose` closure on every `AppShell` render (an inline arrow, not
  // memoized), and that identity churn is what makes the dismissal effect
  // re-evaluate on the reopen render in the first place — a fixed mock
  // reference across `rerenderWith` calls never exercises that path. This
  // test passes a genuinely NEW `onClose` on every rerender, mirroring
  // `App.tsx:199`, and was confirmed red against the pre-fix code (the
  // reopened session's own fresh `onClose` fired immediately) before this
  // fix landed.
  it("does not call the reopened session's onClose after a create action fired in a prior session, even with a fresh onClose identity every render", () => {
    const onCloseSession1 = jest.fn();
    const flagFlipAction = makeCreateAction({ cta: { label: "Add source", onClick: jest.fn() } });
    const { rerenderWith } = renderSheet({
      onClose: onCloseSession1,
      createAction: flagFlipAction,
      emptyCreateAction: flagFlipAction,
    });

    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    expect(onCloseSession1).toHaveBeenCalledTimes(1);

    // Mirrors AppShell reacting to onCloseSession1 by setting
    // isMobileNavSheetOpen(false) and re-rendering with a fresh closure.
    const onCloseAfterClose = jest.fn();
    rerenderWith({ open: false, onClose: onCloseAfterClose });

    // Mirrors the user tapping the trigger again — AppShell re-renders with
    // open:true and yet another fresh onClose closure.
    const onCloseReopen = jest.fn();
    rerenderWith({ open: true, onClose: onCloseReopen });

    expect(onCloseReopen).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("focuses the active item on open, never the create action", () => {
    renderSheet({ createAction: makeCreateAction() });

    expect(screen.getByRole("button", { name: /Ops Overview/ })).toHaveFocus();
  });

  it("focuses the first item on open when none is active", () => {
    renderSheet({
      items: [
        { id: "dash-1", name: "Ops Overview", isActive: false },
        { id: "dash-2", name: "Growth", isActive: false },
      ],
      createAction: makeCreateAction(),
    });

    expect(screen.getByRole("button", { name: /Ops Overview/ })).toHaveFocus();
  });

  it("focuses the panel itself on open when the list is empty, never the empty-branch CTA", () => {
    renderSheet({
      items: [],
      createAction: makeCreateAction(),
      emptyCreateAction: makeCreateAction(),
    });

    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("restores focus to the trigger on close", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const { rerender } = render(
      <OverlayProvider>
        <MobileNavSheet
          open
          onClose={jest.fn()}
          title="Dashboards"
          items={items}
          onSelect={jest.fn()}
          emptyState={emptyState}
          createAction={null}
          emptyCreateAction={null}
        />
      </OverlayProvider>,
    );
    expect(trigger).not.toHaveFocus();

    rerender(
      <OverlayProvider>
        <MobileNavSheet
          open={false}
          onClose={jest.fn()}
          title="Dashboards"
          items={items}
          onSelect={jest.fn()}
          emptyState={emptyState}
          createAction={null}
          emptyCreateAction={null}
        />
      </OverlayProvider>,
    );

    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("dismisses on an upward drag past the threshold", () => {
    const { onClose } = renderSheet();

    const dragStrip = document.querySelector(".mobile-nav-sheet__drag-strip") as HTMLElement;
    fireEvent.pointerDown(dragStrip, { clientY: 300 });
    fireEvent.pointerMove(dragStrip, { clientY: 300 - 120 });
    fireEvent.pointerUp(dragStrip);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss on an upward drag under the threshold", () => {
    const { onClose } = renderSheet();

    const dragStrip = document.querySelector(".mobile-nav-sheet__drag-strip") as HTMLElement;
    fireEvent.pointerDown(dragStrip, { clientY: 300 });
    fireEvent.pointerMove(dragStrip, { clientY: 300 - 30 });
    fireEvent.pointerUp(dragStrip);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not dismiss on a downward drag (clamped to upward-only)", () => {
    const { onClose } = renderSheet();

    const dragStrip = document.querySelector(".mobile-nav-sheet__drag-strip") as HTMLElement;
    fireEvent.pointerDown(dragStrip, { clientY: 300 });
    fireEvent.pointerMove(dragStrip, { clientY: 300 + 200 });
    fireEvent.pointerUp(dragStrip);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders the provenance subtitle for an item that sets one", () => {
    renderSheet({
      items: [
        { id: "type-1", name: "RevenueRow", isActive: false, subtitle: "Pipeline: Revenue ETL" },
      ],
    });

    const item = screen.getByRole("button", { name: /RevenueRow/ });
    expect(item.querySelector(".mobile-nav-sheet__item-subtitle")).toHaveTextContent(
      "Pipeline: Revenue ETL",
    );
  });

  it("renders no subtitle element for an item that omits one", () => {
    renderSheet({ items: [{ id: "type-1", name: "RevenueRow", isActive: false }] });

    const item = screen.getByRole("button", { name: /RevenueRow/ });
    expect(item.querySelector(".mobile-nav-sheet__item-subtitle")).not.toBeInTheDocument();
  });
});
