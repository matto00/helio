## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `78aa53e3a2f502d6cc36ada2e30976e1f027d6e8` (matches my own `git rev-parse HEAD`).
Diff base resolved LIVE via `scripts/concertino/resolve-review-base.sh` → `b590855d5f2ddc76c9abf2e75fca5e5120cd5d7a`.
Gates re-run by me in `WORKTREE_PATH`; the executor's pasted output was not relied on.

### Phase 1: Spec Review — FAIL

The three ops are genuinely authorable and the ticket's substantive ACs are met, but several
`tasks.md` items are marked `[x]` while the verification they explicitly mandate is absent.

PASS:
- All three ops registered and rendering real editors (verified live in the running app, not just in tests).
- No backend / migration / `helio-mcp` change: `git diff --name-only` outside `frontend/` + `openspec/` is empty (item 9).
- Scope boundary honored: `OpDropdown` gained exactly 3 entries (25 menu items live = 22 prior + 3), no grouping/filtering, no frontend group mapping (HEL-1136 untouched).
- Constraint C1 honored: no `400` claim on a config-validation path in any new code/comment/test/spec. The
  only `400` strings in the change dir are (a) correct statements that 422 is returned and 400 is reserved
  for unknown-type/decode, and (b) skeptic reports *recording the correction*. Not a violation.
- Constraint C2 honored in substance — see Phase 2.
- `ticket.md`'s `allowedOps` correction is accurate (zero occurrences in tree).

FAIL — tasks marked done whose mandated verification does not exist:
1. **Task 3.1** requires "a test asserts no `updatePipelineStep` call for a temp id AND that a real id still
   PATCHes". Only the second half exists. No test anywhere in `frontend/src/features/pipelines/` asserts that
   a `^step-\d+$` id does **not** PATCH. The guard's own purpose is therefore unguarded; a future edit could
   delete the `persist` guard and every test would still pass.
2. **Task 3.8** requires asserting the disclosure's **absence** on `convertformat`. `ConvertFormatConfig.test.tsx`
   contains no such assertion (zero hits for the disclosure copy).
3. **Task 4.3** (config-parity tests vs. the shape `add_pipeline_step` documents, incl. `outputSchema` order)
   — **no such test exists**. Zero hits for `add_pipeline_step`/`parity` across the feature tree. The
   `PipelineDetailPage` test asserts the wire shape sent to `createPipelineStep`, which is adjacent but is not
   the documented-parity comparison the task claims.
4. **Task 4.4** claims "keyboard-only completion of every control including the ordered-row move controls".
   The three card test files contain **no keyboard-driven assertions** (no `keyDown`/`userEvent`/Tab). The
   accessible-name half is genuinely covered (`getByRole(..., { name })` uses the computed accessible name).
5. **Task 4.6** was correctly and honestly reported as not done. I performed it — see Phase 3. It failed, and
   surfaced CR1.

### Phase 2: Code Review — FAIL

Gates, all run by me, all green:
- `npm run lint` (`--max-warnings=0`) — clean, exit 0
- `npm run format:check` — "All matched files use Prettier code style!"
- `npm run typecheck` — exit 0
- `npm --prefix frontend run build` — exit 0
- `npm test` — 320 suites / 3429 tests passed, plus 28 suites / 271 tests (helio-mcp), exit 0

Verified load-bearing specifics:
1. **`convertformat` seed (item 1) — CORRECT.** `defaultConfigFor` returns `{ field: "" }` and the test asserts
   **absence**, not shape: `expect("from" in seed).toBe(false)` / `expect("to" in seed).toBe(false)`
   (`stepNarrowing.test.ts`). This is the exact assertion the design gate demanded.
2. **`persist` guard (item 2) — correct behavior, flawed factoring.** `^step-\d+$` exactly matches what
   `makeStep` mints (`id: \`step-${stepCounter}\``, `stepNarrowing.ts:377-380`). A real id still PATCHes
   (asserted). **No disagreement in production:** the three pre-existing loose `startsWith("step-")` sites
   (`usePipelineDetailPage.ts:1084`, `:1187`, `:1200`) are *broader*, and real backend ids are UUIDs, so both
   predicates agree on every id that actually occurs at runtime. The divergence is only reachable by
   test-fixture ids like `step-rename-1`. Not a defect, but see CR3 (the predicate is now triplicated inline).
3. **Registry drift guard (item 3) — genuinely non-vacuous; `groupby` exception is legitimate but under-tracked.**
   I independently re-ran the guard's regex against `PipelineStep.scala`: it captures **27/27** registered kinds
   with **none missed** by the non-greedy `Map\(([\s\S]*?)\n\s*\)` capture, so there is no silent truncation.
   The guard resolves each kind string from each step file's own `val Kind` rather than trusting prose — so the
   stale `UpsertSourceConfig.scala:17-19` "deliberately NOT registered" comment (the kind *is* registered at
   `PipelineStep.scala`) cannot mislead it. C2 is satisfied in substance: the failability test proves the
   comparator goes red, and the companion assertion `registryKinds.length >= 27` prevents a parser that returns
   `[]` from passing vacuously. `groupby` is confirmed **pre-existing** (absent from `OP_TYPES` at base
   `b590855d`; only a `defaultConfigFor` arm exists) and the exception is documented in-code and in the handoff.
   It does not defeat the guard's purpose.
4. **`outputSchema` array + order (item 4) — CORRECT.** Typed `OutputSchemaField[]`, emitted as an array, and
   the reorder test asserts the emitted element order changes (`b,a` → `a,b`).
5. **No `FormField`; `StatusChip intent="neutral" dashed` (item 5) — CORRECT.** Zero `FormField` in
   `stepConfigs/`; `StepCard.tsx:234` uses exactly the D6-mandated chip recipe. Verified live.
6. **Cost disclosure (item 6) — CORRECT, and runtime-safe.** Live copy: "This step calls the AI model once per
   input row. It never runs automatically, and each call draws on your account's shared daily AI budget. **The
   pipeline's current estimated row count is 1000.**" — pipeline-attributed, never a step call count; no
   currency or token figure anywhere. I also confirmed against the live API that `costVerdict` is present on
   every analyze response sampled, so `analyzeResult?.costVerdict.estimatedRows` cannot throw.
7. **50-entry cap (item 7) — CORRECT.** Enforced in `handleAddField` *and* via `disabled={atCap}`, with a
   "Limit reached" hint; tested at exactly `MAX_OUTPUT_SCHEMA_ENTRIES`.
8. **C1 (item 8) — CORRECT** (see Phase 1).
9. **No backend/migration/MCP change (item 9) — CORRECT.**

Theme-guard question (raised mid-review): **resolved in the executor's favor.** The four re-pinned
`tokenAuditSweep.css.test.ts` baselines point at the *identical declarations* before and after
(`983→988`, `1046→1051`, `1255→1260`, `1486→1491` are all still `gap: 4px` / `margin-right: 2px`; CSS is
+6/-1). The guard's coverage was **not** narrowed and no exception was added — it was mechanically re-pinned.
The in-code comment says the shift is "6"; it is actually 5 (non-blocking).

Shared render-path question (raised mid-review): **each edit is required, none is drive-by.**
`PipelineDetailPage/PipelineRiverView/RootColumn/LaneColumn` changes are purely additive prop threading
(`estimatedRows`, `draftCreateErrors`) to reach every `StepCard` call site (top-level, lane, child-lane, root);
`StepOpEditor` dispatches the three new kinds; `StepCard` adds the draft chip and a `draftError` `InlineError`.
No existing op's behavior is altered on these paths. The fixture renames to `persisted-step-*` are justified
(the fixtures were semantically wrong — temp-shaped ids standing in for persisted rows) and are documented,
not a guard-loosening.

Findings — see Change Requests 1-4.

### Phase 3: UI Review — FAIL

Servers started via `scripts/concertino/start-servers.sh` on the pinned ports and **identity-verified** as
required: `readlink /proc/<pid>/cwd` → `.../hel-1109/frontend` (vite, port 6541) and `.../hel-1109/backend`
(sbt/java, port 9448). Both inside THIS worktree, so every observation below is this branch's code.
Pipeline used: `proj-2026-flat` (`ebf9617e…`) — 1 root, 1 pre-existing step, 124-field source schema,
`estimatedRows: 1000`.

PASS:
- All three ops appear in the live op picker (25 menu items = 22 + 3).
- **Deferred create verified live:** adding `analyzewithai` and `generatetext` issued **no create request** —
  network log shows only `GET /steps`. The `StatusChip` "Draft — not yet saved" renders immediately.
- The draft's field picker is **populated** (real source fields, e.g. `player.injury_body_part`), so the draft
  is actually completable.
- Disclosure copy exact per D5; all inline required-field errors fire on an empty draft.
- **Zero console errors** across every flow tested, in both themes, at every breakpoint.
- Layout holds at 1440 / 1100 / 768: no document overflow, no clipped or overflowing controls, fields stack
  full-width in the standard 8px flex-column rhythm.
- At 360 the only overflowing elements are **shared card chrome**, and a control measurement on the
  pre-existing `Compute column` card shows *identical* values (`actionsCluster` 118/108, `moveBtn` 34/24) —
  **pre-existing**, not introduced here.

FAIL — **CR1**, found only by doing the live pass the executor skipped:

Every AI **draft** card renders **124 struck-through red "removed" chips** — one per source column
(`− category`, `− company`, `− player.metadata.injury_override_*`, …) — filling the card body and pushing the
actual editor below the fold. The card asserts, falsely, that the step **drops all 124 columns**.
Reproduced on both `analyzewithai` and `generatetext`, in **both light and dark** themes
(`removedChips: 124` measured in each).

Root cause, confirmed by source comparison (not inference):
- `StepCard.tsx`'s `<StepSchemaDiffChips input={analyzeSchema} output={analyzeOutputSchema} …>` call site is
  **byte-identical** at base and HEAD — the regression is not there.
- This ticket changed `getAnalyzeSchema`/`getAnalyzeColumns` to return the draft **fallback** schema, but left
  `getAnalyzeOutputSchema` (`usePipelineDetailPage.ts:571-575`) returning `EMPTY_ANALYZE_SCHEMA` for a step
  with no analyze entry.
- So for a draft: `input` = 124 fallback fields, `output` = `[]` → `computeSchemaDiff` classifies all 124 as
  `dropped`.
- At base this was **unreachable**: with no analyze entry *both* sides returned empty, the diff was empty, and
  `StepSchemaDiffChips` returned `null`. The one-sided fallback created the defect, and the durable draft state
  (new here) makes it persistently visible, where other ops' temp steps are replaced by a real id within a tick.

This is a DESIGN.md-level honesty/cohesion failure, not a token-compliance one: the card is composed of
correct tokens and still tells the user something false.

Evidence (persisted, with checksums):
- `.concertino/runs/HEL-1109/evidence/evidence-hel1109/hel1109-analyzewithai-dark-1440.png` — sha256 `48dbc347…`
- `.concertino/runs/HEL-1109/evidence/evidence-hel1109/hel1109-generatetext-light-1440.png` — sha256 `76a863e8…`
- `.concertino/runs/HEL-1109/evidence/evidence-hel1109/hel1109-generatetext-light-768.png` — sha256 `78bc8dbe…`
- `.concertino/runs/HEL-1109/evidence/evidence-hel1109/hel1109-generatetext-light-360.png` — sha256 `0d4c849c…`

No claim in this report rests on file mtime or directory ordering; each rests on a content measurement,
a checksum, or a cited line number.

### Overall: FAIL

### Change Requests

1. **Fix the false "all columns removed" diff on AI draft cards** (Phase 3, blocking).
   `frontend/src/features/pipelines/ui/StepCard.tsx:343` renders `StepSchemaDiffChips` with a 124-field
   `input` and an empty `output` for any pending draft. Preferred fix: suppress the schema-diff surface for a
   step that has no real analyze entry (a draft's diff is not knowable), rather than mirroring the fallback into
   `getAnalyzeOutputSchema` — a mirrored fallback would instead claim "no columns change", which is also not
   known to be true. Add a test asserting a draft `analyzewithai`/`generatetext` card renders **zero**
   `.pipeline-detail-page__step-card-diff-chip--removed` chips, and re-check both themes live.

2. **Narrow and specify the unplanned draft-schema fallback** (`getDraftFallbackSchema`,
   `usePipelineDetailPage.ts:519-541`). It should be **narrowed and specified, not removed** — without it the
   draft's picker is empty and the config is uncompletable, so it is load-bearing. Required changes:
   (a) For a lane draft, resolve the schema from the parent step rather than the flat backward walk over
   `steps`: `pendingDraftMetaRef` already stores `parentStepId`, so the ambiguity the code's own comment
   admits ("Imprecise for a step inside a non-trunk lane") is avoidable, not inherent. As written, a lane
   draft can be offered fields from an unrelated trunk step and thus complete a config referencing a field
   its real input does not have.
   (b) Add a spec requirement covering the fallback in `specs/pipeline-ai-step-authoring/spec.md` — no
   requirement currently describes this behavior at all.
   (c) Add tests for the two untested paths: the "nearest earlier step" walk, and a lane/multi-root draft.
   Only the first-ever-step root-schema path is currently exercised.
   Containment is otherwise good: the fallback is draft-scoped, and a persisted step's real analyze entry
   takes precedence, so it cannot disagree with the backend after creation.

3. **Single-source the temp-id predicate.** `/^step-\d+$/` is now inlined at three sites
   (`useStepCardState.ts:277`, `useStepCardState.ts:490`, `StepCard.tsx:163`) while three pre-existing sites use
   a looser `startsWith("step-")` (`usePipelineDetailPage.ts:1084`, `:1187`, `:1200`). This invariant is owned by
   `makeStep`'s minting format; if that format changes, five+ call sites break silently. Export a single
   `isTempStepId(id: string)` from `stepNarrowing.ts` (beside `makeStep`) and use it at all sites. This mirrors
   design.md D3's own rule — "derived in one place rather than op-name checks at call sites" — which was applied
   to the op property but not to the temp-id predicate.

4. **Close the four claimed-but-missing verifications, or unmark the tasks** (Phase 1 items 1-4): a
   temp-id-does-not-PATCH test (3.1), a disclosure-absence assertion on `convertformat` (3.8), the
   `add_pipeline_step` config-parity tests including `outputSchema` order (4.3), and keyboard-driven completion
   of the ordered-row move controls (4.4). Task 3.1's is the most important: the `persist` guard is currently
   the one new behavior with no test in its own purpose's direction.

### Non-blocking Suggestions

- The `groupby` deferral is documented but names no real task ("spinoff candidate"). File the Linear ticket so
  the exception in `KNOWN_UNLISTED_KINDS` has a real owner; an untracked exception tends to become permanent.
- `tokenAuditSweep.css.test.ts`'s new comment says the baselines shifted "by 6"; the actual shift is 5.
- At 360 the new cards' header `label` is squeezed (`scrollW` 89 vs `clientW` 53) where the pre-existing card's
  is not, because the draft chip shares the header row. It truncates without breaking layout, so it is cosmetic.
- Review hygiene: my evidence PNGs are untracked in the worktree at `evidence-hel1109/` and at the main repo
  root (`hel1109-*.png`). Durable copies are already in `.concertino/runs/HEL-1109/evidence/`. I did not delete
  them (files under `~`); they should be removed before any `git add -A` picks them up.
