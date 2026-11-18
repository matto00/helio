# Mutations (HEL-1746)

| # | Guard | Mutation | Result |
|---|-------|----------|--------|
| M1 | AskSeamSpec fixture equality (1.3) | `shared-test-fixtures/ask/ask-200-pin.json`: `"isPct": false` -> `true` | `AskSeamSpec` "200 with a pin" FAILED: "fixture ask-200-pin.json differs from what the real route writes". Restored; 6/6 green. |
| M2 | BottomSheet size CSS guard, phone rule (3.0) | `BottomSheet.css` `.ui-modal.bottom-sheet` `max-width: 100%` -> `90%` | `BottomSheet.size.css.test.ts` "sets width and max-width to 100%" FAILED. Restored. |
| M3 | same guard, specificity (3.0) | `Modal.css` `.ui-modal--md` -> `.ui-modal.ui-modal--md` | "every .ui-modal--<size> width rule is a single class" FAILED. Restored. |
| M4 | Pin only when `pin !== null` (2.5) | `AskAnswerCard`: dropped the `response.pin !== null &&` condition | `AskPanel.test` "renders no Pin action when pin is null (a viewer)" FAILED. Restored. |
| M5 | 429 never shows `limit` (2.6) | `askErrorCopy` 429 message interpolates `error.limit` | "a 429 shows the daily-chat-limit copy and never a digit of the limit" FAILED. Restored. |
| M6 | stale response dropped (2.3) | `useAsk`: `ticket === latest.current` -> `true` | `useAsk.test` stale-after-newer-ask and after-unmount/scope-change FAILED (2). Restored. |
| M7 | pin body unchanged (2.5) | `pinInsight` adds `extra: 1` to the POSTed body | `askService.test` pinInsight and `AskPanel.test` POST-unchanged FAILED (2). Restored. |
| M8 | owner-only placement (2.5) | `useAskPin`: `dashboardOwnerId === userId` -> `true` | "a non-owner's pin is saved to the pipeline with a link, and no panel is placed" FAILED. Restored. |
| M9 | drawer size (3.1) | `AskDrawer` `size="md"` -> `"full"` | `AskDrawer.test` "asked of the Modal at size md" FAILED. Restored. |
| M10 | focus return via selector (3.1) | `AskDrawer` restore `focus()` -> `blur()` | "when the opener has gone ... focuses the passed selector's match" FAILED. Restored. |
| M11 | Output sheet gate (3.2) | `hasServerRow` -> `!isCreate` | `OutputEditorSheet.ask.test` "absent for an Output that exists only in the draft" FAILED. Restored. |
| M12 | pin disabled during a draft (3.2) | `draftActive={draft !== undefined}` -> `false` | "pin is disabled with the visible reason" FAILED. Restored. |
| M13 | parseAskError decides truncated by `code` (2.2) | 422 truncated decided by `message` text | 3 FAILED (AskPanel truncated; parseAskError x2). Restored. |
| M14 | 422 code split (2.2) | every 422 maps to `ungrounded` | 3 FAILED (AskPanel truncated; ask.contract truncated fixture; parseAskError). Restored. |
| M15 | 403 -> tierForbidden (2.2) | 403 maps to `unknown` | 3 FAILED (AskPanel 403 upsell; contract 403 fixture; parseAskError). Restored. |
| M16 | any 5xx -> unavailable (2.2) | only 503 is `unavailable` | parseAskError "any 5xx is unavailable" FAILED. Restored. |
| M17 | free tier shows the upsell, sends nothing (2.6) | dropped the `tier === "free"` check | "a free-tier user sees the upsell instead of the field, and no ask request is ever sent" FAILED. Restored. |
| M18 | 403 shows the upsell (2.6) | dropped the 403 -> upsell mapping | "a 403 TIER_FORBIDDEN shows the same upsell" FAILED. Restored. |
| M19 | contract negative cases (1.4) | `ask-ungrounded-response.schema.json` `code` const -> any string | `ask.contract` "negative: a body that breaks its schema is rejected" FAILED. Restored. |
| M20 | thunk path when the Output list is loaded (2.5) | `listLoaded` selector forced false (service path always) | "a pin from the Output sheet goes through the thunk, so a loaded Output list gains the insight" FAILED. Restored. |
| M21 | Pin not repeatable (2.5) | Pin button also shown after `pinned` | "POSTs pin.request unchanged ... and cannot be repeated" FAILED. Restored. |
| M22 | 2000-character bound (2.4) | `isAskableQuestion` without the upper bound | AskPanel "disables submit over 2000 characters" and useAsk "sends nothing for an empty or over-long question" FAILED. Restored. |
| M23 | Enter submits, Shift+Enter does not (2.4) | `submitOnEnter` removed | "Enter submits exactly one request ...; Shift+Enter does not" FAILED. Restored. |
| M24 | Ask immediately before the assistant (3.1) | Ask rendered after the assistant button | DashboardMetaRow tier 0 and tier 1 "sits immediately before the assistant button" FAILED. Restored. |
| M25 | meta-row kebab restore selector (3.1) | kebab item calls `onOpenAsk()` with no selector | "tier 2: Ask moves into the kebab ... focus-restore target" FAILED. Restored. |
| M26 | command-bar kebab restore selector (3.1) | kebab item calls `onOpenAsk()` with no selector | CommandBar "offers Ask as an item of the dashboard kebab, restoring focus" FAILED. Restored. |
| M27 | no ask group in create mode (3.2) | group rendered when `isCreate` too | "is absent in create mode" FAILED. Restored. |
| M28 | focus to the field on open (3.1) | focus call replaced by `blur()` | `AskDrawer` "moves focus to the question field on open" FAILED. Restored. |

Cycle 2: the shared `ui-modal-btn` buttons, `FormField` and the `useId` pin-reason id replaced hand-rolled markup; tests unchanged and green
(snapshots unchanged). The e2e now measures the buttons: painted 32px, hit region reaching 44px and stopping short of 50px (390px phone).
