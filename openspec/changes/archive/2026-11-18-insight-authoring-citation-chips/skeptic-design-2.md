## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 1e0d610bbabb8744c75d11f901a4a88110d5efd5. The worktree is main plus the untracked change dir.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/insight-authoring-panel-chips/HEL-1744`.

**Round-1 change requests:**

- **CR1 (backend picker pin): addressed.**
  - D1 now names `OutputKindDriftSpec.scala` ~l.123-129, flips it, and records both mutations.
  - Task 2.1 runs it explicitly.
  - Task 5.4 runs the full `sbt testFull`.
  - The case exists at the cited lines and asserts `values shouldBe withoutInsight` on `CREATABLE_KIND_OPTIONS`.
  - The base spec requirement "Every Output-kind enumeration site is pinned" (`openspec/specs/insight-output-kind/spec.md:79-87`) already requires removing an exclusion when a site gains insight. No delta is needed.
- **CR2 (pipeline owner, not Output creator): addressed.**
  - D2 keys the upsell on `page.isOwner`, which is `currentPipeline.ownerId === currentUser.id` in `usePipelineDirtyAndOwner.ts:54-57`, plus `tier === "free"`.
  - D7 adds `usePipelineOwnership(pipelineId)` over `Pipeline.ownerId`, with a fallback to `getPipelineById` (`pipelineService.ts:57`). `PipelineSummary.ownerId` exists (`pipelineStep.ts:722`), and `Output.pipelineId` exists (`output.ts:60`). If the user cannot read the pipeline, the hook resolves to false.
  - Editors see the neutral note. This is the fallback round 1 explicitly allowed, and it is stated in Risks and planned for the PR.
  - The specs now say "Ownership is the pipeline's owner, never the user who created the Output". They also add a free-tier-editor scenario and a creator-editor viewer scenario.
  - `OutputEditorSheet` is used only from `PipelineDetailDialogs.tsx`, so `isOwner` is available wherever the card renders.
- **CR3 (same node for root-bound Outputs): addressed.**
  - D2 defines `sameInsightNode`: same `nodeStepId`, or same `rootId` with both lacking a step. It never matches on two `undefined` values.
  - A "Two roots" scenario was added to the insight-authoring spec, and task 2.2 adds a unit test.
- **CR4 (`reads.windows` preservation): addressed.**
  - D3 carries the stored windows in every `reads` write. A checklist returned to the default writes `reads: {windows}` when windows are stored, and `null` otherwise. Unit tests cover all four combinations.
  - The spec scenario "Stored windows survive" was added.
  - The backend accepts a `reads` object with only `windows`: `InsightConfig.scala:45` allows `ReadsKeys = {outputs, windows}`, and `parseReadOutputs` treats an absent `outputs` as `None`, which is the same-node default.

**Fresh review:**

- **Shapes match the schemas.** `output-insight-response.schema.json` has `render.createdAt` and `lastAttempt.status`, and the authenticated citations carry `outputId`. The public schema has `renderedAt`, and its citations have no `outputId`. D7 uses "`createdAt`/`renderedAt`" for the footer, so both are covered.
- **Delta headers match the base spec.** Both MODIFIED requirement names match the base specs exactly:
  - "Insight panel shows a not-yet-rendered state" (`insight-output-kind/spec.md:71`);
  - "Public insight read" (`insight-render-store/spec.md:43`).
- **Footer premise holds.** `PanelCard.tsx:332` renders `Updated {...panel.meta.lastUpdated...}`, as D7 says.
- **e2e seed premise holds.** `historySeed.ts` uses `SET LOCAL app.current_user_id` and has `setUserTierForTest`. `V145__output_insights.sql` exists. The seed path is test-only and driver-authorized, and the PR will disclose it.
- **AC coverage is complete.** Every acceptance criterion maps to a task:
  - prompt-less create + two cited sentences: D9 and task 5.2;
  - chip popover with computed style and focus in a real browser: D9;
  - public viewer shows no cost: D4 allow-list, D9 and the spec;
  - light/dark × desktop/phone: D9 and D11.
- **Carry-overs are covered.** Footer, rows refresh, `role="status"` and picker (frontend and backend) all have tasks.
- **No placeholders.** No TBD, no deferred decision that blocks implementation, and nothing that duplicates L4 work (C10).
- **Round-1 notes were taken up.** N1 (chip popover props), N2 (remark-rehype handler and `allowedElements`), N3 (ACL first, system context, tie-break test) and N5 (no rows fetch, now a spec requirement) are all folded in.

### Verdict: CONFIRM

### Non-blocking notes

1. **State precedence.** The spec says "exactly one" state. It does not say which wins when a free-tier pipeline owner has no render and the newest attempt is `skipped_quota`/`skipped_budget`, which is plausible once L4 bills free-tier owners. That case matches both upsell and quota. Suggestion: upsell wins when there is no render. Pin it as a row in the state-derivation table.
2. **Round-1 CR2's suggested unit row** ("an editor-created insight viewed by the pipeline owner shows quota, not neutral") is not named in task 1.1. The "Viewer never sees quota" scenario covers the reverse direction. Add the owner-sees-quota row so a regression back to `Output.ownerId` goes red from both sides.
3. **Spec wording.** insight-authoring says the editor "SHALL NOT write ... `reads.windows`", but the "Stored windows survive" scenario re-sends the stored windows. The two agree in meaning (the windows are unchanged), but a literal reader could trip on it. In the PR or the archived spec, prefer "SHALL NOT change `reads.windows`".
4. **D9 negative assertions.** Seed distinctive token and cost values, for example `inputTokens: 734211` and `costMicros: 918273`. Small numbers can appear in timestamps or ids by chance and make the "contains none of" assertion flaky, or vacuously pass.
5. **MODIFIED not-yet-rendered requirement.** The sentence binds "has no render and no render attempt" to the panel. The live Output column keeps the not-yet-rendered state unconditionally (Non-Goals). The sentence reads either way. The executor should keep the live column's behavior unchanged and give it the same `role="status"` through the shared component.
