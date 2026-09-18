## Evaluation Report — Cycle 3 (evaluation-3.md)

CON-166 re-review (staleness resolution, not an ordinary executor loop). This cycle certifies the CURRENT HEAD source state (`5b8ba7d9bdca7dc0dc6b84b456b56bb5ce7f7f9b`) — the tree post-squash (`0e2b0194`, tree-identical to `39c58058` minus the executor's `files-modified.md`) plus the openspec-archive commit (`5b8ba7d9`) — including the final-gate round-1 fix (`FormFieldRow.tsx`, `FormFieldRow.test.tsx`, `FormField.tsx`, `Select.tsx`) that evaluation-2.md's `d1fc4fc1` certification predates and that only the skeptic (`skeptic-final-2.md`, CONFIRM) had previously reviewed.

Diff base resolved fresh: `ab4cad578d05576beb3a19ef7244799db6953172` (`resolve-review-base.sh main origin`). Reviewed `git diff ab4cad57...HEAD` in full; used `git diff d1fc4fc1...HEAD` to isolate what changed since evaluation-2.md's certified commit.

### Housekeeping

`openspec/changes/form-field-type-builder/auditor-report.md` is an **untracked** scratch file left by the auditor (`git ls-tree -r HEAD` confirms nothing under that path is committed). It is not mine to delete (another agent's artifact, and the requesting message says the orchestrator will handle the archive commit), but it does pollute `check:openspec` (see Phase 2) — noted there rather than silently worked around.

### Phase 1: Spec Review — PASS

- No AC/spec surface changed since evaluation-2.md; the only source delta (`git diff d1fc4fc1...HEAD --stat`) is the final-gate round-1 accessibility fix plus its test and the two shared-component files, exactly as described by the requesting message and corroborated by `skeptic-final-2.md`.
- C8 (the standing constraint this fix exists to satisfy — "error-to-control association asserted by computed ARIA state, never `role=\"alert\"` presence alone") is present in the archived `tasks.md`/`workflow-state.md` and is honored by the diff.
- Archive move itself: `git diff --name-only 39c58058 5b8ba7d9 -- . ':!openspec'` is empty (independently re-confirmed) — the archive commit touched only `openspec/**`, no source. Planning artifacts at `openspec/changes/archive/2026-09-17-form-field-type-builder/` accurately reflect the final implemented behavior (evaluation-1.md and evaluation-2.md are present and match what was actually reviewed at each stage; `skeptic-final-1.md`/`skeptic-final-2.md` document the round-1 defect and its fix).

### Phase 2: Code Review — PASS

**Shared-component behavior-identity check (the specific ask):** `FormField.tsx` gains `errorId?: string` (defaults to an internally generated `useId()` when omitted — every pre-existing caller that doesn't pass it gets the exact same generated-id-on-the-error-`<p>` behavior as before); `Select.tsx` gains `ariaInvalid?: boolean`/`ariaDescribedBy?: string`, both `undefined` by default, which resolves to `aria-invalid={undefined ? "true" : undefined}` → attribute omitted, and `aria-describedby={undefined}` → attribute omitted — i.e. the DOM output for any caller that doesn't pass these props is byte-for-byte unchanged. Counted 6 other `<FormField` call sites and ~30 other `<Select` call sites/importers in `frontend/src` outside this ticket's own files; none pass the new props (spot-checked; the diff itself proves this mechanically since the props are additive-only with no default-changing side effect). `FormFieldRow.tsx` is the only caller that threads `errorId`/`ariaInvalid`/`ariaDescribedBy`, via a `useId()`-generated `sourceFieldErrorId` shared between `FormField`'s `errorId` and `Select`'s `ariaDescribedBy`.

Gates re-run fresh at `5b8ba7d9` (per the request, backend included despite backend source being unchanged since cycle 1):
- `npm run lint` — clean.
- `npm run format:check` — clean.
- `npm run typecheck` — clean.
- `npm test` (root, incl. helio-mcp) — 28 suites / 271 tests passed; `npm --prefix frontend test` — 327 suites / **3527** tests passed (2 more than cycle 2's 3525 — the new C8 positive/negative `FormFieldRow.test.tsx` cases).
- `npm --prefix frontend run build` — succeeds.
- `npm run check:schemas` — in sync.
- `npm run check:openspec` — **fails as run** ("change \"form-field-type-builder\" has no tasks") solely because of the untracked `auditor-report.md` noted above; re-ran with that directory temporarily moved aside (`mv .../form-field-type-builder /tmp/... && npm run check:openspec && mv back`, restored byte-identical, confirmed via `ls`) and it passes cleanly ("openspec/ is clean") against the actual committed tree. Recording this explicitly rather than silently treating the gate as green: the failure is real against the working tree as I found it, but not against HEAD's committed source, which is what this role certifies.
- `npm run check:scala-quality` — clean (175 pre-existing soft warnings, none new).
- `cd backend && sbt test` — **4630/4630 passed**, fresh full run at this exact HEAD (backend source unchanged since cycle 1's already-green run, but re-run in full per this cycle's explicit instruction rather than trusted from a prior cycle).

Mutation evidence for the round-1 fix (`mutation-evidence.md`, `skeptic-final-1.md`/`skeptic-final-2.md`): `ariaInvalid={Boolean(error)}` mutated to `ariaInvalid={false}` produces an isolated RED on the new C8 assertion; restored, 10/10 green. This is the same evidence the skeptic already validated; re-read in full and found consistent with the diff.

### Phase 3: UI Review — PASS

Re-verified live on this run's ports (6516/9423); confirmed both the reused Vite dev server (PID 1779583) and backend (PID 1779198) still resolve via `readlink /proc/<pid>/cwd` to this worktree. Did a hard `location.reload()` before testing (bypasses any HMR staleness — none observed this cycle).

**C8, measured live, not from the test suite or the skeptic's report:** opened the "Skeptic Form" panel's editor, switched its bound dataset to one that doesn't declare the existing "Note" field (forcing `computeFormIssues`'s "not declared" error onto the sourceField row). `browser_evaluate` against the live DOM on the sourceField `Select` trigger:
```
{ invalid: "true", describedBy: "_r_g_", descText: "'note' is not declared by the bound dataset", descRole: "alert" }
```
`aria-invalid="true"` and `aria-describedby` resolve to a real DOM element whose text is the exact, current error message — the computed ARIA state genuinely carries the association, not merely a co-located `role="alert"` paragraph. Matches C8's requirement and independently reproduces the skeptic's own live measurement (skeptic used a `Step`-validation error on a different field; this run used a dataset-switch orphan error — same underlying wiring, different trigger, same result).

Cancelled the edit afterward; reopening the panel confirmed the persisted config was not mutated by this test interaction (view mode still shows the D10 placeholder, no orphan state leaked into the saved panel).

No console errors/warnings through the full interaction (fresh `browser_console_messages` check, 0/0/0). `location.href` re-checked as `http://localhost:6516/` throughout — no cross-worktree contamination.

Per the request's explicit callout, no further re-drive of the picker/keyboard-reorder/theme/breakpoint flows this cycle — none of those code paths are touched by the `d1fc4fc1...HEAD` diff (confirmed via the stat above: only `FormField.tsx`, `Select.tsx`, `FormFieldRow.tsx`/`.test.tsx`, and planning artifacts changed), and cycle 2 already re-verified them live with no regression on a diff that similarly left them untouched.

### Overall: PASS

No change requests. The evaluator role now certifies current HEAD (`5b8ba7d9bdca7dc0dc6b84b456b56bb5ce7f7f9b`), resolving the auditor's STALE finding.

### Non-blocking Suggestions

- `check:openspec` is sensitive to stray untracked directories under `openspec/changes/` (the auditor's own scratch file tripped it here). Not a code defect — the gate is doing its job (flagging an incomplete-looking change directory) — but worth the orchestrator cleaning up `openspec/changes/form-field-type-builder/auditor-report.md` (or relocating auditor scratch output outside `openspec/changes/`) before any later hygiene check runs against a dirty working tree.
- (Carried, non-blocking, from skeptic-final-2.md) `computeFormIssues` attaches every issue type to the sourceField row rather than the specific offending sub-control (e.g. a "Step must be positive" error still visually/programmatically associates with the sourceField chooser, not the Step field). Pre-existing architecture, out of scope for HEL-1084; worth a follow-up ticket if a future a11y pass wants per-control error placement.
