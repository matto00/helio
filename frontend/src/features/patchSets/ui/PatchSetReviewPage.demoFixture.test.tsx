import { configureStore } from "@reduxjs/toolkit";
import { render, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { patchSetsReducer } from "../state/patchSetsSlice";
import { fetchDashboards } from "../../dashboards/services/dashboardService";
import { fetchPanels } from "../../panels/services/panelService";
import { previewPatchSet } from "../services/patchSetService";
import { PatchSetReviewPage } from "./PatchSetReviewPage";
import type { Dashboard } from "../../dashboards/types/dashboard";
import type { Panel } from "../../panels/types/panel";

// HEL-1154 — `PatchSetReviewPage`'s DEV-only demo-fixture path
// (`IS_DEV && !location.state.patchSet`) is only reachable with `IS_DEV=true`;
// the shared `config/env` mock is `false`, so this scenario gets its own file
// with a local override (mirrors ProposalReviewPage.demoFixture.test.tsx).
jest.mock("../../../config/env", () => ({
  API_BASE_URL: "",
  IS_DEV: true,
}));
jest.mock("../../dashboards/services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
}));
jest.mock("../../panels/services/panelService", () => ({
  fetchPanels: jest.fn(),
}));
jest.mock("../services/patchSetService", () => ({
  previewPatchSet: jest.fn(),
  applyPatchSet: jest.fn(),
  undoPatchSet: jest.fn(),
}));

const mockedFetchDashboards = jest.mocked(fetchDashboards);
const mockedFetchPanels = jest.mocked(fetchPanels);
const mockedPreviewPatchSet = jest.mocked(previewPatchSet);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-01-01T00:00:00Z",
  lastUpdated: "2026-01-01T00:00:00Z",
};

const dashboard: Dashboard = {
  id: "dash-1",
  name: "Ops",
  meta: defaultMeta,
  appearance: { background: "transparent", gridBackground: "transparent" },
  layout: { lg: [], md: [], sm: [], xs: [] },
};

function panelTitled(title: string): Panel {
  return {
    id: "panel-1",
    dashboardId: "dash-1",
    title,
    type: "output",
    meta: defaultMeta,
    appearance: { background: "transparent", color: "inherit", transparency: 0 },
    config: { outputId: "output-1", controls: [] },
  };
}

function renderPage() {
  const store = configureStore({
    reducer: {
      patchSets: patchSetsReducer,
      panels: panelsReducer,
      dashboards: dashboardsReducer,
      toasts: toastsReducer,
    },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[{ pathname: "/patch-sets/review", state: null }]}>
        <Routes>
          <Route path="/patch-sets/review" element={<PatchSetReviewPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

describe("PatchSetReviewPage demo fixture — '(previewed)' suffix convergence (HEL-1154)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFetchDashboards.mockResolvedValue([dashboard]);
    mockedPreviewPatchSet.mockResolvedValue({ edits: [] });
  });

  it.each([0, 1, 3, 5])(
    "a first-panel title already carrying %i markers yields exactly one marker in the patch set",
    async (n) => {
      mockedFetchPanels.mockResolvedValue([panelTitled("Revenue" + " (previewed)".repeat(n))]);

      renderPage();

      await waitFor(() => expect(mockedPreviewPatchSet).toHaveBeenCalledTimes(1));
      const patchSet = mockedPreviewPatchSet.mock.calls[0][0];
      expect(patchSet.edits[0]).toMatchObject({ patch: { title: "Revenue (previewed)" } });
    },
  );
});
