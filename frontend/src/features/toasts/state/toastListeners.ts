/**
 * Centralised toast wiring via RTK listenerMiddleware.
 *
 * Wired thunks:
 *
 * Errors (meaningful failures):
 *   - dashboards: create, delete, duplicate, import, rename
 *   - panels: create, delete, duplicate, fetchPanels (load failure)
 *   - sources: createSqlSource, createStaticSource, deleteSource, inferSqlSource
 *   - dataTypes: deleteDataType
 *   - pipelines: createPipeline, deletePipeline, submitPipelineRun
 *   - settings: deleteAgentMemoryEntry, clearAgentMemory
 *
 * Successes (user-initiated, non-trivial):
 *   - dashboards: createDashboard, deleteDashboard, duplicateDashboard, importDashboard
 *   - panels: createPanel, deletePanel, duplicatePanel
 *   - sources: createSqlSource, createStaticSource, deleteSource
 *   - dataTypes: deleteDataType
 *   - pipelines: createPipeline, deletePipeline
 *   - settings: deleteAgentMemoryEntry, clearAgentMemory
 *
 * Silent (kept silent — automatic/background):
 *   - updateDashboardAppearance, updateDashboardLayout, renameDashboard,
 *     updatePanelAppearance, updatePanelTitle, updatePanelTextBinding,
 *     updatePanelMarkdownBinding, updatePanelImage, updatePanelBinding,
 *     updatePanelDivider, updatePanelsBatch,
 *     updateSource, updateDataType, analyzePipeline, updatePipeline,
 *     fetchPanelPage, fetchDashboards, fetchSources, fetchDataTypes,
 *     fetchPipelines, fetchPipeline, fetchPipelineSteps, fetchPipelineRunHistory,
 *     fetchPreferences, fetchAgentMemory (fetch-on-mount, same as the other
 *     fetch* entries above), savePreferences (explicit "Save preferences"
 *     button + inline dirty-state UI -- same analogue as updatePanelAppearance)
 */

import type { AppStartListening } from "../../../store/listenerMiddleware";
import { pushToast } from "./toastsSlice";

// Dashboards
import {
  createDashboard,
  deleteDashboard,
  duplicateDashboard,
  importDashboard,
} from "../../dashboards/state/dashboardsSlice";

// Panels
import {
  createPanel,
  deletePanel,
  duplicatePanel,
  fetchPanels,
} from "../../panels/state/panelsSlice";

// Sources
import {
  createSqlSource,
  createStaticSource,
  deleteSource,
  inferSqlSource,
} from "../../sources/state/sourcesSlice";

// DataTypes
import { deleteDataType } from "../../dataTypes/state/dataTypesSlice";

// Pipelines
import {
  createPipeline,
  deletePipeline,
  submitPipelineRun,
} from "../../pipelines/state/pipelinesSlice";

// Settings (agent memory)
import {
  clearAgentMemoryThunk,
  deleteAgentMemoryEntryThunk,
} from "../../settings/state/settingsSlice";

export function addToastListeners(startListening: AppStartListening) {
  // ── Dashboards ──────────────────────────────────────────────────────────

  startListening({
    actionCreator: createDashboard.fulfilled,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "success",
          message: `Dashboard "${action.payload.name}" created.`,
        }),
      );
    },
  });

  startListening({
    actionCreator: createDashboard.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to create dashboard.",
        }),
      );
    },
  });

  startListening({
    actionCreator: deleteDashboard.fulfilled,
    effect: (_, { dispatch }) => {
      dispatch(pushToast({ variant: "success", message: "Dashboard deleted." }));
    },
  });

  startListening({
    actionCreator: deleteDashboard.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to delete dashboard.",
        }),
      );
    },
  });

  startListening({
    actionCreator: duplicateDashboard.fulfilled,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "success",
          message: `Dashboard "${action.payload.dashboard.name}" duplicated.`,
        }),
      );
    },
  });

  startListening({
    actionCreator: duplicateDashboard.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to duplicate dashboard.",
        }),
      );
    },
  });

  startListening({
    actionCreator: importDashboard.fulfilled,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "success",
          message: `Dashboard "${action.payload.dashboard.name}" imported.`,
        }),
      );
    },
  });

  startListening({
    actionCreator: importDashboard.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to import dashboard.",
        }),
      );
    },
  });

  // ── Panels ──────────────────────────────────────────────────────────────

  startListening({
    actionCreator: createPanel.fulfilled,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "success",
          message: `Panel "${action.payload.title}" created.`,
        }),
      );
    },
  });

  startListening({
    actionCreator: createPanel.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to create panel.",
        }),
      );
    },
  });

  startListening({
    actionCreator: deletePanel.fulfilled,
    effect: (_, { dispatch }) => {
      dispatch(pushToast({ variant: "success", message: "Panel deleted." }));
    },
  });

  startListening({
    actionCreator: deletePanel.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to delete panel.",
        }),
      );
    },
  });

  startListening({
    actionCreator: duplicatePanel.fulfilled,
    effect: (_, { dispatch }) => {
      dispatch(pushToast({ variant: "success", message: "Panel duplicated." }));
    },
  });

  startListening({
    actionCreator: duplicatePanel.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to duplicate panel.",
        }),
      );
    },
  });

  startListening({
    actionCreator: fetchPanels.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to load panels.",
        }),
      );
    },
  });

  // ── Sources ─────────────────────────────────────────────────────────────

  startListening({
    actionCreator: createSqlSource.fulfilled,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "success",
          message: `Data source "${action.payload.name}" connected.`,
        }),
      );
    },
  });

  startListening({
    actionCreator: createSqlSource.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to create SQL source.",
        }),
      );
    },
  });

  startListening({
    actionCreator: createStaticSource.fulfilled,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "success",
          message: `Data source "${action.payload.name}" created.`,
        }),
      );
    },
  });

  startListening({
    actionCreator: createStaticSource.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to create static source.",
        }),
      );
    },
  });

  startListening({
    actionCreator: deleteSource.fulfilled,
    effect: (_, { dispatch }) => {
      dispatch(pushToast({ variant: "success", message: "Data source deleted." }));
    },
  });

  startListening({
    actionCreator: deleteSource.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to delete source.",
        }),
      );
    },
  });

  startListening({
    actionCreator: inferSqlSource.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to connect to database.",
        }),
      );
    },
  });

  // ── DataTypes ────────────────────────────────────────────────────────────

  startListening({
    actionCreator: deleteDataType.fulfilled,
    effect: (_, { dispatch }) => {
      dispatch(pushToast({ variant: "success", message: "Data type deleted." }));
    },
  });

  startListening({
    actionCreator: deleteDataType.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to delete data type.",
        }),
      );
    },
  });

  // ── Pipelines ────────────────────────────────────────────────────────────

  startListening({
    actionCreator: createPipeline.fulfilled,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "success",
          message: `Pipeline "${action.payload.name}" created.`,
        }),
      );
    },
  });

  startListening({
    actionCreator: createPipeline.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to create pipeline.",
        }),
      );
    },
  });

  startListening({
    actionCreator: deletePipeline.fulfilled,
    effect: (_, { dispatch }) => {
      dispatch(pushToast({ variant: "success", message: "Pipeline deleted." }));
    },
  });

  startListening({
    actionCreator: deletePipeline.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to delete pipeline.",
        }),
      );
    },
  });

  startListening({
    actionCreator: submitPipelineRun.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to start pipeline run.",
        }),
      );
    },
  });

  // ── Settings (agent memory) ─────────────────────────────────────────────

  startListening({
    actionCreator: deleteAgentMemoryEntryThunk.fulfilled,
    effect: (_, { dispatch }) => {
      dispatch(pushToast({ variant: "success", message: "Memory entry deleted." }));
    },
  });

  startListening({
    actionCreator: deleteAgentMemoryEntryThunk.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to delete memory entry.",
        }),
      );
    },
  });

  startListening({
    actionCreator: clearAgentMemoryThunk.fulfilled,
    effect: (_, { dispatch }) => {
      dispatch(pushToast({ variant: "success", message: "Agent memory cleared." }));
    },
  });

  startListening({
    actionCreator: clearAgentMemoryThunk.rejected,
    effect: (action, { dispatch }) => {
      dispatch(
        pushToast({
          variant: "error",
          message: action.payload ?? "Failed to clear agent memory.",
        }),
      );
    },
  });
}
