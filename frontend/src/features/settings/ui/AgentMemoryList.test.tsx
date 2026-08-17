// HEL-525 (420-D) task 4.3. `AgentMemoryList` dispatches its own delete/
// clear-all thunks internally (design.md Decision 5's inline-confirm
// pattern), so a thin store-connected harness is used here to exercise the
// full dispatch -> reducer -> re-render loop, not just the confirm UI.

import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";

import { useAppSelector } from "../../../hooks/reduxHooks";
import * as settingsService from "../services/settingsService";
import { settingsReducer } from "../state/settingsSlice";
import type { AgentMemoryEntry } from "../types/agentMemory";
import { AgentMemoryList } from "./AgentMemoryList";

jest.mock("../services/settingsService", () => ({
  deleteAgentMemoryEntry: jest.fn(),
  clearAgentMemory: jest.fn(),
}));

const deleteAgentMemoryEntryMock = jest.mocked(settingsService.deleteAgentMemoryEntry);
const clearAgentMemoryMock = jest.mocked(settingsService.clearAgentMemory);

function buildStore(items: AgentMemoryEntry[]) {
  return configureStore({
    reducer: { settings: settingsReducer },
    preloadedState: {
      settings: {
        preferences: {
          data: null,
          status: "idle" as const,
          error: null,
          saveStatus: "idle" as const,
          saveError: null,
        },
        agentMemory: {
          items,
          status: "succeeded" as const,
          error: null,
          deleteStatus: {},
          deleteError: {},
          clearStatus: "idle" as const,
          clearError: null,
        },
        mfa: {
          status: "idle" as const,
          error: null,
          enabled: false,
          verifiedAt: null,
          backupCodesRemaining: 0,
          enrollStatus: "idle" as const,
          enrollError: null,
          enrollment: null,
          confirmStatus: "idle" as const,
          confirmError: null,
          backupCodes: null,
          regenerateStatus: "idle" as const,
          regenerateError: null,
          disableStatus: "idle" as const,
          disableError: null,
        },
        // HEL-704: betaAccess is a sibling sub-tree this component never reads/dispatches into —
        // still required by SettingsState's shape.
        betaAccess: {
          requestStatus: "idle" as const,
          requestError: null,
          redeemStatus: "idle" as const,
          redeemError: null,
        },
      },
    },
  });
}

/** Reads `entries` from the store rather than hard-coding a static prop, so
 *  a fulfilled delete/clear-all thunk's reducer update is actually visible
 *  in the rendered list — mirrors how `SettingsPage` wires this component. */
function Harness() {
  const items = useAppSelector((state) => state.settings.agentMemory.items);
  return <AgentMemoryList entries={items} />;
}

function renderList(items: AgentMemoryEntry[]) {
  const store = buildStore(items);
  render(
    <Provider store={store}>
      <Harness />
    </Provider>,
  );
  return { store };
}

const factEntry: AgentMemoryEntry = {
  id: "mem-1",
  kind: "fact",
  content: "Prefers dark mode.",
  createdAt: "2026-08-01T00:00:00Z",
  lastUsedAt: "2026-08-10T12:00:00Z",
};

const neverUsedEntry: AgentMemoryEntry = {
  id: "mem-2",
  kind: "goal",
  content: "Wants weekly revenue summaries.",
  createdAt: "2026-08-02T00:00:00Z",
  lastUsedAt: null,
};

beforeEach(() => {
  deleteAgentMemoryEntryMock.mockReset();
  clearAgentMemoryMock.mockReset();
});

describe("AgentMemoryList — populated render", () => {
  it("displays kind, content, and last-used time for each entry", () => {
    renderList([factEntry]);

    expect(screen.getByText("fact")).toBeInTheDocument();
    expect(screen.getByText("Prefers dark mode.")).toBeInTheDocument();
    expect(screen.getByText(new Date(factEntry.lastUsedAt!).toLocaleString())).toBeInTheDocument();
  });

  // HEL a11y sweep F-204: the actions column header had no text/aria-label,
  // so screen readers announced a blank column header.
  it("gives the actions <th> a visually-hidden accessible name instead of an empty header", () => {
    renderList([factEntry]);
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
  });
});

describe("AgentMemoryList — empty state", () => {
  it("renders an empty state, not a blank list or error, when there are no entries", () => {
    renderList([]);

    expect(screen.getByText("No memory stored yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  // F-151 — the empty state used to bypass the `.agent-memory-list` card
  // wrapper entirely, rendering bare on the page canvas unlike its populated
  // sibling and unlike Preferences/Beta access's bordered card treatment —
  // the one case most free/fresh accounts actually see on first load.
  it("keeps the same bordered `.agent-memory-list` card wrapper as the populated state", () => {
    renderList([]);

    expect(screen.getByText("No memory stored yet").closest(".agent-memory-list")).not.toBeNull();
  });
});

describe("AgentMemoryList — never-used entry", () => {
  it("renders without a fabricated last-used value", () => {
    renderList([neverUsedEntry]);

    expect(screen.getByText("Never used")).toBeInTheDocument();
  });
});

describe("AgentMemoryList — per-entry delete", () => {
  it("shows an inline confirm/cancel affordance and does not delete immediately", () => {
    renderList([factEntry]);

    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));

    expect(screen.getByRole("button", { name: /^Confirm delete/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(deleteAgentMemoryEntryMock).not.toHaveBeenCalled();
    expect(screen.getByText("Prefers dark mode.")).toBeInTheDocument();
  });

  it("canceling delete leaves the entry intact", () => {
    renderList([factEntry]);

    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(deleteAgentMemoryEntryMock).not.toHaveBeenCalled();
    expect(screen.getByText("Prefers dark mode.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Delete/ })).toBeInTheDocument();
  });

  it("confirming delete removes the entry from the list and persists the deletion", async () => {
    deleteAgentMemoryEntryMock.mockResolvedValueOnce(undefined);
    renderList([factEntry]);

    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Confirm delete/ }));

    await waitFor(() => expect(deleteAgentMemoryEntryMock).toHaveBeenCalledWith("mem-1"));
    await waitFor(() => expect(screen.queryByText("Prefers dark mode.")).not.toBeInTheDocument());
    expect(screen.getByText("No memory stored yet")).toBeInTheDocument();
  });

  // Regression test — skeptic-final-1.md change request #1: a failed
  // per-entry delete (e.g. a stale row racing a real 404) must never be
  // silent. The confirm/cancel pair always reverts to the plain Delete
  // button on confirm (success or failure); the error must still surface.
  it("shows an error and keeps the entry in the list when delete fails", async () => {
    deleteAgentMemoryEntryMock.mockRejectedValueOnce(new Error("network error"));
    renderList([factEntry]);

    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Confirm delete/ }));

    await waitFor(() => expect(deleteAgentMemoryEntryMock).toHaveBeenCalledWith("mem-1"));
    await waitFor(() =>
      expect(screen.getByText("Failed to delete memory entry.")).toBeInTheDocument(),
    );
    expect(screen.getByText("Prefers dark mode.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Delete/ })).toBeInTheDocument();
  });
});

describe("AgentMemoryList — clear all", () => {
  it("shows an inline confirm/cancel affordance and does not clear immediately", () => {
    renderList([factEntry, neverUsedEntry]);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(clearAgentMemoryMock).not.toHaveBeenCalled();
    expect(screen.getByText("Prefers dark mode.")).toBeInTheDocument();
  });

  it("canceling clear all leaves every entry intact", () => {
    renderList([factEntry, neverUsedEntry]);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(clearAgentMemoryMock).not.toHaveBeenCalled();
    expect(screen.getByText("Prefers dark mode.")).toBeInTheDocument();
    expect(screen.getByText("Wants weekly revenue summaries.")).toBeInTheDocument();
  });

  it("confirming clear all removes every entry and persists the clear", async () => {
    clearAgentMemoryMock.mockResolvedValueOnce(undefined);
    renderList([factEntry, neverUsedEntry]);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(clearAgentMemoryMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("No memory stored yet")).toBeInTheDocument());
  });
});
