import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import {
  makeDividerPanel,
  makeFormPanel,
  makeImagePanel,
  makeMarkdownPanel,
  makeOutputPanel,
  makeTextPanel,
} from "../../../test/panelFixtures";
import {
  getAssertionStatus as getAssertionStatusRequest,
  getOutputRows as getOutputRowsRequest,
} from "../../pipelines/services/outputService";
import { usePanelData } from "../hooks/usePanelData";
import { PanelCard } from "./PanelCard";

// jest.fn() (not a plain factory function), matching MobilePanelStack.test.tsx's
// convention — HEL-539's retry test below overrides the return value to
// simulate a failed fetch.
jest.mock("../hooks/usePanelData", () => ({
  usePanelData: jest.fn(() => ({
    data: null,
    rawRows: null,
    headers: null,
    isLoading: false,
    error: null,
    errorKind: null,
    noData: true,
    neverMaterialized: false,
    rowsTruncated: false,
    refresh: jest.fn(),
    isRefreshing: false,
  })),
}));

const mockUsePanelData = jest.mocked(usePanelData);
// HEL-579 task 2.8 — the real hook (not the module-level mock above), used
// only by the reference-stability describe block at the bottom of this file,
// which needs `usePanelData`'s genuine `useCallback`/`useMemo` stability to
// prove anything about `PanelCardBody`'s `React.memo` bail-out.
const actualUsePanelData = jest.requireActual<{ usePanelData: typeof usePanelData }>(
  "../hooks/usePanelData",
).usePanelData;

jest.mock("../hooks/usePanelPolling", () => ({
  usePanelPolling: jest.fn(),
}));

// HEL-579 task 2.8 — `usePanelRunRefresh` internally calls `useOutputMeta`,
// which owns its OWN internal `useState`/async-fetch cycle entirely
// independent of `usePanelData`/memo props (see `PanelCardBody.fanoutStatus.
// test.tsx`'s identical mock). Left real, its async `setIsLoading` landing at
// an indeterminate microtask tick causes `PanelCardBody` to re-render for a
// reason that has nothing to do with prop stability, confounding the
// reference-stability assertions in the last describe block below.
jest.mock("../hooks/usePanelRunRefresh", () => ({
  usePanelRunRefresh: jest.fn(),
}));

jest.mock("../../pipelines/services/outputService", () => ({
  getAssertionStatus: jest.fn(),
  getOutputById: jest.fn(() => new Promise(() => {})), // never resolves — body stays a skeleton
  // HEL-579 task 2.8 — never resolves either, so the real `usePanelData`'s
  // pending pagination state is stable for the whole test (no store update
  // firing a SECOND, data-driven re-render that would confound the
  // "unrelated re-render" assertion).
  getOutputRows: jest.fn(() => new Promise(() => {})),
}));

const getAssertionStatusMock = jest.mocked(getAssertionStatusRequest);
const getOutputRowsMock = jest.mocked(getOutputRowsRequest);

jest.mock("../services/panelService", () => ({
  duplicatePanel: jest.fn(),
  fetchPanels: jest.fn(),
}));

// Every callback prop is a no-op stub — this suite only exercises the
// HEL-576 invalid-data badge / fetch-dispatch behavior, not the card's
// drag/rename/delete interactions (covered elsewhere via PanelGrid).
const noopProps = {
  theme: "dark" as const,
  isDragging: false,
  dashboardId: "d1",
  isEditingTitle: false,
  editingTitle: "",
  editingTitleError: null,
  isConfirmingDelete: false,
  onMouseDown: jest.fn(),
  onCardClick: jest.fn(),
  onStartEdit: jest.fn(),
  onTitleChange: jest.fn(),
  onTitleKeyDown: jest.fn(),
  onTitleBlur: jest.fn(),
  onRequestDelete: jest.fn(),
  onCancelDelete: jest.fn(),
  onDetail: jest.fn(),
};

// HEL-579 design.md Goals / spec.md "no Refresh control for a non-output
// panel" — the control is gated on `getOutputId(panel)`, computed from the
// real `panel` prop (not the mocked hook), so this exercises the real gate
// regardless of what `usePanelData` returns.
describe("PanelCard — HEL-579 manual refresh control placement (tasks 2.4/2.5)", () => {
  beforeEach(() => {
    getAssertionStatusMock.mockReset();
    getAssertionStatusMock.mockResolvedValue({
      outputId: "output-1",
      invalid: false,
      failedRuleCount: 0,
    });
    mockUsePanelData.mockReturnValue({
      data: null,
      rawRows: null,
      headers: null,
      isLoading: false,
      error: null,
      errorKind: null,
      noData: true,
      neverMaterialized: false,
      rowsTruncated: false,
      refresh: jest.fn(),
      isRefreshing: false,
    });
  });

  it("renders a Refresh control for an output-bound panel", () => {
    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    expect(screen.getByRole("button", { name: "Refresh Revenue" })).toBeInTheDocument();
  });

  it.each([
    ["markdown", () => makeMarkdownPanel({ title: "Notes" })],
    ["image", () => makeImagePanel({ title: "Logo" })],
    ["divider", () => makeDividerPanel({ title: "Sep" })],
    ["form", () => makeFormPanel({ title: "Intake" })],
  ] as const)("renders no Refresh control for a %s panel (no bound Output)", (_kind, makePanel) => {
    const panel = makePanel();
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    expect(screen.queryByRole("button", { name: /^Refresh /i })).not.toBeInTheDocument();
  });
});

// HEL-579 design.md D3 / spec.md "repeat manual activation while loading is
// a no-op" — the component-level guard (`disabled={isRefreshing}`), belt-
// and-suspenders on top of the hook-level guard (task 1.1).
describe("PanelCard — HEL-579 manual refresh activation + guard (tasks 2.6/2.7)", () => {
  beforeEach(() => {
    getAssertionStatusMock.mockReset();
    getAssertionStatusMock.mockResolvedValue({
      outputId: "output-1",
      invalid: false,
      failedRuleCount: 0,
    });
  });

  it("activating the control calls refresh()", () => {
    const refresh = jest.fn();
    mockUsePanelData.mockReturnValue({
      data: null,
      rawRows: null,
      headers: null,
      isLoading: false,
      error: null,
      errorKind: null,
      noData: true,
      neverMaterialized: false,
      rowsTruncated: false,
      refresh,
      isRefreshing: false,
    });
    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    fireEvent.click(screen.getByRole("button", { name: "Refresh Revenue" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("activating it again while isRefreshing is true does not call refresh() again (disabled, native button)", () => {
    const refresh = jest.fn();
    mockUsePanelData.mockReturnValue({
      data: null,
      rawRows: null,
      headers: null,
      isLoading: false,
      error: null,
      errorKind: null,
      noData: true,
      neverMaterialized: false,
      rowsTruncated: false,
      refresh,
      isRefreshing: true,
    });
    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    const button = screen.getByRole("button", { name: "Refresh Revenue" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(refresh).not.toHaveBeenCalled();
  });

  // Matches AnalyzeWithAiConfig.test.tsx's established convention for this
  // codebase: `@testing-library/user-event` is not a dependency, so a native
  // `<button>`'s Enter/Space activation is verified as two platform
  // guarantees rather than a synthesized keypress — (1) genuinely focusable
  // and in the tab order (real `<button>`, no `tabindex="-1"`, not
  // `aria-hidden`, not disabled) and (2) a click (the SAME handler Enter/
  // Space would reach) activates it.
  it("the control is a real, focusable, non-disabled button reachable by keyboard", () => {
    const refresh = jest.fn();
    mockUsePanelData.mockReturnValue({
      data: null,
      rawRows: null,
      headers: null,
      isLoading: false,
      error: null,
      errorKind: null,
      noData: true,
      neverMaterialized: false,
      rowsTruncated: false,
      refresh,
      isRefreshing: false,
    });
    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    const button = screen.getByRole("button", { name: "Refresh Revenue" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute("tabindex", "-1");
    expect(button).not.toHaveAttribute("aria-hidden");

    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

// HEL-584 tasks.md 1.1/1.2/2.2/4.1/4.2 — jsdom does not implement
// showModal/close natively; stub them the same way Modal.test.tsx does
// (moving focus into the dialog's first focusable descendant on open) so
// the focus-restore assertion below is meaningful, not vacuously true — see
// that file's own comment for the mutation-tested rationale.
const DIALOG_FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

describe("PanelCard — HEL-584 fullscreen/focus mode (tasks 2.1/2.2/4.1/4.2)", () => {
  beforeEach(() => {
    getAssertionStatusMock.mockReset();
    getAssertionStatusMock.mockResolvedValue({
      outputId: "output-1",
      invalid: false,
      failedRuleCount: 0,
    });
    // noData: false (unlike this file's other describe blocks) — several
    // tests below assert the panel's REAL content renders (in the card and
    // the overlay), which `PanelContent` short-circuits past with a "No data
    // available" state whenever `noData` is true, regardless of panel kind.
    mockUsePanelData.mockReturnValue({
      data: null,
      rawRows: null,
      headers: null,
      isLoading: false,
      error: null,
      errorKind: null,
      noData: false,
      neverMaterialized: false,
      rowsTruncated: false,
      refresh: jest.fn(),
      isRefreshing: false,
    });
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
      const first = this.querySelector<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR);
      first?.focus();
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    });
  });

  // spec.md "Fullscreen control on eligible panel kinds" — output/text/
  // markdown/image get the control; divider/form (config.6) do not.
  it.each([
    ["output", () => makeOutputPanel({ title: "Revenue" })],
    ["text", () => makeTextPanel({ title: "Caption" })],
    ["markdown", () => makeMarkdownPanel({ title: "Notes" })],
    ["image", () => makeImagePanel({ title: "Logo" })],
  ] as const)("renders a Fullscreen control for a %s panel", async (_kind, makePanel) => {
    const panel = makePanel();
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    expect(screen.getByRole("button", { name: `Fullscreen ${panel.title}` })).toBeInTheDocument();

    // The card body's own `PanelContent` (unrelated to the Fullscreen
    // control under test) may render via a `React.lazy` renderer (markdown
    // — HEL-512); this settles it before the test ends so its resolution is
    // never observed outside `act()` during RTL's automatic unmount.
    await waitFor(() => {});
  });

  it.each([
    ["divider", () => makeDividerPanel({ title: "Sep" })],
    ["form", () => makeFormPanel({ title: "Intake" })],
  ] as const)("renders no Fullscreen control for a %s panel", (_kind, makePanel) => {
    const panel = makePanel();
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    expect(screen.queryByRole("button", { name: /^Fullscreen /i })).not.toBeInTheDocument();
  });

  it("activating the Fullscreen control opens the overlay showing the same content via the shared renderer", async () => {
    const panel = makeMarkdownPanel({ title: "Notes", config: { content: "Panel body content" } });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    // The card itself already renders the content once.
    expect(screen.getByText("Panel body content")).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Fullscreen Notes" });
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Notes fullscreen" });
    // Scoped to the dialog: proves the overlay renders the SAME content via
    // the SAME renderer, not merely that the text exists somewhere on the
    // page (it already does, in the card behind it). `MarkdownRenderer` is a
    // `React.lazy` target (HEL-512) — awaited rather than asserted
    // synchronously, mirroring `PanelContent.test.tsx`'s convention.
    expect(await within(dialog).findByText("Panel body content")).toBeInTheDocument();
  });

  it("the fullscreen overlay renders no editing controls (view-only, spec.md)", async () => {
    const panel = makeMarkdownPanel({ title: "Notes", config: { content: "Panel body content" } });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    fireEvent.click(screen.getByRole("button", { name: "Fullscreen Notes" }));
    const dialog = await screen.findByRole("dialog", { name: "Notes fullscreen" });
    await within(dialog).findByText("Panel body content");

    expect(within(dialog).queryByRole("button", { name: /rename|customize|delete/i })).toBeNull();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
  });

  // spec.md "Closing restores focus" — Esc is Modal's native `cancel` event.
  it("Esc closes the overlay and restores focus to the Fullscreen button that opened it (spec.md)", async () => {
    const panel = makeMarkdownPanel({ title: "Notes", config: { content: "Panel body content" } });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });

    const trigger = screen.getByRole("button", { name: "Fullscreen Notes" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Notes fullscreen" });
    // Lets the lazily-loaded MarkdownRenderer settle before closing, so its
    // chunk-resolution promise doesn't land outside `act()` after the
    // overlay's body unmounts (the same reasoning as the two tests above).
    await within(dialog).findByText("Panel body content");
    // The stubbed showModal() above moved focus into the dialog — confirms
    // focus genuinely left the trigger, so the restore assertion below is
    // not vacuously true (mirrors Modal.test.tsx's own CR1 rationale).
    expect(document.activeElement).not.toBe(trigger);

    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    expect(document.activeElement).toBe(trigger);
  });

  it("opening fullscreen for an output panel triggers no additional data fetch (design.md Decision 2)", async () => {
    getOutputRowsMock.mockReset();
    getOutputRowsMock.mockReturnValue(new Promise(() => {})); // never resolves — no render-driven noise
    mockUsePanelData.mockImplementation(actualUsePanelData);

    const panel = makeOutputPanel({ title: "Revenue", config: { outputId: "output-9" } });
    renderWithStore(<PanelCard panel={panel} {...noopProps} />, { panels: { items: [] } });
    await waitFor(() => expect(getOutputRowsMock).toHaveBeenCalledTimes(1));

    const trigger = screen.getByRole("button", { name: "Fullscreen Revenue" });
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Revenue fullscreen" });

    // Opening the overlay re-renders PanelCard (new isFullscreenOpen state)
    // but must not trigger a SECOND, independent fetch for the same panel —
    // the overlay consumes the caller's existing `usePanelData` result as
    // props (design.md Decision 2), never calling the hook itself (also
    // statically proven in PanelFullscreenOverlay.test.tsx).
    expect(getOutputRowsMock).toHaveBeenCalledTimes(1);

    mockUsePanelData.mockReset();
  });
});
