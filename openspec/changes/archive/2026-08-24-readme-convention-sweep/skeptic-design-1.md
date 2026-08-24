## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Worktree HEAD confirmed `7cfb1e84` (`git rev-parse HEAD`). All checks re-derived from the live tree, not from the plan's prose.

**Backend enumeration — CORRECT.** `find backend/src/main/scala -type d` = 79 dirs, of which 3 are pure namespace (`.`, `com`, `com/helio`) → 76 package dirs; `find ... -name README.md` = 67. The 9 dirs without a README are exactly the 3 namespace dirs plus **6 real gaps**: `com/helio/ai` (10 .scala), `domain/panels` (12), `domain/steps` (24), `domain/shapes` (9), `email` (3), `spark` (2). Matches proposal.md and design.md D4 exactly. D4's exclusion of the namespace dirs is sound — they hold 0 `.scala` files each.

**Frontend features — CORRECT.** `ls -d frontend/src/features/*/` = **14** dirs (assistant, auth, dashboards, dataTypes, layout, metrics, onboarding, panels, patchSets, pipelines, proposals, settings, sources, toasts). `find frontend/src/features -maxdepth 2 -name README.md` returns **only** `features/README.md` — zero per-feature READMEs today, so all 14 are genuine gaps.

**Frontend shared dirs — CORRECT.** `shared`, `hooks`, `utils`, `services` all exist under `frontend/src/` and all four lack a README.

**Top-level — CORRECT.** `scripts/`, `schemas/`, `e2e/`, `docs/` all lack a README; `infra/README.md` exists (so "no action" on `infra/` is right).

**schemas/ subdirs — CORRECT.** `ls -d schemas/*/` = **14** (agent-memory, alerts, assistant, auth, authoring, dashboards, data-types, hooks, metrics, panels, patch-sets, pipelines, shared, workspace), zero loose files at `schemas/` root.

**Removed-path claim — CORRECT.** `grep -rl -e 'com/helio/security' -e 'com\.helio\.security' -e 'testutil' --include=README.md .` returns nothing, confirming ticket.md line 41 / task 5.1's expectation.

**Spec-delta absence (D5)** — consistent with the stated precedent; `openspec/changes/archive/2026-08-24-group-schemas-by-domain` exists as a docs-only sibling in the same epic.

**Decision 1 (one `schemas/README.md`) — JUSTIFIED.** The 14 subdirs contain only JSON Schema files with no per-dir structural convention to explain; 14 four-line stubs differing only in a domain noun would carry no information the grouping README doesn't. This is a correct application of the ticket's own "four lines beats forty". Reasoning is stated explicitly and the decision is cheaply reversible.

**Decision 3 (resolve shared-dir distinctions from usage) — executable, with one factual flaw (see CR2).** Task 3.1 gives a concrete procedure (`ls` + `grep` consumers) and the ground truth supports a real answer existing: `frontend/src/hooks` (4 files), `utils` (6), `services` (6, HTTP client + error classification) all have genuine feature-local counterparts (`features/*/hooks|utils|services` exist across dashboards, sources, auth, etc.), so the distinction is derivable rather than invented. Deferring the *wording* to execution is acceptable; the *category* is not left ambiguous.

**Task procedure vs. the failure mode (question 4) — adequate.** Every write task (1.1, 2.1, 3.1, 4.1) is phrased `ls` → read names → *then* write, task 2.1 explicitly forbids a generic copy-paste across the 14, and 5.2/5.3 add a random spot-check and a count. That is about as much procedure as a prose-discipline ticket can carry.

### Verdict: REFUTE

Three specific, cheap defects — all in scope-completeness, not approach. The enumeration and both headline decisions (D1, D3) hold up; D2 rests on a claim that is false against the live file.

### Change Requests

1. **design.md D2 (lines 36–40) asserts something ground truth contradicts, and no task fixes it.** D2 says the existing index "already explains the top-level list of features" and is kept with an "unmodified relationship". The actual file `frontend/src/features/README.md` reads:

   ```
   # Feature Modules

   Feature-first structure for domain areas, including:

   - `dashboards`
   - `panels`

   Each feature should own UI, state adapters, selectors, and tests.
   ```

   It lists **2 of 14** features and describes the slice convention aspirationally ("should own"), i.e. it is a stale README that no longer matches its directory — precisely what ticket.md line 41 mandates fixing and what line 15 forbids ("Never write a README describing what a directory is intended to hold"). Leaving it untouched in the completeness sweep that closes the epic is the one outcome the ticket exists to prevent. Revise D2 to keep the index *and* correct it, and add a task under §2 to rewrite `frontend/src/features/README.md` against the real 14-dir listing. Also correct ticket.md line 41's "verified: none currently reference removed paths, so no fix/delete action is expected here" — a fix action *is* expected, just not a removed-path one.

2. **The `shared` entry in the scope is described by a distinction that does not exist, and its two code-bearing subdirs are unenumerated.** proposal.md line 14–15 and design.md D3 frame all four dirs as "clarifying its distinction from a feature-local equivalent **of the same name**". True for `hooks`/`utils`/`services`; false for `shared` — there is no `features/*/shared` anywhere in the tree. `frontend/src/shared` contains no files of its own, only `chrome/` and `ui/` (both full of components, e.g. `AccentPicker.tsx`, `ConfirmInline.tsx`), and neither subdir has a README. Either (a) reframe `shared`'s "does not belong here" line against `features/*/ui` (its real counterpart) and make an explicit D1-style decision on whether `shared/chrome` and `shared/ui` get their own READMEs or are covered by one `shared/README.md`, or (b) state the exclusion and why. Right now the plan neither covers them nor excludes them.

3. **`frontend/src`'s other seven directories are silently out of scope.** `app/`, `config/`, `context/`, `store/`, `test/`, `theme/`, `types/` all exist and none has a README, yet nothing in proposal.md/design.md mentions them. D4 does exactly the right thing for the backend namespace dirs — states the exclusion and the reason. Do the same here: add a Non-Goal naming these seven and why they're deferred (inherited ticket enumeration), so the PR's "sweep complete, N/N directories" claim (task 5.3) is not overstated.

### Non-blocking notes

- Task 5.3's count should be stated as a scoped denominator ("all 6 backend gaps closed → 73/76 package dirs; 3 namespace dirs excluded by D4"), not a bare total, for the same overstatement reason as CR3.
- `backend/src/main/scala/com/helio/infrastructure/README.md` exists on a dir with 0 `.scala` files of its own — a useful precedent that a parent-of-subpackages README *can* be worth writing, worth weighing when resolving CR2's `shared/` question.
- `scripts/concertino/next-report-number.sh` is absent from this worktree's `scripts/concertino/` (present in the main checkout); I ran the main-repo copy against the worktree path. Not blocking, but the executor/evaluator may hit the same gap.
