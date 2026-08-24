# Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of `65eeea69` on `task/backend-frontend-readme-sweep/hel-637`.
All conclusions below are derived from commands I ran myself in the worktree;
the executor's and evaluator's reports were read only as claims.

## What I verified (with evidence)

### Scope discipline (ticket "Documentation only. No code, no moves.")

- `git diff main...HEAD --stat`: 39 files, 840 insertions / 4 deletions.
- `git diff main...HEAD --name-only | grep -v '\.md$'` → only
  `openspec/changes/readme-convention-sweep/.openspec.yaml`. Every other changed
  file is a `README.md` or a planning artifact under
  `openspec/changes/readme-convention-sweep/`. **Genuinely docs-only. Confirmed.**
- Scope item 5 (untouched dirs): `git diff main...HEAD --name-only` filtered on
  `frontend/src/(app|config|context|store|test|theme|types)/` → empty.
  **Confirmed untouched.**

### 1. Backend package gaps

- All 6 named gaps have a README: `email`, `spark`, `ai`, `domain/panels`,
  `domain/shapes`, `domain/steps`.
- Independent completeness sweep — `find backend/src/main/scala/com/helio -type d`,
  for each dir containing `*.scala` assert `README.md` exists → **zero gaps
  remaining** across the whole backend tree.
- Content checked against real `ls` (my own sample, not the executor's):
  - `domain/steps`: I diffed the 23 backtick-quoted `*Step` names in the README
    against `basename`s of `*Step.scala` → **exact match, no extras, no omissions.**
    `StepCodecUtil.scala` claim also holds.
  - `spark`: claims `SparkJobSubmitter`, `PipelineRunCache` — `ls` shows exactly
    those two files. Accurate.
  - `email`: claims `EmailConfig`, `EmailSender`, `HttpResendEmailSender` — `ls`
    shows exactly those three. Accurate.
  - `domain/panels`: 9 panel types + `PanelBindingSpec` + `PanelConfigCodec` all
    present in `ls` (undocumented `package.scala` is a namespace file, fine).
  - `domain/shapes`: every named file present in `ls`; no invented names.
  - `ai`: every named file present. `ClaudeModels.scala` exists but is unlisted —
    the convention explicitly prefers non-exhaustive lists, so not a defect.

### 2. Frontend features

- `ls frontend/src/features/` → 14 feature dirs; `ls features/*/README.md | wc -l`
  → **14**. Complete.
- `features/README.md` index rewritten: it now enumerates all 14 feature dirs
  (I compared its list against `ls` — exact match) and drops the aspirational
  phrasing, correctly hedging the slice convention with "not every feature has
  all of them".
- Sampled three features I picked myself (`patchSets`, `metrics`, `toasts`) and
  checked every claim against `ls -R`:
  - `patchSets`: all named files exist. Its cross-reference claim —
    `RefinementChatDrawer` lives in `dashboards` — verified:
    `frontend/src/features/dashboards/ui/RefinementChatDrawer.tsx` exists.
  - `metrics`: all 7 named UI components exist in `ui/`.
  - `toasts`: `state/toastsSlice.ts`, `state/toastListeners.ts`,
    `hooks/useToast.ts` all exist; its claim that the toast's rendering is a
    shared primitive verified — `frontend/src/shared/ui/Toast.tsx` exists.

### 3. `hooks/` `utils/` `services/` `shared/`

- `shared/README.md` covers both subdirs as required. Its structural claim
  "No `features/*/shared` exists" verified: `ls -d features/*/shared` → none.
  All components it names exist under `chrome/` and `ui/` respectively.
- `services/README.md` "infrastructure every feature's API client builds on"
  verified by real usage, not by name: `grep -rl "services/httpClient"` shows
  consumers in **11 different features**. Its pointers to
  `features/dashboards/services` and `features/sources/services` — both dirs
  exist.
- `hooks/README.md` largely holds: `usePortalPopover` is used by `auth`,
  `dashboards`, `metrics` + two shared components; `reduxHooks` is ubiquitous.
  Both sibling dirs it names (`features/dashboards/hooks`,
  `features/panels/hooks`) exist.
- **`utils/README.md` does not hold — see Change Request 1.**

### 4. Top-level dirs

- `scripts/`, `e2e/`, `docs/` each have a README; every file/subdir each names
  was confirmed present by `ls`. `e2e`'s naming claim (one spec per scenario,
  named after the ticket) matches the actual 7 spec filenames.
- `schemas/`: `find schemas -name "README*"` → **exactly one file**,
  `schemas/README.md`. It documents both purpose and the domain grouping, and
  states *why* one README rather than 14 stubs. I diffed its list of 14 domain
  subdirs against `ls schemas` → **exact match**, all 14, no invented dirs.

### 6. No stale references

- `grep -rn -E "com/helio/security|com\.helio\.security|testutil" --include=README.md .`
  → **no matches.** Confirmed.

### Gates (re-run by me, not trusted from the evaluator)

- `npx prettier --check "**/*.md"` → `All matched files use Prettier code style!`
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`
- `node scripts/check-repo-integrity.mjs` → clean (no output)
- Lint/typecheck are not meaningfully implicated: the diff contains zero
  `.ts`/`.tsx`/`.scala` files.
- Per the brief, `openspec validate`'s "Change must have at least one delta" is
  expected for a change with no capability delta — not treated as a defect.

## Verdict: REFUTE

One stable, reproduced factual inaccuracy, in exactly the category this ticket
exists to prevent: a README asserting a property of its contents that was
inferred rather than verified against real usage. Everything else in the sweep
is accurate and, on my own independent sampling, unusually well grounded.

I re-ran the usage query twice with two different grep formulations before
concluding; the result was identical both times.

## Change Requests

1. **`frontend/src/utils/README.md` — the "cross-feature" claim is false for
   3 of its 4 files.** The README opens:

   > Cross-feature pure-function helpers: `aggregate.ts`, `chartAppearance.ts`,
   > `chartTypeOptions.ts`, `formatRelativeTime.ts`.

   and then states **Does not belong here:** "a helper only one feature needs —
   put it in that feature's own `utils/`". Actual consumers (grep across
   `frontend/src`, excluding `utils/` itself):

   - `aggregate.ts` → `features/panels` only (5 files)
   - `chartAppearance.ts` → `features/panels` only (7 files)
   - `chartTypeOptions.ts` → `features/panels` only (1 file, `ChartPanel.tsx`)
   - `formatRelativeTime.ts` → `features/panels` **and** `features/pipelines`
     (genuinely cross-feature)

   So the directory's own stated rule is contradicted by 3 of the 4 files it
   lists, and the ticket's requirement that these four top-level READMEs be
   "resolved from how the code actually uses them (not from the names)" is not
   met for `utils/`. This was written from the directory's name/intent, which is
   the precise failure mode the ticket names.

   Fix, documentation-only (do **not** move the files — moves are out of scope):
   rewrite the opening sentence so it describes the contents truthfully, and
   keep the normative rule separate from the description of what is currently
   there. E.g. describe the dir as holding stateless helpers, note that
   `aggregate.ts`/`chartAppearance.ts`/`chartTypeOptions.ts` are chart helpers
   currently consumed only by `features/panels` (a known drift from the rule,
   relocation out of scope here), and that `formatRelativeTime.ts` is the
   genuinely cross-feature one. Re-verify by grep before rewriting.

## Non-blocking notes

- `frontend/src/hooks/README.md` says "hooks used by more than one feature";
  `useRelativeTime.ts` is consumed by exactly one call site,
  `shared/chrome/SaveStateIndicator.tsx` — zero features directly. Being
  consumed by a shared component is arguably cross-feature by construction, so
  I do not consider this a defect, but it is the same class of claim as CR1 and
  is worth a glance while fixing `utils/`.
- `frontend/src/shared/README.md` describes `chrome/` and `ui/` as
  "components"; `chrome/` also contains non-component modules
  (`navDestinations.ts`, `sections.ts`, `usePickerSelection.ts`). Minor.
- `backend/.../ai/README.md` omits `ClaudeModels.scala` from its list. The
  convention prefers non-exhaustive lists, so this is fine as-is.
- `scripts/concertino/next-report-number.sh` does not exist in this worktree
  (the branch base predates it); I ran the copy from the main checkout against
  this change dir. Not a defect in this change.
