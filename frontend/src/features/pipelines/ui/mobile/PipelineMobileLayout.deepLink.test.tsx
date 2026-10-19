// HEL-1668 D1: a phone `?step=` deep link opens that step's sheet; the URL then follows the open step (replace-only,
// other params kept). The deep link is consumed once, at the page's first steps load.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { httpClient } from "../../../../services/httpClient";
import {
  analyzePipeline,
  deletePipelineStep,
  fetchRunHistory,
  fetchStepPreview,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
} from "../../services/pipelineService";
import {
  SPINE_PIPELINE,
  analyzeFor,
  renderSpinePageSettled,
  threeSteps,
} from "../pipelineSpineTestKit";
import {
  closeStepSheet,
  findStepRow,
  openStepSheet,
  queryStepSheet,
  stepSheet,
  stubDialogMethods,
} from "../pipelineMobileTestKit";

jest.mock("../../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../../sources/services/dataSourceService", () => ({
  ...jest.requireActual("../../../sources/services/dataSourceService"),
  fetchSources: jest.fn(() => Promise.reject(new Error("unmocked"))),
}));
jest.mock("../../services/pipelineService", () => ({
  fetchPipelines: jest.fn(),
  runPipeline: jest.fn(),
  fetchRunHistory: jest.fn(),
  getPipelineById: jest.fn(),
  getPipelineSteps: jest.fn(),
  updatePipeline: jest.fn(),
  updatePipelineStep: jest.fn(),
  createPipelineStep: jest.fn(),
  deletePipelineStep: jest.fn(),
  analyzePipeline: jest.fn(),
  fetchStepPreview: jest.fn(),
  getPipelineSchedule: jest.fn(),
  putPipelineSchedule: jest.fn(),
  deletePipelineSchedule: jest.fn(),
  getPipelineShapeCatalog: jest.fn(),
  getPipelineStepCatalog: jest.fn(),
  expandPipelineShape: jest.fn(),
  reorderPipelineSteps: jest.fn(),
  updatePipelineStepEnabled: jest.fn(),
  duplicatePipelineStep: jest.fn(),
  listPipelinePermissions: jest.fn(),
  grantPipelinePermission: jest.fn(),
  revokePipelinePermission: jest.fn(),
  addPipelineRoot: jest.fn(),
  removePipelineRoot: jest.fn(),
}));

/** A controllable `(max-width: 768px)` matchMedia so a test can cross the phone boundary mid-page. */
function installSwitchablePhone(initial: boolean) {
  const original = window.matchMedia;
  let phone = initial;
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === "(max-width: 768px)" && phone;
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return {
    setPhone(next: boolean) {
      phone = next;
      act(() => listeners.forEach((l) => l()));
    },
    restore() {
      window.matchMedia = original;
    },
  };
}

let env: ReturnType<typeof installSwitchablePhone>;
const search = () => screen.getByTestId("location-search").textContent;

beforeAll(() => stubDialogMethods());
beforeEach(() => {
  env = installSwitchablePhone(true);
  jest.mocked(httpClient.get).mockResolvedValue({ data: { rows: [], rowCount: 0 } });
  jest.mocked(fetchRunHistory).mockResolvedValue([]);
  jest.mocked(getPipelineById).mockResolvedValue(SPINE_PIPELINE);
  jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
  jest.mocked(getPipelineSteps).mockResolvedValue(threeSteps());
  jest.mocked(analyzePipeline).mockResolvedValue(analyzeFor(threeSteps()));
  jest.mocked(fetchStepPreview).mockResolvedValue({ rows: [{ date: "x" }], rowCount: 1 });
  jest
    .mocked(getPipelineSchedule)
    .mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
});
afterEach(() => {
  env.restore();
  jest.clearAllMocks();
});

describe("phone ?step= deep link", () => {
  it("opens the named step's sheet once the steps have loaded", async () => {
    await renderSpinePageSettled(undefined, "/pipelines/pipe-1?step=s2");
    await waitFor(() => expect(stepSheet()).toBeInTheDocument());
    expect(within(stepSheet()).getByRole("region", { name: /Step 2 Sort/ })).toBeInTheDocument();
    expect(search()).toBe("?step=s2");
  });

  it("closing the sheet removes the parameter and keeps outputId", async () => {
    await renderSpinePageSettled(undefined, "/pipelines/pipe-1?step=s2&keep=1");
    await waitFor(() => expect(stepSheet()).toBeInTheDocument());
    await closeStepSheet();
    await waitFor(() => expect(search()).toBe("?keep=1"));
  });

  it("opening a step by tap writes its id; closing clears it", async () => {
    await renderSpinePageSettled();
    await findStepRow(/Filter rows/);
    openStepSheet(/Filter rows/);
    await waitFor(() => expect(search()).toBe("?step=s1"));
    await closeStepSheet();
    await waitFor(() => expect(search()).toBe(""));
  });

  it("removing the open step clears the parameter", async () => {
    await renderSpinePageSettled(undefined, "/pipelines/pipe-1?step=s2");
    await waitFor(() => expect(stepSheet()).toBeInTheDocument());
    jest.mocked(deletePipelineStep).mockResolvedValue(undefined);
    const [first, , third] = threeSteps();
    jest.mocked(getPipelineSteps).mockResolvedValue([first, { ...third, parentStepId: "s1" }]);
    await act(async () => {
      fireEvent.click(within(stepSheet()).getByRole("button", { name: "Remove step" }));
    });
    await waitFor(() => expect(queryStepSheet()).toBeNull());
    await waitFor(() => expect(search()).toBe(""));
  });

  it("an unknown step opens no sheet and is removed", async () => {
    await renderSpinePageSettled(undefined, "/pipelines/pipe-1?step=nope");
    await findStepRow(/Filter rows/);
    expect(queryStepSheet()).toBeNull();
    await waitFor(() => expect(search()).toBe(""));
  });

  it("a desktop page narrowed to a phone opens no sheet and clears the parameter", async () => {
    env.setPhone(false);
    await renderSpinePageSettled(undefined, "/pipelines/pipe-1?step=s2");
    await waitFor(() => expect(search()).toBe("?step=s2"));
    env.setPhone(true);
    await findStepRow(/Filter rows/);
    expect(queryStepSheet()).toBeNull();
    await waitFor(() => expect(search()).toBe(""));
  });

  it("a sheet open on the phone keeps ?step= when the page widens to desktop", async () => {
    await renderSpinePageSettled(undefined, "/pipelines/pipe-1?step=s2");
    await waitFor(() => expect(stepSheet()).toBeInTheDocument());
    env.setPhone(false);
    await waitFor(() => expect(search()).toBe("?step=s2"));
  });
});
