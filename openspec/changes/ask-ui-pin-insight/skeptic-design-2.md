## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `ecefad62a191e68d32fdf333acb695f296671f1e` (HEL-1761 included). The planning artifacts are untracked in
the change dir. I checked every claim below against the live tree, not against the round-1 summary.

### What I verified (with evidence)

**Round-1 CRs**

- **CR1 (resolved).** `OutputEditorSheet.tsx:101` is
  `const hasServerRow = !isCreate && output !== null && !isDraftOutput(output);`. D3, task 3.2 and the spec's "No ask
  for an unsaved or draft Output" scenario now all gate on it, and the task's tests cover both create mode and a draft
  Output.
- **CR2 (resolved).** The sheet receives `draft?: OutputSheetDraft` "only while a pipeline draft exists"
  (`OutputEditorSheet.tsx:76-78`). `PipelineDetailDialogs.tsx` passes `draft={sheetDraft}` gated on
  `page.draft.hasDraft`. The staleness rationale matches `usePipelineDraft.ts:146-158`: a kept `outputsBase` that
  differs from the loaded Outputs sets `staleRestored`. The design chooses option (a), a disabled Pin with a visible
  reason. That choice is in D4, task 3.2 and a spec scenario. Pinning from the dashboard while a draft exists elsewhere
  is explicitly accepted as equivalent to a collaborator's write. That is a stated trade-off, not an omission.
- **CR3 (resolved).** `Modal.tsx` captures `previouslyFocusedRef` on open, outside the dialog, and restores it on close
  and on unmount. `BottomSheet.tsx` composes `Modal`. When the captured element has been detached, `focus()` does
  nothing. The selector fallback copies `shareDialogContext.tsx:46-55`, which focuses a selector on a deferred tick.
  `KEBAB_TRIGGER_SELECTOR` is at `DashboardMetaRow.tsx:31` and used at `:92`. The phone `CommandBar` kebab is the same
  `ActionsMenu label="Dashboard actions"` (`CommandBar.tsx:246-247`). The mechanism is real and implementable.
- **CR4 (resolved).** The order in D3 matches the actual JSX: the group (edit tools, Edit layout, Share, Add panel),
  then the appearance editor, then the assistant, then the kebab (`DashboardMetaRow.tsx:130-196`). "Ask in the kebab
  at tier ≥ 2 with the assistant" matches `shareInKebab = tier >= 2` and the existing kebab push of "Open assistant".
  Task 3.1a re-measures `META_ROW_TIER_WIDTHS` (`useMetaRowTier.ts`: 820/640/520, plus 150 in edit mode) and amends
  DESIGN.md §9, whose meta-row bullet is at `DESIGN.md:1093-1106`. The `CommandBar` scope is right:
  `usesDashboardMetaRow` = `!isPhoneShell && isDashboardViewPath` (`dashboardChrome.ts`), and the CommandBar's
  dashboard kebab renders only when `onDashboardView && selectedDashboard !== null`. The icon `MessageCircleQuestion`
  exists in the installed lucide-react as an alias of `MessageCircleQuestionMark`.
- **CR5 (resolved).** `AskProtocol.scala:33` defines `final case class AskTruncatedResponse(message: String, code:
  String)`. `AskRoutes.scala:64` writes it. `ScriptedTransport(..., stopReasons: Map[Int, String])` exists
  (`AskApiHarness.scala:77`), so the seam can force `max_tokens`. No schema under `schemas/` currently carries the title
  `TierErrorResponse`, `AskUngroundedResponse` or `AskTruncatedResponse`, and each title resolves to a case class under
  `api/protocols/**`, which is what `check-schema-drift.mjs:167-177` requires. The "HEL-1761 may have landed" caveat is
  gone. Task 5.2 now names HEL-1757.
- **CR6 (resolved).** `setUserTierForTest(userId, "beta" | "owner")` is at `e2e/support/historySeed.ts:63`. It updates
  exactly one id and refuses the dev account. `hel1744-insight-panel.spec.ts:146` uses it the same way. D8 states this
  correctly.

**New checks**

- **Provenance popover inside a modal sheet.** `useProvenancePopoverHost.tsx:125` portals into
  `closest("dialog") ?? document.body`. Chips inside the BottomSheet or Modal therefore stay interactive and are not
  inert behind the top layer.
- **Driver condition C1.** D7/1.1 covers the 200 with pin, the 200 with `pin: null`, 422 ASK_UNGROUNDED, the 403,
  red first, and the same files validated on both sides. The harness has no tier-cap setter: `usageToday` exists, but
  I found no cap override. So the 429 fallback ("schema level only, gap recorded") is a reasonable conditional, and C1
  does not require a 429 case.
- **The upsell copy source.** D5 points at `InsightKindFields`. Its text is "Insights render on the beta plan." plus
  "Request Beta access" (`InsightKindFields.tsx:97-108`). See CR2.
- **429 semantics.** `AskRoutes.scala:47-52` runs `chatAccess.guard` then `chatAccess.checkConverseCap(user, tier,
  weight, label)`. Ask is charged against the **shared daily chat budget**, not a separate ask budget. The `limit` is
  in the weighted units of that budget (`ChatAccessError.scala:22-30`). See CR2.
- **Desktop presentation of the drawer.** `BottomSheet` always renders `<Modal size="full">` (`BottomSheet.tsx`
  return), and `.ui-modal--full` is `width: min(1200px, calc(100vw - 32px))` (`Modal.css:87-89`). The sibling
  dashboard AI surface, `RefinementChatDrawer`, is a 420 px side drawer (`RefinementChatDrawer.css:34`). See CR1.

### Verdict: REFUTE

### Change Requests

1. **D3/D6: specify the desktop presentation of `AskDrawer`. As written it is a 1200 px modal.** The shared
   `BottomSheet` takes no `size`. Above 768 px it is `Modal size="full"`, which is 1200 px wide (`Modal.css:87-89`).
   Implemented literally, a single question field and an answer of at most 6 sentences and 1200 characters would sit in
   a 1200 px dialog that covers the whole dashboard. Line lengths would run well past any readable measure, and the
   result would be far heavier than the sibling 420 px `RefinementChatDrawer`. An experienced eye would reject that at
   the final gate. Choose a width and record it in D3, task 3.1 and task 3.3. Either:
   - (a) add an optional `size` passthrough to `BottomSheet`. That is a shared-component change, so amend DESIGN.md §10
     "Bottom sheet" and add a test that the phone presentation is unaffected. Then use `md` or `lg`; or
   - (b) keep `BottomSheet` unchanged and justify the full width with evidence.

   Do not hand-roll a width override in feature CSS on `.ui-modal--full`.
2. **D5: fix two pieces of user-facing copy that are wrong or ambiguous as specified.**
   - The 429 row reads "Daily ask limit reached". The cap is the shared daily chat budget: `checkConverseCap`, whose
     server message is "Daily chat message limit reached". A user who used up the budget in chat and has never asked
     would be told their *ask* limit is spent. The copy must name the shared daily assistant/chat limit. Also decide
     whether to show `limit` at all. It counts weighted units, so showing it beside asks edges into the open
     billing-weight question the ticket says to stay neutral on. The neutral choice is to omit the number. Whichever
     you choose, state it and test it.
   - The free-tier row says "copy and `/settings#beta-access` link as in `InsightKindFields`". That copy is "Insights
     render on the beta plan.", which is wrong for ask. Write the exact ask upsell sentence into D5, and name the
     element and class to reuse. `output-editor-sheet__upsell-link` is an Output-sheet class. Do not couple the
     dashboard drawer to it without saying so.

### Non-blocking notes

- At tiers 0-1, Ask (`MessageCircleQuestion`) sits right next to the assistant (`MessagesSquare`): two speech-bubble
  glyphs side by side. Consider whether the tooltip and label are enough to tell them apart, or choose a glyph that
  says "question about this data". Judge it in the final visual check.
- D3: "the `CommandBar` item ... shown when a dashboard is selected". Say "inside the existing dashboard kebab
  (`dashboardActionItems`)", so nobody adds a top-level CommandBar control on non-dashboard pages.
- proposal.md Impact omits `CLAUDE.md` (task 5.1), and omits `shared/motion/BottomSheet.tsx` if CR1 is resolved by
  (a).
- D7's 429 fallback says "the gap is recorded here", meaning design.md. Recording it in red-evidence.md or the PR
  instead would avoid executor edits to design.md mid-run.
