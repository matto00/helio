import fs from "fs";
import path from "path";
import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeMarkdownPanel, makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../pipelines/services/outputService";
import type { Output } from "../../pipelines/types/output";
import { PanelFullscreenOverlay } from "./PanelFullscreenOverlay";

// HEL-584 tasks.md 1.1/1.2 — jsdom does not implement showModal/close
// natively; stub them the same way Modal.test.tsx does (moving focus into
// the dialog's first focusable descendant on open), so the focus-restore
// assertion below is meaningful rather than vacuously true — see that
// file's own comment for the mutation-tested rationale (deleting Modal's
// restore-on-close effect left every such assertion green before this
// stub existed).
const DIALOG_FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

beforeEach(() => {
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

jest.mock("../../pipelines/services/outputService", () => ({
  getOutputById: jest.fn(),
}));

// HEL-584 tasks.md 3.1 / design.md Decision 5 — mirrors ChartPanel.test.tsx's
// own mock exactly: `echarts-for-react`'s real implementation binds a resize
// sensor via `ResizeObserver` (absent in jsdom) against real layout (jsdom
// implements none), so no DOM-rendering Jest test can observe an actual
// resize firing. What CAN be verified mechanically: that `ChartPanel`
// (unmodified — no fork) still reaches `ReactECharts` with `autoResize`
// wired exactly as it does on the grid card, i.e. opening fullscreen doesn't
// silently disable the mechanism that already re-fits `PanelDetailModal`'s
// own `size="full"` view mode. Combined with `PanelFullscreenOverlay.css.
// test.ts`'s definite-height proof (the real box `autoResize` needs to
// measure), this is the evidence design.md Decision 5 calls for without
// fabricating a pixel measurement jsdom cannot make real.
jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option, autoResize }: { option: unknown; autoResize?: boolean }) => (
    <div
      data-testid="echarts"
      data-option={JSON.stringify(option)}
      data-autoresize={String(autoResize)}
    />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));

const getOutputByIdMock = jest.mocked(getOutputByIdRequest);

function makeOutput(overrides: Partial<Output> = {}): Output {
  return {
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Test Output",
    kind: "chart",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

const basePanelDataProps = {
  data: null,
  rawRows: null,
  headers: null,
  isLoading: false,
  error: null,
  errorKind: null,
  noData: false,
  neverMaterialized: false,
  chartAggregate: null,
  rowsTruncated: false,
  refresh: jest.fn(),
};

beforeEach(() => {
  getOutputByIdMock.mockReset();
});

// `markdown`-kind content renders via `MarkdownRenderer`, which is a
// `React.lazy` target (HEL-512, see that file's own comment) — every
// assertion on its rendered content awaits `screen.findBy*` rather than
// asserting synchronously, mirroring `PanelContent.test.tsx`'s established
// convention for exactly this reason.
describe("PanelFullscreenOverlay — HEL-584 task 1.1 (standalone render)", () => {
  it("renders the panel title and its content", async () => {
    const panel = makeMarkdownPanel({ title: "Notes", config: { content: "hello world" } });
    renderWithStore(
      <PanelFullscreenOverlay panel={panel} open onClose={jest.fn()} {...basePanelDataProps} />,
    );
    expect(screen.getByRole("heading", { name: "Notes" })).toBeInTheDocument();
    expect(await screen.findByText("hello world")).toBeInTheDocument();
  });

  it("renders a mono eyebrow naming the panel's content kind", () => {
    const panel = makeMarkdownPanel({ title: "Notes" });
    renderWithStore(
      <PanelFullscreenOverlay panel={panel} open onClose={jest.fn()} {...basePanelDataProps} />,
    );
    expect(screen.getByText("markdown")).toHaveClass("eyebrow");
  });

  it('applies the Modal size="full" preset via the definite-height overlay class', () => {
    const panel = makeMarkdownPanel({ title: "Notes" });
    renderWithStore(
      <PanelFullscreenOverlay panel={panel} open onClose={jest.fn()} {...basePanelDataProps} />,
    );
    const dialog = document.querySelector("dialog")!;
    expect(dialog).toHaveClass("ui-modal--full", "panel-fullscreen-overlay");
  });

  it("renders no editing controls (view-only)", async () => {
    const panel = makeMarkdownPanel({ title: "Notes", config: { content: "hello world" } });
    renderWithStore(
      <PanelFullscreenOverlay panel={panel} open onClose={jest.fn()} {...basePanelDataProps} />,
    );
    await screen.findByText("hello world");
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("PanelFullscreenOverlay — HEL-584 task 1.2 (Esc / close button / backdrop)", () => {
  function renderOverlay(onClose = jest.fn()) {
    const panel = makeMarkdownPanel({ title: "Notes" });
    return {
      onClose,
      ...renderWithStore(
        <PanelFullscreenOverlay panel={panel} open onClose={onClose} {...basePanelDataProps} />,
      ),
    };
  }

  it("invokes onClose exactly once on Esc (Modal's native cancel event)", () => {
    const { onClose } = renderOverlay();
    const dialog = document.querySelector("dialog")!;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("invokes onClose exactly once when the close button is clicked", () => {
    const { onClose } = renderOverlay();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("invokes onClose exactly once on a backdrop (dialog element) click", () => {
    const { onClose } = renderOverlay();
    const dialog = document.querySelector("dialog")!;
    fireEvent.click(dialog, { target: dialog });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT invoke onClose when inner content is clicked", () => {
    const { onClose } = renderOverlay();
    fireEvent.click(screen.getByText("markdown"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("PanelFullscreenOverlay — HEL-584 task 2.1 (fed by props, never a second fetch)", () => {
  // tasks.md 2.1's own check: "grep PanelFullscreenOverlay.tsx for
  // usePanelData; must be zero hits" — read literally as "zero CALLS to the
  // hook" (a call-shaped pattern, `usePanelData(`), since design.md
  // Decision 2 explicitly requires importing the hook's own `PanelDataResult`
  // TYPE (an unavoidable, non-call reference to the same module path) to
  // reuse `PanelCardBody`'s exact props shape.
  it("never calls the usePanelData hook itself (only imports its PanelDataResult type)", () => {
    const source = fs.readFileSync(path.join(__dirname, "PanelFullscreenOverlay.tsx"), "utf-8");
    expect(source).not.toMatch(/usePanelData\s*\(/);
    expect(source).toMatch(/import type \{ PanelDataResult \} from "..\/hooks\/usePanelData"/);
  });
});

describe("PanelFullscreenOverlay — HEL-584 task 3.1 (chart resize wiring, design.md Decision 5)", () => {
  it("reuses ChartPanel unmodified: ReactECharts still receives autoResize=true inside the overlay", async () => {
    getOutputByIdMock.mockResolvedValue(makeOutput({ kind: "chart" }));
    const panel = makeOutputPanel({ title: "Revenue" });
    renderWithStore(
      <PanelFullscreenOverlay panel={panel} open onClose={jest.fn()} {...basePanelDataProps} />,
    );
    const chart = await screen.findByTestId("echarts");
    expect(chart).toHaveAttribute("data-autoresize", "true");
  });
});
