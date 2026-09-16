## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `1ba690bf5056d822f09bcc60678c3e3fa9efe99a` (matches my own `git rev-parse HEAD`).
Diff base re-resolved LIVE via `scripts/concertino/resolve-review-base.sh` → `b590855d5f2ddc76c9abf2e75fca5e5120cd5d7a`.
All gates re-run by me in `WORKTREE_PATH`; the executor's pasted output was not relied on.

### Phase 1: Spec Review — PASS (with one artifact-accuracy defect, non-blocking)

Cycle-1 Phase 1 failed on four `[x]` tasks whose mandated verification did not exist. Three are now
genuinely closed with real tests; the fourth is closed in substance but its task wording still overclaims.

- **Task 3.1 — CLOSED.** New `useStepCardState.test.ts` describe block asserts all three directions:
  a `step-1` temp id does NOT PATCH, a real id (`a1b2c3d4-real-backend-id`) DOES, and `step-rename-1` is
  not mistaken for a temp id. The guard now has a test in its own purpose's direction.
- **Task 3.8 — CLOSED.** `ConvertFormatConfig.test.tsx` asserts the absence of all three disclosure
  phrases on the non-AI card.
- **Task 4.3 — CLOSED, and genuinely a parity test.** New `addPipelineStepConfigParity.test.tsx` asserts
  the exact key SET per op (`Object.keys(emitted).sort()`), quotes `write.ts`'s documented shapes inline,
  and asserts `outputSchema` element order after a reorder. Its header correctly distinguishes itself from
  the wire-shape assertions `PipelineDetailPage.test.tsx` already makes. The controlled-wrapper comment
  explains why a fixed `config` prop could not exercise a fully-populated config — an honest and correct
  observation.
- **Task 4.4 — substance closed, WORDING NOT NARROWED.** See the ruling below and Non-blocking #1.
- **Task 4.6** remains `[ ]` and was again not performed by the executor, again reported honestly. I
  performed it — see Phase 3. It now PASSES.

**Ruling on the `user-event` claim (item 2), verified rather than accepted:** the claim is TRUE.
`@testing-library/user-event` appears in **no** `package.json`, has **0** occurrences in
`package-lock.json`, is not present in either `node_modules/@testing-library/` tree (only `dom`,
`jest-dom`, `react`). The rationale therefore does not collapse.

**Ruling on whether the proxy is adequate evidence:** it is adequate for *these* controls, and is not
evidence-shaped non-evidence. The assertions it makes are the real, implementation-specific preconditions
that browser-native Enter/Space activation depends on: `tagName === "BUTTON"` (no custom `role`), not
`disabled`, no `tabIndex={-1}`, no `aria-hidden`, and genuinely focusable (`.focus()` → `toHaveFocus`).
Given a native `<button>` with no key handler of its own, Enter/Space activation is a platform guarantee,
not app behavior, so the residual untested risk is negligible. Two caveats: the
`fireEvent.keyDown`/`keyUp` bracketing around the synthetic `click` exercises nothing and is the one
decorative part of the test (a reader may mistake it for real Enter activation); and the test covers only
the move-up/move-down controls, not "every control".

Scope, contracts and constraints re-checked at this commit: still no backend/migration/`helio-mcp` change
(diff outside `frontend/` + `openspec/` is empty); C1 still honored (no `400` claim on a config-validation
path); C2 still honored (drift guard unchanged and still non-vacuous).

### Phase 2: Code Review — PASS

Gates, all run by me at `1ba690bf`:
- `npm run lint` (`--max-warnings=0`) — clean, exit 0
- `npm run format:check` — "All matched files use Prettier code style!"
- `npm run typecheck` — exit 0
- `npm --prefix frontend run build` — exit 0
- `npm test` — **321 suites / 3442 tests** passed (+13 vs cycle 1's 3429), plus 28 suites / 271 tests
  (helio-mcp), exit 0

**CR1 — fixed, and fixed the right way.** `StepCard.tsx:343` now wraps the diff surface in `{!isDraft && …}`
rather than mirroring the fallback into the output side. The in-code comment states exactly why the
alternative was rejected ("would instead assert the equally-unknown 'nothing changes'"), which is the
correct reasoning. Live confirmation in Phase 3.

**CR2 — correct in code.** `getDraftFallbackSchema` now branches on `meta?.parentStepId`: a lane draft
resolves from that exact anchor's `analyzeByStepId` entry (`parentEntry.outputSchema`); a trunk draft keeps
the backward walk; both fall back to the new `sourceSchemaForRoot(meta.rootId)`, which matches
`sourceSchemas` by `rootId` and only then degrades to `[0]`. `handleAddLaneStep` records the anchor's own
`rootId`.
**I verified the fix is not vacuous:** `Step` genuinely carries `rootId?: string` (`types/step.ts:49`,
HEL-968 task 2.1), so `anchorStep?.rootId` reads a real field rather than silently yielding `undefined`
forever. Residual (acceptable, and inherent): when the anchor is itself an unsaved draft it has no
`rootId` yet, so the last resort is `sourceSchemas[0]` — unavoidable, since the root is unknown until a
create resolves.

**CR3 — a genuine narrowing, and it is safe. Verified at each of the three pre-existing sites.**
`isTempStepId` is exported once from `stepNarrowing.ts:401` beside `makeStep` (which mints
`step-${stepCounter}`), and all six call sites now use it; no inline regex or `startsWith("step-")`
remains in `src`.
- `:1124` (`handleRemoveStep` DELETE gate), `:1227` and `:1240` (reorder `persistedIds` / reconcile) each
  moved from a broader predicate to a narrower one, so strictly *fewer* ids are treated as temp.
- **No production behavior change:** a persisted id is a UUID and cannot match either predicate's
  `step-` prefix, so the two disagree only on ids of the form `step-<non-numeric>`, which the app never
  mints.
- **No test's meaning silently changed:** the one test that exercises the temp branch ("removing a step
  removes its card", `PipelineDetailPage.test.tsx:486-499`) creates its step through the op picker →
  `makeStep` → a numeric `step-N`, which is temp under *both* predicates, so it still asserts
  `deletePipelineStepMock` was not called for the reason it always did. And the tightened semantics are
  now explicitly pinned by the new `step-rename-1` test rather than left implicit.

Non-blocking `tokenAuditSweep.css.test.ts` comment ("by 6" → "by 5") was corrected as suggested.

### Phase 3: UI Review — PASS

Servers via `scripts/concertino/start-servers.sh` on the pinned ports. The script reported
"already healthy … reusing" for both, so I re-ran the identity check rather than trusting it:
`readlink /proc/1122868/cwd` → `.../hel-1109/frontend`, `readlink /proc/1121451/cwd` →
`.../hel-1109/backend`. Both inside THIS worktree, so the observations below are this commit's code.
Pipeline: `proj-2026-flat` (`ebf9617e…`), 124-field source schema, `estimatedRows: 1000` — the same
fixture that exhibited the cycle-1 defect, chosen deliberately so a regression would be reproduced.

**CR1 verified GONE, by measurement, in BOTH themes** (not by the unit test):

| measurement | cycle 1 (defect) | light @1440 | dark @1440 |
|---|---|---|---|
| `--removed` diff chips on the AI draft card | **124** | **0** | **0** |
| `step-card-diff` container present | yes | **no** | **no** |
| elements with `line-through` | 124 | **0** | **0** |
| editor offset from card-body top | below ~124 chips | **13px** | **13px** |
| card body height | very large | **403px** | **403px** |

The editor is the first thing in the card body and is visible in the viewport; the rendered screenshots
confirm the body opens directly onto "INPUT FIELD" / "INSTRUCTION" with no chip wall.

**Non-draft path not blinded by the fix** (the regression risk the fix itself created): the persisted
`Compute column` card, expanded, measures `diffContainer: false` with all chip counts 0 — **identical to my
cycle-1 measurement of that same card before the fix**, so the gate changed nothing for real steps (that
step's diff was already empty). The pre-existing "StepCard — real schema diff chips (HEL-405)" suite, which
asserts added/removed/changed/renamed chips DO render for non-draft steps, still passes inside the 3442.

Also re-confirmed live this cycle: the `StatusChip` "Draft — not yet saved" affordance; deferred create
(only `GET /steps` in the network log, **no** create request, in both themes); the disclosure copy verbatim
with the row count attributed to the **pipeline** and no currency/token figure; both inline required-field
errors; and **zero console errors** across every flow, both themes.

Evidence (persisted; `.playwright-mcp/` is gitignored at `.gitignore:37`, and per the orchestrator's note I
created no top-level directory in the worktree this cycle):
- `.concertino/runs/HEL-1109/evidence/.playwright-mcp/hel1109-c2-analyzewithai-light-1440.png` — sha256 `acfc7d7c…`
- `.concertino/runs/HEL-1109/evidence/.playwright-mcp/hel1109-c2-analyzewithai-dark-1440.png` — sha256 `8ac43ed8…`

Cycle-1 evidence integrity independently re-verified: all four PNGs at
`/tmp/hel1109-evidence-backup/evidence-hel1109/` hash to exactly the checksums recorded in
`evaluation-1.md` (`48dbc347…`, `76a863e8…`, `0d4c849c…`, `78bc8dbe…`), so the relocation was
byte-identical and my cycle-1 findings remain anchored. No claim in either report rests on mtime or
directory ordering.

### Overall: PASS

The cycle-1 blocking defect is fixed, fixed in the preferred way, and verified live in both themes on the
same fixture that exhibited it. All four change requests are substantively addressed. Every gate passes on
my own runs. The remaining items are artifact-accuracy and guard-strength, none of which can ship a wrong
behavior.

### Non-blocking Suggestions

1. **`tasks.md` 4.4 still claims more than its verification delivers** — the one item I would fix before
   archive. `tasks.md` was not modified this cycle, so 4.4 still reads "covering keyboard-only completion of
   **every** control including the ordered-row move controls", while what is verified is
   focusability/native-button/non-disabled preconditions plus handler activation for the **move** controls
   only. This is the exact defect class cycle 1 failed on, now reduced to one sentence. Narrow the wording to
   what the proxy actually establishes (and note the `user-event` absence as the reason), rather than leaving
   an archived checklist asserting coverage that does not exist. Consider also deleting the
   `fireEvent.keyDown`/`keyUp` lines around the click in `AnalyzeWithAiConfig.test.tsx`: they exercise nothing
   and are the part most likely to be misread later as real Enter activation.
2. **Two of the new spec requirement's four scenarios lack discriminating tests.** The requirement text is
   substantive and describes the shipped behavior accurately (lane anchor, trunk walk, root last resort), and
   scenario 1's test is properly discriminating (the root schema deliberately omits `clean_notes`, so a
   root-fallback implementation would fail it). But:
   - Scenario 2 (lane anchor vs. unrelated trunk step): the test's own comment concedes "this exact insertion
     ordering … makes the two agree here too", i.e. it would also pass under the cycle-1 flat-array walk. It
     locks in the contract by name, not by behavior. A discriminating case is constructible — an anchor that
     is *not* the draft's immediate array predecessor.
   - Scenario 4 (multi-root resolves the owning root): no draft-fallback test exists; the `root-2` fixtures
     in `PipelineDetailPage.test.tsx` belong to unrelated tests. Note the related asymmetry that
     `handleInsertStep` still records `rootId: roots[0]?.id` unconditionally for a **trunk** draft, so on a
     multi-root pipeline a trunk draft whose predecessors have no analyze entry would resolve root 0 — the
     lane path is the one this cycle made root-accurate.
3. `groupby`'s `KNOWN_UNLISTED_KINDS` exception still names no real Linear ticket (carried from cycle 1).
4. Cosmetic, carried from cycle 1: at 360 the new cards' header label is squeezed by the draft chip; the
   narrow-width chrome overflow remains pre-existing (control-measured against the persisted card).
5. Hygiene, for the owner rather than the executor: cycle-1's four PNGs are still at the main repo root
   (`/home/matt/Development/helio/hel1109-*.png`) and a byte-identical backup sits at
   `/tmp/hel1109-evidence-backup/`. Durable copies are under `.concertino/runs/HEL-1109/evidence/`, so both
   are safe to delete; neither I nor the executor removed them absent owner approval (files under `~`).
