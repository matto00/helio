# Files Modified — HEL-665

## New files

- `frontend/src/features/assistant/ui/MessageTurn.tsx` / `.css` — role-based message bubble (design.md D1); user right-aligned accent wash, assistant left-aligned neutral surface.
- `frontend/src/features/assistant/ui/ToolCallIndicator.tsx` / `.css` — one progress-indicator row per `tool_use` block, paired `tool_result` folded in as a collapsed disclosure (never raw JSON inline), `isError: true` styled with error-intent tokens (design.md D2).
- `frontend/src/features/assistant/ui/StreamingText.tsx` / `.css` — incremental text reveal with a blinking-cursor affordance, tested against scripted mock chunk sequences only; not live-wired (design.md D3).
- `frontend/src/features/assistant/proposalExtraction.ts` — pure function scanning a transcript for the latest successful `propose_*` tool call, returning a discriminated `{kind, input}` extraction. **Implementation correction**: sources `input` from the paired `tool_use.input` rather than `tool_result.content` (design.md's literal prose) — `AssistantToolExecutor.executeProposePatchSet` (backend) returns the *preview* (`PatchSetPreviewResponse`, `{edits: EditPreview[]}`) as the tool result, not the original `PatchSet` (`{summary?, edits: Edit[]}`); parsing the tool_result as a `PatchSet` would silently produce a broken hand-off object. `tool_use.input` is reliable for every kind.
- `frontend/src/features/assistant/proposalExtraction.test.ts` — unit tests, including a regression test locking in the `tool_use.input`-sourcing fix above.
- `frontend/src/features/assistant/ui/ProposalHandoff.tsx` / `.css` — "Proposal ready" card; working hand-off to `/proposals/review`/`/patch-sets/review` for `dashboard`/`patch` kinds, honest informational notice (no navigation) for `pipeline`/`combined` (design.md D4).
- `frontend/src/features/assistant/ui/QuickLauncherOverlay.tsx` / `.css` — `Modal` (size `lg`) rendering the same `ActiveConversationPanel` `/chat` renders, plus a "Browse all conversations →" link; wires `useOverlay()` (single-active-overlay + Escape) mirroring `AuthoringChatDrawer`'s exact pattern (design.md D5-D7).
- `frontend/src/features/assistant/ui/MessageTurn.test.tsx`, `ToolCallIndicator.test.tsx`, `StreamingText.test.tsx`, `ProposalHandoff.test.tsx` — component-level unit tests (tasks.md 5.1-5.8).

## Modified files

- `frontend/src/features/assistant/types.ts` — added `ClaudeTextBlockDto`/`ClaudeToolUseBlockDto`/`ClaudeToolResultBlockDto` narrowed type aliases, shared by the new components.
- `frontend/src/features/assistant/ui/ActiveConversationPanel.tsx` / `.css` — replaced the HEL-664 placeholder body with real transcript rendering: maps each transcript turn's content blocks to `MessageTurn`/`ToolCallIndicator` in document order (pairing `tool_use`↔`tool_result` across turns, since the backend's tool loop appends the result as a separate synthetic turn), and renders `ProposalHandoff` when `proposalExtraction` finds a result. Existing loading/empty/error states and the `active-conversation-message-count` testid are unchanged.
- `frontend/src/features/assistant/ui/ActiveConversationPanel.test.tsx` — added tests for the two-tool_use-rows assembly and the proposal-hand-off wiring (tasks.md 5.2, 3.1).
- `frontend/src/app/App.tsx` — added the quick-launcher trigger button (`.topbar-theme-btn` recipe, unconditional, unlike the dashboard-gated "Refine with AI" button) to `.app-command-bar__right`, a `Cmd/Ctrl+K` global keydown handler, and an unconditional `<QuickLauncherOverlay>` mount (design.md D7).
- `frontend/src/app/App.test.tsx` — added a `quick-launcher` describe block covering trigger visibility, click-to-open, keyboard shortcut, Escape-to-close, the "Browse all conversations" link, and shared-Redux-state parity with `/chat` (tasks.md 5.9-5.14).

## Untouched (explicitly, per design.md/ticket.md)

- `frontend/src/features/assistant/ui/ChatPage.tsx` — already renders only `<ActiveConversationPanel />`; no changes needed.
- `frontend/src/shared/chrome/SidebarBody.tsx` — the `/chat`-only conversation list stays exactly where HEL-664 built it.
- No backend/schema changes.
