// HEL-1575 test fixtures for the warm cache: Outputs, settled row windows and stored entries.

import type { StoredWindow, WarmEntry } from "../features/dashboards/tabs/warm/warmStore";
import type { Output } from "../features/pipelines/types/output";
import type { PanelPaginationState } from "../features/panels/types/panel";
import { makeOutputPanel } from "./panelFixtures";

export function makeOutput(id: string, pipelineId = `pipe-${id}`): Output {
  return {
    id,
    pipelineId,
    ownerId: "user-1",
    name: `Output ${id}`,
    kind: "table",
    config: {},
    schema: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

export function outputPanel(id: string, dashboardId: string, outputId: string) {
  return makeOutputPanel({ id, dashboardId, config: { outputId } });
}

/** A settled, successful page-0 window as `fetchPanelPage.fulfilled` leaves it. */
export function settledWindow(
  outputId: string,
  capturedAt: number,
  generation = 0,
): PanelPaginationState {
  return {
    currentPage: 0,
    hasMore: false,
    isLoadingMore: false,
    rows: [{ a: 1 }],
    materialized: true,
    total: 1,
    lastQuery: { outputId, crossFilterEq: null },
    lastFetchOk: true,
    generation,
    lastError: null,
    capturedAt,
  };
}

/** The stored (allow-listed) form of `settledWindow`. */
export function storedWindow(outputId: string, capturedAt: number, generation = 0): StoredWindow {
  return {
    currentPage: 0,
    hasMore: false,
    rows: [{ a: 1 }],
    materialized: true,
    total: 1,
    lastQuery: { outputId, crossFilterEq: null },
    generation,
    capturedAt,
  };
}

export function storedEntry(overrides: Partial<WarmEntry> & { dashboardId: string }): WarmEntry {
  return {
    v: 1,
    userId: "user-1",
    contentCapturedAt: 1_000,
    ownWriteAt: null,
    lastViewedAt: 1_000,
    panels: [],
    rows: {},
    outputMeta: {},
    runBaseline: {},
    ...overrides,
  };
}
