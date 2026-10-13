// HEL-1449 (owner ruling scroll-hint) -- the edit form signals off-screen content with top/bottom
// scroll-fades. The modal opens in VIEW mode and the edit form mounts later, so the measurement
// stubs are installed BEFORE toggling to edit: a `useScrollEdges` call in the modal itself (rather
// than in `EditFormScrollArea`, which mounts with the form) would never attach to the form.

import { act, fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../../pipelines/services/outputService";
import type { Output } from "../../../pipelines/types/output";
import { usePanelData } from "../../hooks/usePanelData";
import { PanelDetailModal } from "./PanelDetailModal";

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));
jest.mock("../echartsCore", () => ({ __esModule: true, default: {} }));
jest.mock("../../hooks/usePanelData", () => ({ usePanelData: jest.fn() }));
jest.mock("../../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputById: jest.fn(),
  getAssertionStatus: jest.fn(() => new Promise(() => {})),
  listOutputPanels: jest.fn(() => Promise.resolve([])),
  getDistinctValues: jest.fn(() => Promise.resolve({ values: [] })),
  getFilterCapabilities: jest.fn(() => Promise.resolve({ columns: [] })),
}));

const output: Output = {
  id: "output-1",
  pipelineId: "pipe-1",
  ownerId: "u1",
  name: "Revenue",
  kind: "chart",
  config: { chartType: "bar", fieldMapping: { xAxis: "region", yAxis: "amount" } },
  schema: [],
  createdAt: "",
  updatedAt: "",
};

const FORM_CLASS = "panel-detail-modal__content";
const metrics = { scrollHeight: 0, clientHeight: 0, scrollTop: 0 };
const originals = new Map<string, PropertyDescriptor | undefined>();

/** jsdom does no layout: serve the stubbed metrics for the edit form only (every other element
 *  keeps jsdom's own 0), via prototype getters so they are in place before the form exists. */
function stubFormMetrics() {
  for (const key of ["scrollHeight", "clientHeight", "scrollTop"] as const) {
    originals.set(key, Object.getOwnPropertyDescriptor(Element.prototype, key));
    Object.defineProperty(Element.prototype, key, {
      configurable: true,
      get(this: Element) {
        return this.classList.contains(FORM_CLASS) ? metrics[key] : 0;
      },
    });
  }
}

function restoreFormMetrics() {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(Element.prototype, key, descriptor);
    else delete (Element.prototype as unknown as Record<string, unknown>)[key];
  }
  originals.clear();
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.mocked(getOutputByIdRequest).mockResolvedValue(output);
  jest.mocked(usePanelData).mockReturnValue({
    data: null,
    rawRows: [["east", "10"]],
    headers: ["region", "amount"],
    isLoading: false,
    error: null,
    errorKind: null,
    noData: false,
    neverMaterialized: false,
    paginationRows: [{ region: "east", amount: 10 }],
    rowsTruncated: false,
    refresh: jest.fn(),
    isRefreshing: false,
  });
  stubFormMetrics();
});

afterEach(restoreFormMetrics);

async function startInViewThenEdit() {
  const panel = makeOutputPanel({ id: "p1", title: "Revenue" });
  renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />, {
    panels: { items: [panel] },
  });
  await screen.findByTestId("echarts");
  // View mode: the edit form (and its overlay) must not exist yet.
  expect(document.querySelector(".panel-detail-modal__scroll-fade")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
  await act(async () => {});
  const fade = document.querySelector(".panel-detail-modal__scroll-fade");
  const form = document.querySelector(`.${FORM_CLASS}`);
  if (!fade || !form) throw new Error("edit form not mounted");
  return { fade, form };
}

describe("PanelDetailModal edit-form scroll-fades (HEL-1449)", () => {
  it("shows a bottom fade and no top fade when content extends below the fold", async () => {
    Object.assign(metrics, { scrollHeight: 900, clientHeight: 300, scrollTop: 0 });
    const { fade } = await startInViewThenEdit();
    expect(fade).toHaveClass("panel-detail-modal__scroll-fade--bottom");
    expect(fade).not.toHaveClass("panel-detail-modal__scroll-fade--top");
    expect(fade).toHaveAttribute("aria-hidden", "true");
  });

  it("swaps to a top fade once scrolled to the end", async () => {
    Object.assign(metrics, { scrollHeight: 900, clientHeight: 300, scrollTop: 0 });
    const { fade, form } = await startInViewThenEdit();
    metrics.scrollTop = 600;
    fireEvent.scroll(form);
    expect(fade).toHaveClass("panel-detail-modal__scroll-fade--top");
    expect(fade).not.toHaveClass("panel-detail-modal__scroll-fade--bottom");
  });

  it("shows no fade when the content fits", async () => {
    Object.assign(metrics, { scrollHeight: 300, clientHeight: 300, scrollTop: 0 });
    const { fade } = await startInViewThenEdit();
    expect(fade).not.toHaveClass("panel-detail-modal__scroll-fade--top");
    expect(fade).not.toHaveClass("panel-detail-modal__scroll-fade--bottom");
  });
});
