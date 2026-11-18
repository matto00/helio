## Context

The HEL-1745 ask routes are on main, along with HEL-1761 (`ecefad62a`, merged into this branch). The route's error
ladder is checked in this order:

1. `404`: no access.
2. `503`: no model client.
3. `400`: the question is outside 1..2000 characters.
4. `403 TIER_FORBIDDEN`, or `429 CHAT_LIMIT_REACHED` with an optional `limit`. Both use the
   `TierErrorResponse{code, message, limit?}` body.
5. One of the 422 bodies below, or an `ErrorResponse` failure.

There are two 422 bodies:

- `422 ASK_UNGROUNDED`: `AskUngroundedResponse{message, code, reasons}`, where reasons are value-free phrases from
  `AskReasons.publicOf`.
- `422 ASK_ANSWER_TRUNCATED`: `AskTruncatedResponse{message, code}`, with no `reasons`. It is returned when a model hop
  hit max_tokens.

The `200` body follows `schemas/ask/ask-response.schema.json`.

HEL-1744 provides the components in `features/panels/insight/`:

- `InsightMarkdown` with props `{markdown, citations: string[], renderCitation}`.
- `CitationChip` with props `{citation, ordinal, insightPanelId, source}`.

The insight panel shows "Not yet rendered" for an insight Output with no render. HEL-1743 (render triggers) is parked.

**Goals:** the ticket's four bullets and four acceptance criteria, under the driver rulings in `ticket.md`.

**Non-Goals:** see the proposal. This change does not touch backend production code. It adds test code and schemas
only.

## Decisions

**D1 Module.** A new `frontend/src/features/ask/` holds these files:

- `services/askService.ts`: `askDashboard(id, question)`, `askOutput(id, question)` and `pinInsight(pin)`, on the shared
  axios client.
- `types/ask.ts`.
- `parseAskError.ts`. It maps an error to `tierForbidden | limitReached{limit?} | truncated | ungrounded | unavailable |
  invalid | network | unknown`, switching on HTTP status and `code` only, never on message text. Any 422 whose `code`
  is not `ASK_ANSWER_TRUNCATED` maps to `ungrounded`, the generic 422. Any 5xx maps to `unavailable`.
- A `useAsk(scope)` hook, with local component state. The state is per-surface and ephemeral, no other component reads
  it, and the backend persists nothing.
- `ui/AskQuestionForm.tsx`, `ui/AskAnswerCard.tsx` and `ui/AskPanel.tsx`, the shared body.
- `ui/AskDrawer.tsx`, the dashboard host.

The pin's follow-on writes use the existing Redux thunks (D4).

**D2 Reuse, never fork.**

- The card renders `InsightMarkdown` with `citations = response.citations.map(c => c.id)`.
- `renderCitation(id)` returns `CitationChip` with `source: {variant: "authenticated"}` and an `ordinal` equal to the
  citation's 1-based index in `response.citations`. The ask citation passes through one adapter to `InsightCitation`.
- `insightPanelId` is a stable `ask:<scope>:<id>`. This is safe because the authenticated chip only passes it to
  provenance telemetry, which ignores it (`provenanceTelemetry.ts:14-17`), and the public fallback is unreachable.
- No copy is made of the chip or the markdown code.
- An unknown `[cN]` marker stays plain text, through the existing `remarkCitationChips`.

**D3 Placement.**

Dashboard, rail shell (desktop):

- The `DashboardMetaRow` control is a **secondary, non-accent** `IconButton`, icon `MessageCircleQuestion`, with
  `aria-label` and title "Ask about this dashboard".
- It sits beside the assistant's `MessagesSquare`. The final visual check judges whether the two speech-bubble glyphs
  read as distinct. If they do not, the icon becomes `CircleHelp`, with the label unchanged.
- It sits immediately **before** the assistant button, so the order is Edit layout, Share, Add panel, then the
  appearance editor, Ask, the assistant and the kebab. Add panel stays the single accent control.
- At tiers 0-1 it is shown icon-only. At tier 2 and above it moves into the overflow kebab together with the assistant,
  as the menu item "Ask about this dashboard".
- Adding about 32 px changes the measured row, so the `META_ROW_TIER_WIDTHS` thresholds are re-measured live and
  updated, with the numbers recorded in `measurements.md`. DESIGN.md §9 "Meta row" is amended to list Ask.
- The label reads as asking about this dashboard's data, not as a second assistant.

Dashboard, phone and non-rail pages:

- The rail dashboard view does not mount `CommandBar`. So on phone and non-rail shells the opener is a "Ask about this
  dashboard" item inside the existing dashboard kebab (`dashboardActionItems`). No top-level `CommandBar` control is
  added, and nothing appears on non-dashboard pages.

Drawer:

- `AskDrawer` uses the shared **`BottomSheet`** (`shared/motion/BottomSheet.tsx`, DESIGN.md §10), which provides the
  focus trap and focus restore.
- Above 768 px, `BottomSheet` today always renders `Modal size="full"`, which is 1200 px wide (`Modal.css:87-89`). That
  is far too wide for one field and an answer of up to 1200 characters. So `BottomSheet` gains an optional `size` prop,
  passed through to `Modal`, defaulting to `"full"` so every existing caller is unchanged.
- `AskDrawer` passes `size="md"`, which is `min(540px, 100vw - 32px)`. That keeps a readable measure beside the 420 px
  `RefinementChatDrawer` while leaving room for the chip row and the pin action.
- At or below 768 px the phone sheet's `.ui-modal.bottom-sheet` rule already wins over the size class
  (`BottomSheet.css:6-7`). The phone presentation is unaffected, and this is proven by a CSS-text guard plus a phone e2e width assertion (C2), never a jsdom render.
- DESIGN.md §10 "Bottom sheet" is amended to document the `size` passthrough.
- No feature CSS overrides `.ui-modal--*` widths.
- It is mounted in `App.tsx` beside `RefinementChatDrawer`, gated on `selectedDashboardId`.

Output sheet:

- `OutputEditorSheet` gets an "Ask about this Output" card group, rendered only when `hasServerRow` is true
  (`OutputEditorSheet.tsx:101`). That excludes create mode and HEL-1733 draft Outputs, whose ids are client ids.
- The question field sits behind a disclosure, following the existing disclosure-summary style.

Visual language: existing tokens and components only (`Textarea`, `IconButton`, `Spinner`, `InlineError`, card-group
styles), per DESIGN.md. No new colour tokens.

**D4 Pin.**

Rendering and the request:

- The action renders iff `pin !== null`. That is the server's owner/editor decision (L6 D10). The client adds no role
  logic.
- Activating it POSTs `pin.request` unchanged to `/api/pipelines/:pipelineId/outputs`, with no answer text.
- When that pipeline's outputs list is loaded in the slice, the POST goes through the existing `createOutput` thunk, so
  the list updates. Otherwise it goes through the service, because `createOutput.fulfilled` would fake a loaded list.

From the dashboard:

- If `dashboard.ownerId === currentUser.id`, the client places a panel bound to the new Output with `createPanel`.
  `createPanel` already marks the dashboard's panels stale and refetches them, and the server computes placement.
- For a non-owner, whose grant role is not on the client, or when placement fails, the card says "Saved to <pipeline>"
  and links to the pipeline. No panel is placed.

On the Output sheet while a pipeline draft exists (`draft` is set):

- Pin is **disabled, with a visible reason**: "Save or discard your draft to pin."
- An immediate create would change the saved Outputs under the draft. A restored draft with a differing `outputsBase`
  turns stale (`usePipelineDraft.ts:146-158`), and Save & run is then refused.
- A pin made from the dashboard while some draft exists elsewhere has the same effect as a collaborator adding an
  Output. That is the existing behaviour of draft staleness, and it is accepted.

After the pin:

- The action becomes a "Pinned" status, announced and not repeatable.
- A failure shows an inline error with Retry.

This placement rule is self-approved; it is the driver's reading of "appears, placed".

**D5 Tier and error states.**

| Condition | What the user sees |
| --- | --- |
| `currentUser.tier === "free"` | The upsell in place of the field: "Asking about your data is on the beta plan." followed by the link "Request Beta access" to `/settings#beta-access` (opens in a new tab, with an sr-only "(opens in a new tab)"). No request is sent. |
| `403 TIER_FORBIDDEN` | The same upsell, since tier can change mid-session. |
| `429` | "Daily chat limit reached. It resets at the start of the next UTC day." Ask is charged to the shared daily chat budget (`checkConverseCap`), so the copy uses the same name the assistant composer already uses for that budget ("Daily chat limit", `MessageComposer.tsx:15`), not an "ask limit". The `limit` number is **never shown**: it counts weighted units, and showing it would touch the open billing-weight question. A test asserts no digit from `limit` appears. |
| `truncated` | "That answer ran out of room. Try a narrower question." This agrees with the server's "ask something narrower". |
| `ungrounded` (any other 422) | "Couldn't ground an answer in this data." Neutral: no rephrase advice, and server `reasons` are not echoed. |
| `unavailable` (503, other 5xx) and `network` | "Ask is unavailable right now", with Retry. |
| `invalid` (400) | A generic message. It cannot normally occur, because the client bounds the length. |

The upsell is a `features/ask/ui/AskUpsell.tsx` element (`<p className="ask-upsell">` and
`<Link className="ask-upsell__link">`) with its own CSS in `features/ask`. It uses the same tokens as the Output sheet's
upsell, but not that sheet's `output-editor-sheet__*` classes, so the drawer is not coupled to the Output sheet.

The question is kept in every state.

**D6 Accessibility.**

- The question field has a visible label. Enter submits and Shift+Enter inserts a newline. Submit is disabled while
  pending or when the trimmed text is outside 1..2000 characters.
- One `role="status"` live region per surface announces pending, answer arrived, each error and pinned. Answer arrival
  does not move focus.
- Focus on open goes to the question field.
- Focus on close comes from `BottomSheet` -> `Modal` (`Modal.tsx:94-166`, `previouslyFocusedRef`), which returns focus
  to the element that was focused at open. When that opener was a menu item that has since unmounted (the meta-row kebab
  at tier 2 and above, or the phone `CommandBar` kebab), `AskDrawer` restores focus to the kebab trigger instead. It
  follows the `KEBAB_TRIGGER_SELECTOR` / `restoreFocusSelector` precedent (`DashboardMetaRow.tsx:31,92`,
  `shareDialogContext.tsx`): the opener passes a selector, and on close, if focus landed on `body` or a disconnected
  node, the drawer focuses the selector's match.
- Touch targets meet the 44 px floor on phone (`tap-expand-44` where a control is icon-sized).

**D7 Wire seam (driver condition C1).**

New schemas, each pinned to its case class by `scripts/check-schema-drift.mjs`:

| Schema | Title |
| --- | --- |
| `schemas/ask/ask-ungrounded-response.schema.json` | `AskUngroundedResponse` |
| `schemas/ask/ask-truncated-response.schema.json` | `AskTruncatedResponse` |
| `schemas/ask/ask-tier-error-response.schema.json` | `TierErrorResponse`, `limit` optional |

New backend test `backend/src/test/scala/com/helio/api/protocols/AskSeamSpec.scala`:

- It is a new file and does not edit `AskRoutesSpec`. It is modelled on `DraftPreviewSeamSpec` and uses the current
  `AskApiHarness`, including `ScriptedTransport`'s `stopReasons`.
- It drives the real route for:
  - a 200 with pin (owner);
  - a 200 with `pin: null` (a dashboard viewer grantee with no pipeline grant);
  - a 422 ASK_UNGROUNDED (both attempts fail validation);
  - a 422 ASK_ANSWER_TRUNCATED (a `max_tokens` hop);
  - a 403 (a free user);
  - a 429 (a beta user at cap), if the harness can set the cap. If it cannot, 429 is validated at schema level only,
    and the gap goes in `red-evidence.md` and the PR, not in this file. The gap goes in
    `red-evidence.md` and the PR, not in this file.
- Each body is normalised deterministically, with generated ids replaced by placeholders such as `{{OUTPUT_1}}`. The
  spec then asserts equality with `shared-test-fixtures/ask/*.json` and validity against its schema. Regenerate with
  `HEL1746_WRITE_FIXTURE=1`.

Frontend half:

- `features/ask/services/ask.contract.test.ts` validates the same files with Ajv 2020 and runs them through
  `parseAskError` and the response types.
- The Playwright spec loads the same 200 and error fixtures, substitutes real ids, and fulfils only the `/ask` POST.

Ordering and limits:

- Red first: the seam spec is committed while it fails, before the fixtures and schemas exist.
- The e2e "viewer sees no pin" check is served a `pin: null` fixture, so it proves only the client's rendering rule. The
  server half is the seam spec's viewer case. The PR states both halves next to the seam statement.

**D8 e2e (`e2e/hel1746-ask-ui.spec.ts`).**

Users:

- Throwaway users have plain addresses, are registered through the API and recorded with `recordRegisteredUser`.
- The owner and the viewer are set to **beta** with `setUserTierForTest` (`e2e/support/historySeed.ts:63`) on exactly
  their registered ids, as `hel1744-insight-panel.spec.ts:146` does. A new registration is free, so without this the UI
  would show the upsell and send no ask.
- The free-tier user is left as registered.
- There is no insight render seed. That is the real non-goal.

Data, built through the public API:

- A pipeline with two Outputs.
- A dashboard with both placed.
- A viewer grant.

Flows:

- The owner asks with a fulfilled fixture, and the chips open provenance. The owner pins: a real POST creates the
  insight Output, and a panel appears in the not-yet-rendered state.
- The viewer asks and sees no pin.
- The free user sees the upsell, and zero ask requests are sent.
- The 422 ungrounded, 422 truncated and 503 states each show their copy.
- Keyboard-only operation, and focus return from the meta-row button and from the kebab item at a narrow width.
- On the pipeline page: Output sheet ask, then pin, and the Output list gains the insight. Pin is disabled while a draft
  exists.

Run conditions:

- Light and dark, desktop and phone.
- Evidence goes to `evidencePath("HEL-1746", ...)`.
- The spec asserts its page origin is the lane's `DEV_PORT` (7178).
- Workers: 2.

## Risks / Trade-offs

- A browser-level fake can drift from the server. D7 pins both sides to one set of files.
- An editor grantee who does not own the dashboard gets the Output saved, not placed. The PR states this.
- Re-measuring the meta-row tiers may shift existing tier boundaries. The re-measure is recorded, and the meta-row e2e
  specs are re-run.

## Gate-Chain Implications Checklist

This change does not modify any `.husky/**` script or anything such a script invokes, so the checklist does not apply.
