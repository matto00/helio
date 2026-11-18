## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 1e0d610bbabb8744c75d11f901a4a88110d5efd5 (worktree = main + untracked change dir).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=feature/insight-authoring-panel-chips/HEL-1744`.
- **Picker premise:** `outputKinds.ts` `CREATABLE_KIND_OPTIONS` omits insight; `kindOptionsFor` appends it for an
  existing insight. `outputKindDrift.test.ts:46` pins the exclusion. `OutputEditorSheet.openingState.test.tsx:311` and
  `OutputKindConfigCard.tsx:179` carry the L1 placeholder text. These match D1.
- **A second picker pin the plan misses:** `backend/src/test/scala/com/helio/domain/model/OutputKindDriftSpec.scala:123-129`.
  The case "the Output editor's create picker excludes insight (HEL-1744 L5 owns it ...)" reads `outputKinds.ts` text
  and asserts `values shouldBe withoutInsight`. D1 does not mention it. Tasks 2.1 and 5.4 scope sbt to "touched backend
  specs", so this case would go red only in CI. See CR1.
- **Ownership proxy (D7):** `OutputService.scala:159-162` creates an Output with `ownerId = user.id`, which is the
  creator. An editor grantee can create Outputs (`OutputService.scala:112`, `:210`). So `Output.ownerId` is not the
  pipeline owner. Elsewhere tier means the pipeline owner's tier: L2 retention joins `pipelines.owner_id -> users.tier`
  (archive `insight-render-store-read-api/design.md:16-17,97`), `Output.historyPayloadsAvailable` is documented as
  "the PIPELINE OWNER's tier (never the viewer's tier)" (`frontend/src/features/pipelines/types/output.ts`), and L4
  bills `AiPipelineQuotaGate.checkAndIncrement(owner, ...)` (HEL-1743 design D6). L4 D8/R3b shows real quota status
  to owner AND editor (by pipeline role). The client can read this: `Pipeline.ownerId` and the analyze response's
  `callerRole: "owner" | "editor" | "viewer"` (`pipelineStep.ts:667-672,722`). See CR2.
- **Root-bound Outputs:** `Output.nodeStepId?` and `rootId?` are mutually exclusive (`output.ts:58-63`, and the
  multi-root spec). D2/D3 define "same node" only by `nodeStepId`. See CR3.
- **D3 reads/windows:** D3 says "a checklist returned to the default -> `reads: null`" and also "when stored `reads`
  has `windows`, writing `reads.outputs` keeps them". The insight-authoring spec says the editor "SHALL leave any of
  them [reads.windows] already stored unchanged". `reads` is replaced as one key (`InsightConfig.parseReads`). So
  `reads: null` with stored windows deletes the windows. See CR4.
- **Authenticated chip ACL (D6):** the cited Output's provenance route (`ProvenanceRoutes.scala`, `findById` -> RLS
  `outputs_select` = `helio_can_access_pipeline`, V94) uses the same pipeline-access check as the authenticated insight
  read (`OutputInsightReadService.scala:24,49`). `InsightReadsCheck` keeps cited Outputs in the same pipeline. Anyone
  who can read the insight can therefore read every cited Output's provenance. D6's authenticated key choice is sound.
- **Public route and projection (D8):** `PublicPanelInsightResolver.scala` resolves the panel and Output after the
  dashboard ACL. `OutputInsightResponses.public` builds the response from an allow-list. The protocol writes optional
  keys only when present. D8's change is additive and fits that pattern.
- **Shared pieces exist:** `ProvenanceTrigger.tsx` (`placeProvenance`, `usePortalPopover`, `useProvenance`,
  `ProvenancePopover`, opener focus return, `closest("dialog")` container). `HistoryPayloadsField.tsx:56` already links
  `to="/settings#beta-access"`. `setUserTierForTest` (`e2e/support/historySeed.ts:63`) and `db.cjs` exist. DESIGN.md
  §"Long lists" (l.776) exists. `StatusChip`, `SegmentedRadioGroup` and `EmptyState` exist. All six regression specs
  named in task 5.2 exist under `e2e/`.
- **Footer site:** `PanelCard.tsx:332` renders `Updated {panel.meta.lastUpdated}`. The panel passes
  `refresh={panelData.refresh}` (l.316). L1 skeptic-final notes (a) and the refresh note match the carry-overs D7
  claims.
- **Backend tier/preset facts:** `InsightPreset` = auto, delta, trend, leaders, summary. `InsightRefresh` = on_run,
  daily, manual. `MaxPromptChars` = 2000, `MaxReadOutputs` = 8. These match D2/D3.

### Judgments requested

- **D6 chip-anchored popover: faithful.** The ticket asks that a chip "open the cited Output's provenance popover".
  D6 opens the same `ProvenancePopover` with the cited Output's provenance, anchored at the chip. That is the cited
  Output's popover. The alternative, driving the target panel's own trigger, cannot work for an unplaced Output on an
  authenticated board, which the ticket implies by giving only the public board a fallback. The refactor is guarded by
  the HEL-1756 unit and e2e specs, unmodified. Two details are unspecified (see notes N1).
- **D8 public `panelId`: in scope and safe.** "Where that Output isn't placed, it falls back" needs the placed case to
  resolve to a panel, and the public shape deliberately has no `outputId`. `panelId` names only a panel on the
  already-authorized, already-public dashboard, whose provenance is already public through that panel's own trigger.
  It leaks nothing about unplaced or other-dashboard Outputs, as long as the map is built only from the requested
  dashboard (the spec scenario pins this). This is the minimal enabling change.
- **D7 client-side collapse: acceptable as defence in depth, but keyed on the wrong identity.** Collapsing on the
  client is fine. L4 collapses on the server, and the default-to-neutral branch is forward compatible with
  `not_updated`. Keying it on `Output.ownerId === currentUser.id`, and the upsell on `currentUser.tier`, is wrong.
  See CR2.
- **Coverage:** every AC and every carry-over has a task, except that the picker carry-over misses the backend pin
  (CR1). "Rendering" is unreachable in the app until L4. That is honest given the L4 dependency and is stated. The
  seed path is driver-authorized, test-only and disclosed in the PR.

### Verdict: REFUTE

### Change Requests

1. **D1 / tasks 2.1, 5.4: the backend pin of the picker exclusion is missed.**
   `backend/src/test/scala/com/helio/domain/model/OutputKindDriftSpec.scala:123-129` asserts that
   `CREATABLE_KIND_OPTIONS` equals `withoutInsight`. Adding `insight` turns it red.
   - Add this case to D1. Flip it to "offers every kind" (or delete it, so the frontend drift test is the single pin)
     and update its label.
   - Add `OutputKindDriftSpec` to task 2.1's Verify line and to 5.4's backend spec list.
   - Record the backend mutation in `mutations.md` alongside the frontend one.
2. **D7, D2 and the insight-panel and insight-authoring specs: "owner" must mean the pipeline owner (or pipeline
   role), not the Output's creator.**
   - `Output.ownerId` is the creator (`OutputService.scala:162`). An editor-created insight would show the paying
     pipeline owner the neutral note, and show the editor quota or upsell wording.
   - A free-tier editor on a beta owner's pipeline would see "Insights render on the beta plan" on the card and the
     panel upsell, which is false.
   - Revise as follows:
     - Quota/budget wording goes to the pipeline owner and editors (R3b, matching L4 D8). Use the pipeline's
       `ownerId` or `callerRole` where available. If the dashboard panel has no cheap access to the role, show it to
       the pipeline owner only, and state that editors see the neutral note.
     - Show the upsell (panel and card) only when the signed-in user is the pipeline owner and has the `free` tier.
       This mirrors the `historyPayloadsAvailable` precedent, "pipeline owner's tier, never the viewer's".
     - Reword the spec scenarios "the signed-in user owns the Output" and "a free-tier user opens the insight card"
       to match.
     - Add a unit row: an editor-created insight viewed by the pipeline owner shows quota, not neutral.
3. **D2/D3: define "same node" for root-bound Outputs.** An Output has either `nodeStepId` or `rootId`. A comparison
   on `nodeStepId` alone treats every root-bound Output, on any root, as "same node" (`undefined === undefined`). That
   pre-ticks the wrong set and makes the omit-`reads` rule wrong.
   - Specify "same node = same `nodeStepId`, or same `rootId` when `nodeStepId` is absent".
   - Add a spec scenario or unit test with two roots.
4. **D3: clearing `reads` destroys stored `reads.windows`.** "Checklist returned to the default -> `reads: null`"
   contradicts the spec rule that `reads.windows` already stored stays unchanged.
   - Specify: when stored `reads.windows` is non-empty, returning to the default writes `reads: {windows}` with
     `outputs` absent. Otherwise write `reads: null`.
   - Add a configPatch test for it.

### Non-blocking notes

- **N1 (D6):** say what the chip popover passes for:
  - `label`: suggest "Data provenance for <cited field>".
  - `comparison`: suggest none. The comparison store is keyed by panelId, and the chip has no panel of its own.
  - `onProvenanceOpened` telemetry `panelId`: the insight panel's id, or skip.
  - `pipelineHref`.
- **N2 (D5):** react-markdown's `allowedElements` runs on hast. The custom `citation` mdast node needs a
  `remarkRehypeOptions.handlers` entry, and the resulting element name must be in `allowedElements` or be mapped
  through `components`. Otherwise `unwrapDisallowed` silently strips every chip to its text. The red tests will catch
  this, but naming it saves a cycle.
- **N3 (D8):** use the system/internal context for the panel query only after the dashboard ACL has passed (house
  pattern), and keep the "lowest panel id" tie-break pinned by a test.
- **N4:** the proposal says the footer currently shows "the node's data time". `PanelCard.tsx:332` shows
  `panel.meta.lastUpdated`. The executor should confirm what that field is before describing the change in the PR.
- **N5:** the initial rows fetch for an insight panel still runs, and its rows are ignored. This is not in the
  carry-over, so leaving it is fine. A one-line skip would remove a useless request per panel, if it is cheap.
