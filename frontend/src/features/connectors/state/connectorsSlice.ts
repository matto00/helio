import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import {
  createConnector as createConnectorRequest,
  deleteConnector as deleteConnectorRequest,
  fetchConnectors as fetchConnectorsRequest,
  rotateConnectorCredential as rotateConnectorCredentialRequest,
  updateConnector as updateConnectorRequest,
} from "../services/connectorEntityService";
import { extractErrorMessage } from "../../../services/extractErrorMessage";
import type {
  Connector,
  CreateConnectorRequest,
  RotateConnectorCredentialRequest,
  UpdateConnectorRequest,
} from "../types/connector";

interface ConnectorsState {
  items: Connector[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  /** Distinguishes the delete flow's own 409 ConnectorHasDependents outcome
   *  (design.md Decision 1b / spec "Delete blocked shows dependent
   *  explanation") from a generic delete failure, keyed by Connector id so
   *  multiple rows can carry independent delete errors at once, mirroring
   *  `settingsSlice`'s per-token `revokeError` shape. */
  deleteConflict: Record<string, string>;
}

const initialState: ConnectorsState = {
  items: [],
  status: "idle",
  error: null,
  deleteConflict: {},
};

function extractMessage(err: unknown, fallback: string): string {
  return extractErrorMessage(err, fallback);
}

export const fetchConnectors = createAsyncThunk<Connector[], void, { rejectValue: string }>(
  "connectors/fetchConnectors",
  async (_, { rejectWithValue }) => {
    try {
      return await fetchConnectorsRequest();
    } catch (err: unknown) {
      return rejectWithValue(extractMessage(err, "Failed to load connectors."));
    }
  },
);

export const createConnector = createAsyncThunk<
  Connector,
  CreateConnectorRequest,
  { rejectValue: string }
>("connectors/createConnector", async (request, { rejectWithValue }) => {
  try {
    return await createConnectorRequest(request);
  } catch (err: unknown) {
    return rejectWithValue(extractMessage(err, "Failed to create connector."));
  }
});

export const updateConnector = createAsyncThunk<
  Connector,
  { id: string; request: UpdateConnectorRequest },
  { rejectValue: string }
>("connectors/updateConnector", async ({ id, request }, { rejectWithValue }) => {
  try {
    return await updateConnectorRequest(id, request);
  } catch (err: unknown) {
    return rejectWithValue(extractMessage(err, "Failed to update connector."));
  }
});

export const rotateConnectorCredential = createAsyncThunk<
  Connector,
  { id: string; request: RotateConnectorCredentialRequest },
  { rejectValue: string }
>("connectors/rotateConnectorCredential", async ({ id, request }, { rejectWithValue }) => {
  try {
    return await rotateConnectorCredentialRequest(id, request);
  } catch (err: unknown) {
    return rejectWithValue(extractMessage(err, "Failed to rotate credential."));
  }
});

interface DeleteConnectorArgs {
  id: string;
  /** HEL-824 skeptic-final-1.md change request 3: the row's OWN
   *  `dependentCount` (known client-side, already rendered on the row) is
   *  used to build the 409 conflict message instead of the raw backend
   *  string. `ConnectorEntityService.delete`'s 409 body is
   *  `"ConnectorHasDependents: this Connector is still referenced by a
   *  dependent resource"` — an internal error-code-shaped token that never
   *  belongs on screen, and it doesn't even carry the count the UI already
   *  has. Passed as an argument (not read back from state inside the thunk)
   *  to avoid a circular `RootState` import into this slice. */
  dependentCount: number;
}

function conflictMessage(dependentCount: number): string {
  // `dependentCount <= 0` here means the row's client-side count was stale
  // (Delete is disabled client-side whenever `dependentCount > 0` -- see
  // change request 4 -- so this 409 can only be reached via a genuine race:
  // a dependent was added between page load and the click). The counted
  // wording below would be self-contradictory ("referenced by 0 sources")
  // in that case, so it gets its own honest message instead.
  if (dependentCount <= 0) {
    return "This connector is now referenced by a dependent source — refresh the page and try again.";
  }
  const noun = dependentCount === 1 ? "source" : "sources";
  return `Still referenced by ${dependentCount} ${noun}. Repoint or delete ${dependentCount === 1 ? "it" : "them"} first.`;
}

export const deleteConnector = createAsyncThunk<
  string,
  DeleteConnectorArgs,
  { rejectValue: { id: string; message: string; conflict: boolean } }
>("connectors/deleteConnector", async ({ id, dependentCount }, { rejectWithValue }) => {
  try {
    await deleteConnectorRequest(id);
    return id;
  } catch (err: unknown) {
    const conflict = isAxiosError(err) && err.response?.status === 409;
    // On a 409 for this action specifically, never surface the raw backend
    // string (leaks the `ConnectorHasDependents:` internal error-code
    // token) — build the message client-side from the count instead. Any
    // other failure still prefers the server's message via
    // `extractMessage`'s existing fallback behavior.
    const message = conflict
      ? conflictMessage(dependentCount)
      : extractMessage(err, "Failed to delete connector.");
    return rejectWithValue({ id, message, conflict });
  }
});

const connectorsSlice = createSlice({
  name: "connectors",
  initialState,
  reducers: {
    clearDeleteConflict(state, action: { payload: string }) {
      delete state.deleteConflict[action.payload];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchConnectors.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchConnectors.fulfilled, (state, action) => {
        state.items = action.payload;
        state.status = "succeeded";
        state.error = null;
      })
      .addCase(fetchConnectors.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload ?? "Failed to load connectors.";
      })
      .addCase(createConnector.fulfilled, (state, action) => {
        state.items = [action.payload, ...state.items];
      })
      .addCase(updateConnector.fulfilled, (state, action) => {
        const idx = state.items.findIndex((c) => c.id === action.payload.id);
        if (idx !== -1) state.items[idx] = action.payload;
      })
      .addCase(rotateConnectorCredential.fulfilled, (state, action) => {
        const idx = state.items.findIndex((c) => c.id === action.payload.id);
        if (idx !== -1) state.items[idx] = action.payload;
      })
      .addCase(deleteConnector.fulfilled, (state, action) => {
        state.items = state.items.filter((c) => c.id !== action.payload);
        delete state.deleteConflict[action.payload];
      })
      .addCase(deleteConnector.rejected, (state, action) => {
        if (action.payload) {
          state.deleteConflict[action.payload.id] = action.payload.message;
        }
      });
  },
});

export const { clearDeleteConflict } = connectorsSlice.actions;
export const connectorsReducer = connectorsSlice.reducer;
