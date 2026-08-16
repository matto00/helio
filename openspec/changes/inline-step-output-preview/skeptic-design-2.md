## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **All planning artifacts re-read fresh**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-step-preview/spec.md` from
  `openspec/changes/inline-step-output-preview/`. Round 1's report
  (`skeptic-design-1.md`) read as a claim to re-verify, not trusted.

- **Round-1 blocking item (persistence mechanism) — genuinely resolved.**
  - Ground truth re-confirmed: `PipelineRiverView.tsx` mounts every `StepCard` unconditionally
    (`steps.map`); `StepCard.tsx:64` — `const [expanded, setExpanded] = useState(false)` — and the
    **only** place `expanded` ever flips is `StepCard.tsx:143`,
    `onClick={() => setExpanded((v) => !v)}` on the card's own header button. There is no other
    code path that sets `expanded` (grepped `StepCard.tsx` + `PipelineRiverView.tsx` for
    `setExpanded`/`expanded` — only the one handler; new steps from shape-instantiation or add-step
    also mount fresh with `expanded=false` and go through this same handler to open). This means
    the revised Decision 3 mechanism ("re-sync `previewOpen` from localStorage on every
    collapsed→expanded transition, in the header-click expand handler") has exactly one call site
    to touch and it is co-located with the state it needs to update — mechanically sound, no gap.
  - Traced the exact spec scenario again against the revised mechanism: page loads, N cards mount
    (previewOpen defaults from lazy initializer). User expands card 1 (collapse→expand transition,
    resync — no-op, nothing stored yet), toggles preview open → `previewOpen=true`,
    `localStorage["helio-step-preview-open"]="true"` written. User now expands card 2 for the first
    time → this **is** a collapsed→expanded transition on card 2 → resync fires → reads
    `localStorage` (now `"true"`) → `previewOpen` for card 2 becomes `true`. This directly satisfies
    the spec scenario text ("opens the preview on one step card and later expands another step
    card ... THEN the preview auto-opens on the newly expanded card") — the exact case round 1
    found broken (mount-time-only lazy read) is now covered because the read is re-run at the
    moment that matters (expansion), not only at mount.
  - Task 3.4 ("render two StepCards, open preview on card 1, then expand card 2 — its preview
    auto-opens") is exactly the regression test that would have caught the round-1 defect (a
    mount-time-only lazy initializer would fail this test, since card 2 mounts before card 1's
    toggle). Confirmed this is a real, executable regression check, not a rubber-stamp.
  - "Hide" side of the scenario ("after the user hides the preview, subsequently expanded cards
    default to closed") is symmetric under the same mechanism — write-on-toggle + resync-on-expand
    — and is covered by Task 3.3.

- **Round-1 citation-accuracy item — corrected.** `theme.ts:55-71` re-read: `getInitialTheme` /
  `getInitialAccentColor` guard only `typeof window === "undefined"`, no try/catch — confirmed
  (still) accurate as ground truth. Design.md Decision 3 now says "the try/catch around storage
  access is our own hardening — `theme.ts` itself only guards `typeof window`" — this now matches
  ground truth exactly; the round-1 misattribution is fixed, not just reworded around.

- **Round-1 file-size item — added, not silently dropped.** `wc -l PipelineDetailPage.tsx` → 571
  lines (unchanged from round 1). `CONTRIBUTING.md:24` confirmed: "If a file you're editing crosses
  ~400 lines, propose a split in the PR description rather than adding to it." Design.md's Planner
  Notes now states this explicitly and directs the executor to record it in `files-modified.md` for
  the orchestrator to carry into the PR body; Task 3.5 duplicates this as an explicit checklist
  item. This is a real, actionable requirement now, not a dropped note.

- **Round-1 non-blocking item (activation vs. config-change ambiguity) — now specified.** Decision 2
  adds the `lastFetchedFingerprint` ref: `null` → fetch immediately (initial activation), non-null
  differing from current fingerprint → debounced re-fetch (config change), reset to `null` on
  deactivation (close or collapse). Cross-checked against `useStepCardState.ts:178-186`: `persist()`
  only calls `onConfigChange(step.id, newConfig)` inside the PATCH's `.then()` — so `step.config`
  (and therefore the `JSON.stringify(step.config)` fingerprint the effect watches) only changes
  after a PATCH actually resolves, confirming the "re-fetch only after PATCH settles" semantics the
  ref-based effect logic depends on are real, not assumed.

- **Fresh review of the revision on its own merits** (not just re-checking round-1 deltas):
  - `SchemaField { name: string; type: string }` (`pipelineStep.ts:304-307`) matches Decision 4's
    "name: type" chip plan exactly.
  - `PipelineDetailPage.css` already has a token-driven chip family
    (`.pipeline-detail-page__step-card-diff-chip*`, using `--app-accent-surface`, `--app-error`,
    `var(--font-mono)`, `var(--text-xs)`) and the `.pipeline-detail-page__step-preview*` block
    (using `--app-text-muted`, `--app-error`) that Decision 4/Task 2.5 propose extending — real,
    existing precedent, not invented.
  - Full AC trace: AC1 (rows+schema inline) → Decisions 1+4, Tasks 1.1/1.2/2.4. AC2 (debounced
    refresh) → Decision 2, Task 2.2. AC3 (loading/error reuse) → Decision 2 ("reuses existing
    loading/error states"), Task 3.1. AC4 (DESIGN.md + tests) → Decision 4 tokens, Tasks 2.4/2.5,
    3.1-3.4. AC5 (backward-compatible, no wire change) → Impact section, confirmed no backend diff
    proposed anywhere in the artifacts. All five ACs trace to a concrete task; no AC is left
    uncovered, no task is unmoored from an AC or the ticket's explicit persistence-preference scope
    line.
  - Fake-timer debounce testing (Task 3.1-3.4's approach) has real codebase precedent
    (`PanelGrid.test.tsx`, `usePanelPolling.test.ts` both use `jest.useFakeTimers()`), so this isn't
    a speculative test strategy.
  - No new placeholders, TBDs, or contradictions introduced by the revision. No scope drift — the
    revised Decision 2/3 mechanisms stay inside `StepCard.tsx`'s existing local-state model; no new
    shared state, context, or global store was introduced (the design explicitly considered and
    rejected that in favor of the smaller re-sync-on-expand fix, which is itself justified above).

### Verdict: CONFIRM

### Non-blocking notes

- Decision 3's re-sync-on-expand mechanism only observes a preference change made *after* a card's
  most recent expand (i.e., two already-expanded sibling cards do not live-sync to each other when
  the preference is toggled on a third, already-expanded card, without an intervening
  collapse→expand on the observing card). This is outside what the spec scenario actually requires
  ("opens ... and *later expands another*" implies the second card wasn't already expanded), so it
  is not a defect against the delta spec as written — flagging only so the executor doesn't
  over-scope into a live-sync mechanism the spec doesn't ask for.
