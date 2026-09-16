## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Fresh cold spawn. Every conclusion below is re-derived from this worktree, the live app, or gates I ran
myself. The executor's and evaluators' reports were read as claims to verify, and two of their claims did
not survive verification (see Non-blocking 1).

**Cwd guard.** `pwd -P` → `/home/matt/Development/helio`; `assert-cwd.sh` →
`READY ambient=/home/matt/Development/helio branch=feature/step-cards-three-new-steps/hel-1109`.

**Head reviewed:** `bbd07bdad449a288c30f42b77db908fadc2a6d1b` — matches the pinned SHA and my own
`git rev-parse HEAD`, re-checked after I finished reading the diff. Working tree clean (`git status
--porcelain` empty), so the reviewed commit is exactly what is on disk. Diff base resolved LIVE via
`resolve-review-base.sh` with its exit status checked → `b590855d5f2ddc76c9abf2e75fca5e5120cd5d7a`.

### What I verified (with evidence)

**Gates, all re-run by me at this head:**
- `npm run lint` (`--max-warnings=0`) — clean, exit 0
- `npm run typecheck` — exit 0
- `npm test` — **321 suites / 3448 tests passed** (+6 vs cycle 2's 3442), plus helio-mcp 28 suites / 271 tests
- `npm --prefix frontend run build` — exit 0 (853.66 kB bundle, PWA emitted). NB: `npm run build` at the
  worktree root does **not** exist ("Missing script") — the `--prefix frontend` form is the real gate.
- `npm run check:tokens` — "every var(--*) reference resolves"

**Scope.** `git diff --name-status` outside `frontend/` + `openspec/` is empty: no backend, no migration, no
`helio-mcp` change, as required.

**Servers are this worktree's.** `start-servers.sh` reported "already healthy … reusing" for both, so I
verified identity rather than trusting it: `readlink /proc/1122868/cwd` → `.../hel-1109/frontend`,
`readlink /proc/1121451/cwd` → `.../hel-1109/backend`.

#### Defect 1 (cycle 1: 124 false struck-through "dropped column" chips) — FIXED, verified live in BOTH themes

Measured on the same fixture that produced it (`proj-2026-flat`, 124-field source, `estimatedRows: 1000`):

| measurement | light | dark |
|---|---|---|
| `--removed` diff chips on the AI draft card | 0 | 0 |
| any `step-card-diff-chip` | 0 | 0 |
| `step-card-diff` container present | no | no |
| elements computing `line-through` | 0 | 0 |
| editor offset from card-body top | 13px | 13px |

Mechanism confirmed in source, not inferred: `StepCard.tsx:163` derives `isDraft = isTempStepId(step.id)`
and `:352` wraps `StepSchemaDiffChips` in `{!isDraft && …}`. The regression guard
(`StepCard.test.tsx:616-644`) is genuinely discriminating — it feeds a 124-column fallback input with an
empty output and asserts both zero `--removed` chips and absence of the diff container.

#### Defect 2 (round 1: empty declared name never surfaced, silent permanent dead end) — FIXED, and the fix is per-row and non-visual

Measured live with two blank declared rows, reproduced independently in light and again in dark:

| row | `aria-invalid` | `aria-describedby` | resolves inside its OWN row | error text |
|---|---|---|---|---|
| 1 | `true` | `analyzewithai-output-field-0-empty-error` | yes | "Output field name is required" |
| 2 | `true` | `analyzewithai-output-field-1-empty-error` | yes | "Output field name is required" |

Per-row identifiability is real, not a card-level message: the ids are index-distinct, each error node is a
DOM child of its own `__aggregate-groupby-row`, and the card-level "At least one output field is required"
correctly gives way once rows exist. `aria-invalid` is absent (not `"false"`) on a filled name — asserted
both live and by the new negative test. Code: `AnalyzeWithAiConfig.tsx` computes `isEmpty`/`nameErrorId` per
row and no longer gates the empty case behind `trimmedName !== ""`.

**On the hand-rolled `<p className="inline-error">` rather than `<InlineError>`:** not a divergence. I read
`InlineError.tsx` — its default `"text"` variant renders literally `<p className="inline-error">{error}</p>`,
so the markup is identical; the component exposes no `id` prop, which `aria-describedby` requires. Correct
call.

**Neither fix regressed the other or the persisted path.** Both defect-1 and defect-2 measurements hold
simultaneously on the same card. For the persisted path: the expanded persisted `Compute column` card shows
no draft chip, no AI disclosure, and its own `compute-config` editor. I will not overclaim from that card —
its diff was already empty pre-fix (matching evaluation-2's own reading), so it is a weak witness. The real
non-regression witness is the pre-existing `StepCard — real schema diff chips (HEL-405)` suite (4 tests
asserting chips DO render for non-draft steps), which passes inside my own 3448.

#### Ruling on the unplanned structural refactor (the orchestrator's explicit question)

**(a) Is the necessity reasoning correct?** Substantially yes, with one overstatement that does not damage
the conclusion. `handleAddLaneStep` (`usePipelineDetailPage.ts:812-813`) computes
`insertIndex = anchorIndex + 1`, so a freshly added lane draft is always array-adjacent to its true anchor;
the anchor-based and array-position strategies therefore agree for any state a "+lane" **click itself**
produces, and a live-UI test cannot force them apart. That is exactly what the extraction's doc comment and
`PipelineDetailPage.test.tsx:684-695` now say, and the pre-existing end-to-end test was honestly re-labelled
as wiring proof rather than discriminating proof. The overstatement: divergence is reachable *later* (insert
a trunk step between anchor and draft, and array-adjacency breaks while `parentStepId` still points at the
anchor). That cuts **in favor** of the anchor-based implementation, so it strengthens rather than
rationalizes. This is not a test exercising an impossible state — it isolates a real branch whose two
strategies the UI cannot separate on its own.

**(b) Is it behavior-preserving?** Yes, verifiably. The extracted body is a line-for-line transposition of
the previous closure: same `meta?.parentStepId` branch, same `parentEntry.outputSchema` return, same
backward walk from `index - 1`, same terminal `getRootSourceSchema(meta?.rootId)`. The only change is that
the map/ref/lookup reads are now injected closures (`(id) => analyzeByStepId.get(id)`,
`pendingDraftMetaRef.current.get(stepId)` at the call site) — identical semantics, and the `useCallback` dep
array is unchanged (`[steps, analyzeByStepId, sourceSchemaForRoot]`, the ref correctly not a dep). Blast
radius is confined to the draft path: `getDraftFallbackSchema` has exactly two consumers
(`usePipelineDetailPage.ts:558`, `:569`), both guarded by `pendingDraftMetaRef.current.has(stepId)`, which
is only ever populated for the two deferred-create AI kinds. **The other 22 ops cannot reach this code
path**, and their create flow is separately pinned by the `convertformat`-still-POSTs-immediately regression
test. Verdict: necessary enough, behavior-preserving, and appropriately scoped — I do not treat it as a
forbidden unrelated refactor.

#### The itemized re-checks

- **`convertformat` seed.** `defaultConfigFor` returns `{ field: "" }`; the test asserts key ABSENCE
  (`expect("from" in seed).toBe(false)`, `"to"` likewise), not shape — the correct assertion, since a
  present-and-empty pair is what the backend 422s.
- **`outputSchema`.** Typed `OutputSchemaField[]`, emitted as an ordered array; reorder changes emitted
  order (asserted `b,a` → `a,b`, and again in the parity test as `confidence,sentiment`); cap is 50,
  enforced in `handleAddField` AND via `disabled={atCap}` plus a "Limit reached" hint.
- **Registry drift guard (C2).** Parses `PipelineStep.Registry` from Scala via a repo-root walk, resolving
  each kind from its own `val Kind`; exceptions are exactly `KNOWN_UNLISTED_KINDS = {join, groupby}`. It is
  failable in its purpose's direction (a fake parsed kind yields `missing == ["totallyMadeUpOpKind"]`).
  `UpsertSourceConfig.scala`'s stale "deliberately NOT registered" comment cannot mislead it — the guard
  reads the Registry, where `upsertsource` is registered, and `upsertsource` is in `OP_TYPES`.
- **C1.** No "400" claim on a config-validation path in new code, comments, tests or specs. Every surviving
  `400` string is either the correct contrast statement (400 reserved for unknown type / decode failure) or
  a report recording the correction. The three `advanceTimersByTime(400)` hits are millisecond values.
- **No `FormField`** anywhere in `stepConfigs/`; the unsaved-draft affordance is
  `StatusChip intent="neutral" dashed` (`StepCard.tsx:233-237`), confirmed live as "Draft — not yet saved".
- **Cost disclosure (D5).** Live copy verbatim in both themes, with `hasCurrencyOrToken: false` measured on
  the card text, and `estimatedRows` rendered as "The pipeline's current estimated row count is 1000" —
  attributed to the PIPELINE, never this step's call count. Absent on `convertformat`, asserted in its test.
  I independently agree with D5's reading: the cost sentence is ticket *Description* prose, the live Linear
  AC is only authorable/identical-configs, and the design spec parks the figure under Open questions. A
  fabricated dollar figure would be worse than none. No escalation owed.
- **AC trace.** (1) *Authorable in the UI* — all three wired in `StepOpEditor.tsx:311-338`, each rendering
  its own editor rather than the unsupported notice; verified live for `analyzewithai`. (2) *Authorable by an
  agent* — unchanged `add_pipeline_step` path, no `helio-mcp` edit needed. (3) *Identical configs* —
  `addPipelineStepConfigParity.test.tsx` asserts the exact key set per op via `Object.keys(emitted).sort()`
  plus `outputSchema` element order, quoting `write.ts`'s documented shapes inline. Its controlled-wrapper
  is the right construction (a fixed `config` prop could never reach a fully-populated config).
- **`tasks.md` 4.4 wording.** Now matches the test exactly: it claims computed accessible names plus
  keyboard-OPERABILITY preconditions (native `button`, focusable via `.focus()`, non-disabled, same handler
  Enter/Space reaches), and explicitly disclaims full keyboard-only completion. I re-verified the premise
  rather than accepting it: `@testing-library/user-event` appears in no `package.json` and has zero hits in
  the lockfile. The decorative `keyDown`/`keyUp` lines are genuinely deleted. Neither over- nor
  under-claiming.
- **Console.** Zero errors and zero warnings across the whole flow on a clean load, both themes.

### Verdict: CONFIRM

Both user-visible defects are fixed, verified live by my own measurement in both themes rather than by unit
tests, with neither fix regressing the other or the persisted-step path. The refactor is behavior-preserving
and properly scoped. Every itemized contract above holds. Nothing I found rises to blocking, and I am not
spending the budget-exhaustion escalation on the test-strength and polish items below.

### Non-blocking notes

1. **Two `[x]` tasks still lack their mandated verification — the executor's "re-checked every `[x]`,
   corrected only 4.4" claim is false in two places.** This is C3's own subject matter, so it should be
   corrected (add the tests, or narrow/uncheck the tasks) rather than left as inaccurate delivery artifacts.
   - **Task 1.2** mandates "narrowing an `AnalyzeStepResult` on each of the three `type` values in a
     type-level test and reading the narrowed `config` field". No such test exists: `AnalyzeStepResult` is
     referenced at exactly two sites in all of `frontend/src` (`pipelineStep.ts:539`, `:622`) and in no test.
     (Task 1.1's analogous proof DOES exist — `_AdmitsNewKinds` at `pipelineStep.ts:403-412` — which is why
     I checked this rather than assuming symmetry.)
   - **Task 3.6** mandates "a test asserts no `analyzePipeline` dispatch results from adding a draft AI
     step". No test asserts this; the create-once test takes its `toHaveBeenCalledTimes(1)` baseline
     *before* the add and never re-asserts afterward.
   - Both behaviors are nonetheless correct in the shipped code, which is why this is not blocking: the
     three `*AnalyzeStep` union members are present (`pipelineStep.ts:526-563`) and the draft exclusion is
     explicit at `usePipelineDetailPage.ts:345-348`
     (`.filter((s) => !pendingDraftMetaRef.current.has(s.id))`).
2. **The new per-row error is visually cramped — the one thing I would fix before the next AI-card ticket.**
   `.pipeline-detail-page__aggregate-groupby-row` is `display:flex; align-items:center` with **no
   `flex-wrap`** (`PipelineDetailPage.css:1630-1635`), so the error `<p>` becomes a fifth flex item squeezed
   beside the remove `X`: measured **65px wide × 45px tall** (three wrapped lines), inflating each row to
   45px. Identical in both themes. This card is the first consumer to place an error inside that row — the
   sibling `AggregateConfig` puts only a Select and a remove button there (`AggregateConfig.tsx:139-155`) —
   and it diverges from this same card's own full-width "Instruction is required" treatment. It is legible,
   correctly coloured (`rgb(175,51,37)` light / `rgb(241,123,103)` dark, both tokenized) and correctly
   associated, so it ships; the fix is to let the row wrap or move the error beneath it. Applies equally to
   the pre-existing duplicate/collision errors in the same rows. Evidence:
   `/home/matt/Development/helio/.concertino/runs/HEL-1109/evidence/.playwright-mcp/skeptic-r2-hel1109-blank-names-light.png`
   and `…/skeptic-r2-hel1109-blank-names-dark.png`.
3. **Otherwise the visual judgment is a pass, in both themes.** The three cards stay in the established
   step-card dialect: uppercase `__compute-label` field labels, `__compute-fields-hint` muted paragraphs for
   disclosures, the existing `__aggregate-groupby-row` vocabulary for ordered rows rather than a new row
   primitive, and a CSS diff that is a three-selector addition reusing `var(--space-2)`. Light/dark parity
   holds (card `rgb(38,35,32)` dark, label/hint `rgb(170,164,156)`), `check:tokens` passes. No new visual
   dialect — no escalation owed on that axis.
4. `pipeline-analyzewithai-editor/spec.md:48-50` states the empty-name requirement normatively but has no
   dedicated `#### Scenario` for it (duplicate, collision and empty-schema each have one). Cosmetic spec
   asymmetry now that the behavior is implemented and tested.
5. Two pre-existing gaps confirmed and correctly routed to owner triage, not this change's defects:
   `groupby` is in the backend registry but absent from `OP_TYPES` (no `GroupByConfig.tsx` exists, and its
   `KNOWN_UNLISTED_KINDS` exception still names no ticket), and `helio-mcp/src/tools/write.ts` documents
   these config rejections as a "named 400" where the backend returns 422.

### Evidence-integrity disclosures

- **A console `ReferenceError: resolveDraftFallbackSchema is not defined` appeared mid-session and I did NOT
  treat it as a verdict.** It crashed `PipelineRiverView` into the ErrorBoundary and named this round's
  extracted symbol, so it was the single most verdict-relevant reading of the run. I reproduced instead of
  concluding: on a hard reload (fresh Vite module graph) I re-ran the entire flow (add → expand → two blank
  rows) and measured **0 console errors**, no error boundary, and both defect measurements intact. The
  import exists at `usePipelineDetailPage.ts:25` and the export at `stepNarrowing.ts:446` at this HEAD with
  a clean working tree, and `npm --prefix frontend run build` succeeds. Conclusion: a stale-HMR artifact of
  the long-lived reused dev server (the error's own stack carried `?t=…` HMR timestamps), not a defect in
  the reviewed commit. Flagging it explicitly because a less careful pass would have shipped it as a
  blocking crash — or, worse, never re-read the console at all.
- All load-bearing claims above rest on self-authenticating evidence: command output, cited file:line,
  computed DOM/CSS measurements, and content-identified screenshots. **No claim anywhere in this report
  depends on mtime ordering or on directory placement**, and I accepted no mtime-ordering claim from any
  prior report. No gate defect of that class to record.
- Screenshots were captured to the main checkout root by the browser tool and relocated to the worktree's
  gitignored `.playwright-mcp/`, then persisted; the stray root PNGs were removed and the worktree
  `git status` is clean, so `check:no-credential-leak`'s top-level-dir check is unaffected.
