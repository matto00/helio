## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `ecefad62a191e68d32fdf333acb695f296671f1e`. The worktree fast-forwarded from `5e84b8e3b` to this commit
(`merge origin/main`, reflog HEAD@{0}) while I was reviewing. The new commit is HEL-1761. My claims are against the new HEAD.

### What I verified (with evidence)

- **Ask error ladder (design Context).** `AskRoutes.scala` follows the stated order: access 404, then 503, then 400
  (1..2000 after trim), then `TierErrorCompletion` 403/429, then the service. The 403 and 429 bodies are
  `TierErrorResponse(code, message, limit: Option[Int])`, which is defined in `api/protocols/assistant/AssistantConversationProtocol.scala:99`.
  The design's "title TierErrorResponse" therefore resolves to a real case class, so `check-schema-drift.mjs` will pin
  it. The drift check looks schemas up by title against every case class under `api/protocols/**`, and
  `AskUngroundedResponse` exists at `AskProtocol.scala`. **Now stale:** since HEL-1761 (`ecefad62a`), the route also
  returns `422 AskTruncatedResponse{message, code: "ASK_ANSWER_TRUNCATED"}` with no `reasons`, and
  `AskUngroundedResponse.reasons` now go through `AskReasons.publicOf`. The design's Context and D5/D7 describe only the
  older 422. See CR5.
- **HEL-1744 components.** `InsightMarkdown` takes `{markdown, citations: readonly string[], renderCitation}`, and
  `CitationChip` takes `{citation: InsightCitation, ordinal, insightPanelId, source}`. Both match the design.
  `remarkCitationChips` leaves an unknown `[cN]` as plain text, which matches the spec. Ask citation ids come in as
  `cN` (`AskPrompts.scala:14`). **A non-panel `insightPanelId` is safe:** it only flows to
  `useProvenancePopoverHost` as `panelId`, which is used only in `onProvenanceOpened({panelId, variant})`, and
  `provenanceTelemetry.ts:14-17` ignores `panelId` (`track("provenance_opened", {})`). The public fallback is unreachable
  for `variant: "authenticated"`. So the "widen to `telemetryId`" hedge in D2 is unnecessary (nit).
- **Ownership on the client.** `Dashboard.ownerId?: string` exists (`features/dashboards/types/dashboard.ts:36`), and
  absent means not-owner. The client holds no grant role. `currentUser.tier` exists (`features/auth/types/user.ts:63`).
  D4's "owner places, non-owner gets a link" is grounded.
- **AskApiHarness.** It can produce the 200 with pin (owner), the 200 with `pin: null` (a `grantBoard(..., "viewer")`
  grantee with no pipeline grant: `AskPinBuilder` requires pipeline Owner/Editor), the 422 (the
  `AskRoutesSpec` "two failures" case) and the 403 (`seedUser("free")`, `AskRoutesSpec:104`). It drives the real
  `ApiRoutes` through `buildAskApi`. The backend has `com.networknt json-schema-validator` as a test dependency
  (`backend/build.sbt:300`), so validating the schema in the seam spec is feasible. `DraftPreviewSeamSpec` is the
  precedent for the `*_WRITE_FIXTURE` pattern.
- **Pin path.** `pin.request` is a valid `CreateOutputRequest` body (`nodeStepId | rootId`, kind, name, config). Insight
  creation is not tier-gated. `createPanel({dashboardId, type: "output", title, outputId})` already calls
  `markDashboardPanelsStale` and `fetchPanels` itself (`panelThunks.ts:95-118`), and the server computes placement.
  D4's thunk-vs-service branch is justified: `createOutput.fulfilled` appends to `byPipeline[pid] ?? []`, which would
  fake a loaded list.
- **Drawer pattern.** `RefinementChatDrawer` is mounted in `App.tsx:338-346`, gated on `selectedDashboardId`, and uses
  `useOverlay()` with `autoFocus` on its textarea. `OverlayProvider.tsx` (47 lines) handles only single-active and
  Escape. **It has no focus capture or restore at all.** See CR3.
- **Meta row and command bar.** `usesDashboardMetaRow` is true only on the rail shell's dashboard view. The phone shell
  and every other page mount `CommandBar`. The meta row has measured responsive tiers (`useMetaRowTier.ts`:
  820/640/520 px, plus 150 in edit mode). DESIGN.md §9 "Meta row" enumerates its actions and says "Actions never wrap
  or truncate". See CR4.
- **Output sheet.** `OutputEditorSheet` takes a non-null `output` for HEL-1733 draft Outputs (client ids), and uses
  `hasServerRow = !isCreate && output !== null && !isDraftOutput(output)` (`OutputEditorSheet.tsx:99-101`). See CR1.
  It also receives `actions` and `draft` (HEL-1733 D3 routed writes). See CR2.
- **e2e tier.** The client gate shows the upsell and sends no request for a free user, and new registrations are
  free. The beta owner and the beta viewer therefore need `setUserTierForTest` (`e2e/support/historySeed.ts:63`,
  which is a DB write), as `hel1744-insight-panel.spec.ts:146` does. See CR6.

### Verdict: REFUTE

### Change Requests

1. **The Output-sheet gate is wrong for draft Outputs.** D3, task 3.2 and the spec ("for an Output that is not yet
   saved") gate the ask section on `output !== null`. Since HEL-1733, a draft Output is non-null with a client id.
   Asking `POST /api/outputs/<client-id>/ask` would 404, and the spec forbids the section for an unsaved Output. Gate
   it on the sheet's existing `hasServerRow` (`OutputEditorSheet.tsx:101`) in D3, task 3.2 and its test ("absent for a
   new Output **and for a draft Output**").
2. **Pinning while a pipeline draft is open is undesigned.** On the pipeline page, the sheet's writes go through
   `actions` while a draft exists (HEL-1733 D3). D4 pins with an immediate `createOutput`. That changes the saved
   Outputs under the draft, and `usePipelineDraft.ts:146-158` flips a restored draft whose `outputsBase` differs to
   stale, which refuses Save & run. D4 must choose one behaviour and add a test: (a) hide or disable Pin with a reason
   while `draft` is set, (b) route the pin through `actions.create` as a draft entry, or (c) argue with evidence that an
   immediate write is harmless. "Never goes through the HEL-1733 draft write route" does not address this.
3. **The focus-return mechanism rests on a false premise.** D6 says focus returns "through the existing overlay
   helper". `OverlayProvider` has no focus handling, and `RefinementChatDrawer` does not restore focus either. Name the
   real mechanism. For example, use the shared `BottomSheet`/`Modal` (focus trap and restore, DESIGN.md §10 "Bottom
   sheet"), which is also DESIGN.md's phone-sheet primitive and should replace the vague "full-width sheet". Otherwise,
   capture the opener on open and restore it explicitly. Also state where focus returns when the opener is a menu
   item that unmounts: the meta-row kebab (tier ≥ 2) and the phone `CommandBar` kebab. Follow the existing
   `KEBAB_TRIGGER_SELECTOR` precedent in `DashboardMetaRow.tsx:31`.
4. **The meta-row placement ignores the binding tier system and DESIGN.md §9.** A new visible Ask control changes
   widths that were measured in `META_ROW_TIER_WIDTHS`, and the row must never wrap or truncate. D3 must say:
   - which variant Ask takes at each tier (labelled, icon-only, or kebab);
   - that Ask is a secondary, non-accent control (Add panel stays the one primary);
   - its order among the actions;
   - that the tier thresholds are re-measured.

   Add a task to amend DESIGN.md §9's enumerated action list. Also state plainly that the `CommandBar` entry is the
   phone and non-rail opener, because `CommandBar` is not mounted on the desktop rail dashboard view.
5. **Re-base the design on the tree that now includes HEL-1761.** HEAD now contains `422 ASK_ANSWER_TRUNCATED`
   (`AskTruncatedResponse{message, code}`, with no `reasons`).
   - D5: `parseAskError` must handle this body without assuming `reasons`. Either map it to its own kind, or decide
     explicitly that it shares the generic 422 state. If it shares, the copy "Try rephrasing" should not contradict
     the server's "ask something narrower". A neutral generic 422 message satisfies the driver's "handle 422
     generically".
   - D7: either add a schema titled `AskTruncatedResponse`, so the drift check pins it, plus a fixture and a seam
     case if the harness can force `max_tokens`, or record why not.
   - Task 1.1: run it against the current harness (HEL-1761 edited `AskApiHarness.scala`). Drop or reword task 5.2's
     "HEL-1761 may have landed" and the D7 "HEL-1761 caveat".
6. **D8's setup claim is false.** It says setup uses the public API only (no DB seed). The owner and the viewer must
   be beta, or the UI shows the upsell and sends no ask, and the public API cannot set a tier. State that the spec uses
   `setUserTierForTest` on exactly the registered user ids, as HEL-1744's spec does, and keep "no render seed" as the
   real non-goal.

### Non-blocking notes

- D2: drop the `telemetryId` hedge. The authenticated chip ignores `insightPanelId`, so `ask:<scope>:<id>` is safe as
  is.
- D4: the explicit `markDashboardPanelsStale` call is redundant because `createPanel` already does it.
- The e2e "viewer sees no pin" check is served a `pin: null` fixture, so it proves only the client's rendering rule.
  The server half is the seam spec's viewer case. Say so in the PR next to the seam statement.
- Naming: the meta row already has "Open assistant" and ⌘K offers "Ask the assistant: …". Make sure the Ask control's
  label and tooltip read as asking about this dashboard's data ("Ask about this dashboard"), not as a second assistant.
