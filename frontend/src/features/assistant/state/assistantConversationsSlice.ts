import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";

import {
  converse as converseRequest,
  getConversation as getConversationRequest,
  listConversations as listConversationsRequest,
  updateConversation as updateConversationRequest,
} from "../services/assistantConversationsService";
import type { AssistantConversationDetail, AssistantConversationSummary } from "../types";

function toSummary(detail: AssistantConversationDetail): AssistantConversationSummary {
  const { id, title, pinned, updatedAt } = detail;
  return { id, title, pinned, updatedAt };
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const data = err.response?.data as Record<string, unknown> | undefined;
    if (typeof data?.error === "string" && data.error) return data.error;
    if (typeof data?.message === "string" && data.message) return data.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// HEL-703 design.md D9 — the CONVERSE thunk's rejectValue widens from a plain `string` (every
// other thunk here keeps that string contract) to this small object so `MessageComposer` can
// switch on `code` (`TIER_FORBIDDEN` / `CHAT_LIMIT_REACHED`) instead of string-matching a message.
// `code`/`limit` mirror the backend's `TierErrorResponse` wire shape verbatim.
export interface ConverseErrorPayload {
  code?: string;
  message: string;
  limit?: number;
}

function extractConverseError(err: unknown): ConverseErrorPayload {
  if (isAxiosError(err)) {
    const data = err.response?.data as Record<string, unknown> | undefined;
    const code = typeof data?.code === "string" ? data.code : undefined;
    const limit = typeof data?.limit === "number" ? data.limit : undefined;
    const message =
      (typeof data?.message === "string" && data.message) ||
      (typeof data?.error === "string" && data.error) ||
      undefined;
    if (code !== undefined || message !== undefined) {
      return { code, message: message ?? "Failed to send message.", limit };
    }
  }
  if (err instanceof Error && err.message) return { message: err.message };
  return { message: "Failed to send message." };
}

// HEL-703 design.md D9 (cycle-2 evaluator CR1) — the single source of truth for the free-tier
// CTA-less "request access" copy. `ActiveConversationPanel` (main content) and `SidebarBody`'s
// "chat" section (sidebar list) both render this same locked state independently -- they are two
// different UI surfaces reading the same `currentUser.tier`, so the copy is centralized here
// (rather than duplicated as inline string literals) to keep them from drifting apart.
export const TierRequestAccessCopy = {
  title: "Chat access is limited",
  description:
    "Assistant access is limited during this rollout. Contact the workspace owner to request access.",
};

interface AssistantConversationsState {
  items: AssistantConversationSummary[];
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  /** Explicit user selection (sidebar or MobileNavSheet). Null means "fall
   * back to the first item" — `ActiveConversationPanel` derives the
   * effective selection so the panel is never blank (design.md D4). */
  selectedConversationId: string | null;
  /** Set by the sidebar's "New chat" button — forces `ActiveConversationPanel`'s effective
   * selection to null (the empty-state/composer view) even though `items` is non-empty, so a user
   * with existing conversations can start a fresh one. Cleared the instant any conversation is
   * explicitly selected (`setSelectedConversationId`), including the one `MessageComposer` creates
   * on the first send from this state. */
  startingNewConversation: boolean;
  /** The selected conversation's full detail (including transcript),
   * fetched separately via `GET /:id` — distinct from `items`' summary-only
   * data (design.md D4). */
  activeConversation: {
    data: AssistantConversationDetail | null;
    status: "idle" | "loading" | "succeeded" | "failed";
    error: string | null;
  };
  /** HEL-667 design.md D1/D5 — the just-completed turn's outcome signals, captured from a `POST
   * /:id/converse` response only (`GET` never carries them — see `AssistantConversationDetail`'s
   * own doc comment). Exposed SEPARATELY from `activeConversation.data` (rather than read directly
   * off it) so `ActiveConversationPanel`/`MessageTurn` have one deterministic, always-defined
   * source for "does the MOST RECENT turn need a distinct treatment", cleared the instant a new
   * message is sent (`converse.pending`) so a stale badge never lingers into the next in-flight
   * turn, and whenever a different conversation is loaded (`selectConversation.pending`) since the
   * signal only ever describes a turn in THIS conversation. */
  lastTurnOutcome: {
    hopBudgetExhausted: boolean;
    searchedWithNoResults: boolean;
  } | null;
}

const initialState: AssistantConversationsState = {
  items: [],
  status: "idle",
  error: null,
  selectedConversationId: null,
  startingNewConversation: false,
  activeConversation: {
    data: null,
    status: "idle",
    error: null,
  },
  lastTurnOutcome: null,
};

export const fetchConversations = createAsyncThunk<
  AssistantConversationSummary[],
  void,
  { rejectValue: string }
>("assistantConversations/fetchConversations", async (_, { rejectWithValue }) => {
  try {
    return await listConversationsRequest();
  } catch {
    return rejectWithValue("Failed to load conversations.");
  }
});

/** Fetches a conversation's full detail (including transcript) — dispatched
 * whenever the effective selected id changes (design.md D4). */
export const selectConversation = createAsyncThunk<
  AssistantConversationDetail,
  string,
  { rejectValue: string }
>("assistantConversations/selectConversation", async (id, { rejectWithValue }) => {
  try {
    return await getConversationRequest(id);
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Failed to load conversation."));
  }
});

/** `POST /:id/converse` (HEL-665, reopened composer ticket, design.md D3): on fulfillment, replaces
 * `activeConversation.data` with the response wholesale — mirrors `selectConversation.fulfilled`'s
 * identical update shape, no follow-up `getConversation` call needed (the route's own fetch →
 * converse → append → re-fetch already returns the refreshed detail). Deliberately does NOT wire
 * `pending`/`rejected` into `activeConversation.status`/`error`: those drive `ActiveConversationPanel`'s
 * full-panel loading/error swap, which would hide the transcript AND the composer mid-send — the
 * composer's own local sending/error state (design.md D6) is what surfaces this instead.
 *
 * `idempotencyKey` (HEL-698 design.md D6) — threaded straight through to `converseRequest`. On a
 * converse REJECTION, reconciliation kicks in before giving up: re-fetch the conversation and
 * compare its `lastIdempotencyKey` against the key this call sent. A match proves the send landed
 * server-side (and, by `appendTurn`'s blob-write atomicity, Claude's reply landed with it) — return
 * the fetched detail so the thunk FULFILLS exactly as a successful `converse` would (transcript
 * replaces wholesale, composer clears its input, no error banner). No match, no key, or a failed
 * reconciliation fetch all fall through to the original rejection — preserving today's failure UX,
 * with a retry now idempotency-protected via the key. */
export const converse = createAsyncThunk<
  AssistantConversationDetail,
  { id: string; message: string; idempotencyKey?: string },
  { rejectValue: ConverseErrorPayload }
>(
  "assistantConversations/converse",
  async ({ id, message, idempotencyKey }, { rejectWithValue }) => {
    try {
      return await converseRequest(id, message, idempotencyKey);
    } catch (err: unknown) {
      // HEL-703 design.md D9 — the rich `{ code?, message, limit? }` payload (not a plain string)
      // so MessageComposer can distinguish TIER_FORBIDDEN/CHAT_LIMIT_REACHED from a generic/network
      // failure. Computed once and reused for BOTH the reconciliation-miss and no-key rejection
      // paths below (HEL-698 design.md D6) — reconciliation only ever changes whether this call
      // FULFILLS instead; the rejection payload shape is unaffected by whether a key was sent.
      const originalPayload = extractConverseError(err);
      if (idempotencyKey === undefined) return rejectWithValue(originalPayload);
      try {
        const reconciled = await getConversationRequest(id);
        if (reconciled.lastIdempotencyKey === idempotencyKey) return reconciled;
      } catch {
        // Reconciliation fetch itself failed -- fall through to the original rejection below.
      }
      return rejectWithValue(originalPayload);
    }
  },
);

export const togglePinned = createAsyncThunk<
  AssistantConversationSummary,
  { id: string; pinned: boolean },
  { rejectValue: string }
>("assistantConversations/togglePinned", async ({ id, pinned }, { rejectWithValue }) => {
  try {
    return await updateConversationRequest(id, { pinned });
  } catch {
    return rejectWithValue("Failed to update conversation.");
  }
});

/** HEL-693 design.md D6 — mirrors `togglePinned`'s shape, but rejects with the server's message
 * (via `extractErrorMessage`) rather than a constant: a rename failure is surfaced inline next to
 * the row being edited (`SidebarItemList`'s `onRename` error state), so the caller benefits from
 * knowing *why* it failed the way `selectConversation`/`converse` already do. */
export const renameConversation = createAsyncThunk<
  AssistantConversationSummary,
  { id: string; title: string },
  { rejectValue: string }
>("assistantConversations/renameConversation", async ({ id, title }, { rejectWithValue }) => {
  try {
    return await updateConversationRequest(id, { title });
  } catch (err: unknown) {
    return rejectWithValue(extractErrorMessage(err, "Failed to rename conversation."));
  }
});

const assistantConversationsSlice = createSlice({
  name: "assistantConversations",
  initialState,
  reducers: {
    setSelectedConversationId(state, action: { payload: string | null }) {
      state.selectedConversationId = action.payload;
      state.startingNewConversation = false;
    },
    startNewConversation(state) {
      state.startingNewConversation = true;
    },
    /** `MessageComposer`'s null-`conversationId` send path calls `createConversation` directly
     *  (outside any thunk lifecycle here), so the sidebar's `items` list -- populated once by
     *  `fetchConversations` on mount -- never otherwise learns a new conversation exists. Inserts it
     *  directly rather than a full refetch, at the position matching the backend's own list order
     *  (`AssistantConversationRepository`: `ORDER BY pinned DESC, updated_at DESC`) -- a fresh,
     *  unpinned conversation goes after any existing pinned ones, not always at index 0. */
    conversationCreated(state, action: { payload: AssistantConversationDetail }) {
      const insertAt = state.items.findIndex((item) => !item.pinned);
      const index = insertAt === -1 ? state.items.length : insertAt;
      state.items.splice(index, 0, toSummary(action.payload));
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchConversations.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchConversations.fulfilled, (state, action) => {
        state.items = action.payload;
        state.status = "succeeded";
        state.error = null;
      })
      .addCase(fetchConversations.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload ?? "Failed to load conversations.";
      })
      .addCase(selectConversation.pending, (state) => {
        state.activeConversation.status = "loading";
        state.activeConversation.error = null;
        // HEL-667 design.md D5 — a different conversation's own turn-outcome signal (or none at
        // all, for a GET) is about to replace whatever's here; never let a prior selection's badge
        // survive into this one.
        state.lastTurnOutcome = null;
      })
      .addCase(selectConversation.fulfilled, (state, action) => {
        state.activeConversation.data = action.payload;
        state.activeConversation.status = "succeeded";
        state.activeConversation.error = null;
      })
      .addCase(selectConversation.rejected, (state, action) => {
        state.activeConversation.status = "failed";
        state.activeConversation.error = action.payload ?? "Failed to load conversation.";
      })
      .addCase(togglePinned.fulfilled, (state, action) => {
        const idx = state.items.findIndex((c) => c.id === action.payload.id);
        if (idx !== -1) state.items[idx] = action.payload;
      })
      .addCase(renameConversation.fulfilled, (state, action) => {
        const idx = state.items.findIndex((c) => c.id === action.payload.id);
        if (idx !== -1) state.items[idx] = action.payload;
        // Keeps the active-conversation panel heading (which reads
        // `activeConversation.data.title` directly, not `items`) in sync when the
        // renamed row is the one currently open (design.md D6).
        if (state.activeConversation.data?.id === action.payload.id) {
          state.activeConversation.data.title = action.payload.title;
        }
      })
      .addCase(converse.pending, (state) => {
        // HEL-667 design.md D5 tasks.md 6.3 — "cleared on the next send": a fresh message means any
        // outcome badge describing the PREVIOUS turn is stale the instant a new one is in flight.
        state.lastTurnOutcome = null;
      })
      .addCase(converse.fulfilled, (state, action) => {
        state.activeConversation.data = action.payload;
        state.activeConversation.status = "succeeded";
        state.activeConversation.error = null;
        state.lastTurnOutcome = {
          hopBudgetExhausted: action.payload.hopBudgetExhausted ?? false,
          searchedWithNoResults: action.payload.searchedWithNoResults ?? false,
        };
      });
  },
});

export const { setSelectedConversationId, startNewConversation, conversationCreated } =
  assistantConversationsSlice.actions;
export const assistantConversationsReducer = assistantConversationsSlice.reducer;
