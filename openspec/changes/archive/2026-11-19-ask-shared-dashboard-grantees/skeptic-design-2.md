## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD b2603ab7998f3e9b4bdca5089a18f89da16fdc8b (change dir untracked). Spawn-cwd guard: READY. I read
skeptic-design-1.md only as a set of claims. Every point below I re-derived from the tree.

### What I verified (with evidence)

- **Round-1 CR1 is resolved. The D3a mutation now reaches the dashboard-only viewer's path.**
  - `AskPinBuilder.scala:24-27` calls `requireAccess("pipeline", pipelineId, ...)`. It pins on
    `Right(Owner) | Right(Editor)`; `case _ => None` covers everything else.
  - `AccessCheckerImpl.scala:70-79`: a non-owner caller with no grant row gets `Left(NotFound)` (`case None`). The
    resolver returning `None` also gives `Left(NotFound)`, at `:62-63`.
  - So for the seam `viewer`, `case _ => Some(...)` turns `Left(NotFound)` into a pin. Both checks then fail:
    `fx shouldBe norm` against the committed `ask-200-no-pin.json`, and `pin shouldBe JsNull`
    (`AskSeamSpec.scala:116-123,137-140`). The fixture file is rewritten only when `HEL1746_WRITE_FIXTURE` is set, so a
    normal run reads the committed copy and goes red.
  - The build is not short-circuited before `requireAccess`. `citedAnswer()` cites `rev` and `cost`
    (`AskSeamSpec.scala:46-47,74-77`), both on the one pipeline `pid`, so `pipelines.size == 1` and `reads.size == 2`.
    The owner case (`:130-135`) proves the same answer produces a non-null pin.
  - design.md D3 correctly explains why "accept Viewer" would stay green. tasks.md 4.2 is fixed to match.
- **D3b is sound, with one plumbing caveat (non-blocking note 1).**
  - The new editor case seeds a beta user with `grantBoard(board, _, "editor")` (`AskApiHarness.scala:208`) and no
    `grantPipeline`.
  - Unmutated, `requireAccess("pipeline")` returns `Left(NotFound)` → `None`. The response then normalises to the
    viewer's body, because the same ids are mapped and citation ids become `c1..`. So it equals `ask-200-no-pin.json`.
  - Under the mutation, `requireAccess("dashboard", board, editor)` gives `Right(Editor)` → pin → red. The viewer
    (`Right(Viewer)`) and the owner (`Right(Owner)`) behave as before, so the mutation is specific to the editor case.
- **D2 can be implemented as written.**
  - `CitationChip.tsx:42,53` takes `citation.panelId ?? insightPanelId` and calls
    `fetchPublicProvenance(dashboardId, panelId, token)`.
  - `InsightCitation.panelId?` already exists (`insightService.ts:17`). `toInsightCitation` spreads the citation, so
    setting `panelId` on it reaches the chip.
  - The panel type has `OutputPanel { type: "output"; config.outputId }` (`panel.ts:186,302-303`), and an
    `isOutputPanel` narrowing helper exists (`panelNarrowing.ts`).
  - `panelsSettledFor(state.panels, scope.id)` (`panelsSettled.ts`) is the existing predicate for "panels settled for
    that dashboard".
  - `selectIsDashboardOwner` exists (`dashboardAccess.ts:44`).
  - Putting the unmatched fallback in `AskAnswerCard` is required, and the design says so. `CitationChip` would
    otherwise fall back to `ask:dashboard:<id>`, built at `AskAnswerCard.tsx:43`.
- **D1 sites match the tree.**
  - `DashboardMetaRow.tsx:120-125` puts the kebab Ask inside `if (isOwner)`, inside `if (shareInKebab)`.
  - `DashboardMetaRow.tsx:233` renders `isOwner && !shareInKebab && askButton`.
  - `CommandBar.tsx:98-102` adds its item behind `...(isOwner ? ...)`.
  - `App.tsx:356` mounts `AskDrawer` without a gate.
- **Ask flow network surface.** The ask feature's only route call is `askService.ts:57-58`. The other network calls
  are the `dispatch` sites in `useAskPin.ts` (pin only). That backs the spec's carve-out ("except the pin action's own
  requests").
- **D4 harness.** The `AskApiHarness` app pool runs `SET ROLE helio_app_test_output_history`
  (`OutputHistoryApiHarness.scala:77,89`). That role is NOSUPERUSER and has no BYPASSRLS. The harness already has
  `appPoolBypassesRls()` (`:116-122`), which D4's probe can reuse. The payload-refusal scenario D4 asks to confirm
  already exists (`openspec/specs/ask-your-data/spec.md:85-87`).
- **Coverage of the acceptance criteria.**
  - AC1 (viewer can ask): D1 + e2e.
  - AC2 (no Output route from a link): D2 + "names stay plain" + the e2e zero-`/api/outputs` assertion.
  - AC3 (seam `pin: null` for a viewer): D3a, an existing case plus a mutation that reaches it.
  - AC4 (editor without a pipeline grant): D3b.
  - AC5 (scope re-check is the only data path; no payload rows): D4.
  - AC6 (free tier sees the upsell): D5. `AskPanel` already shows the upsell before any request.
  - None of the tasks goes beyond the ticket.

### Verdict: CONFIRM

### Non-blocking notes

1. D3b's mutation needs the asked board id, and `AskPinBuilder.build(question, cited, user)` does not take one. The
   scope exists only in `AskDataService.ask`; `finish` doesn't get it (`AskDataService.scala:49,111-118`). The
   mutation has to thread `scope.id` temporarily through `finish` → `build`. Record that in the mutation transcript, so
   it is clear the dashboard id really reached the builder (not, for example, a `pid` passed as "dashboard", which
   would give `Left(NotFound)` and stay green).
2. Spec hygiene. The base `ask-ui` "Answer card with citation chips" requirement still says every cited `[cN]` renders
   as a `CitationChip` that opens "the cited Output's provenance". The ADDED requirement says an unmatched citation on a
   non-owned dashboard renders as a plain ordinal. The specific rule wins in practice, but the two read as a
   contradiction. Consider a MODIFIED delta of that requirement, adding "except as the shared-dashboard requirement
   specifies", at archive time.
3. Driver constraint wording. The driver named `helio_app_test` / `TwoUserRlsApiFixture`. D4 uses the `AskApiHarness`
   NOBYPASSRLS role instead. The substance (non-BYPASSRLS, probed) is met, and the ask harness is the right place. Say
   so in files-modified or the evaluation, so the deviation is explicit.
4. C12 / task 1.5. The two backend cases (1.1 editor seam, 1.2 RLS) will pass before any code change, because the
   server already behaves correctly. Label them as guards proven by mutation, not as red-first tests, so the red
   transcript does not claim a red that never happened.
5. The `CommandBar.test.tsx` "viewer: no kebab at all" assertion becomes false once a viewer gets the Ask item. It is
   covered by 1.3's generic "update tests", but name it, together with `DashboardMetaRow.roles.test.tsx`
   ("neither shares nor asks") and `e2e/hel1773-viewer-grantee-dashboard.spec.ts` (viewer and editor Ask-absent
   assertions).
