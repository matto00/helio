## Evaluation Report — Cycle 3, scoped delta re-evaluation (evaluation-5.md)

Reviewed HEAD: `052627ef64400aa8be4c80001eecfd94fcabf170`. Diff base resolved live: `0d8bd55cf`.
Scope: the delta `671dbc419..052627ef6` only. evaluation-4.md (PASS at `0a07c6e70`) and
skeptic-final-3.md (CONFIRM at `671dbc419`) cover the rest of the change. The delta touches three files.
`frontend/src/features/panels/ui/grid/PanelGrid.css.test.ts` gets +6/-3. The archived `design.md` gets a
20-line checklist. The new `skeptic-final-3.md` is a report. No production source, CSS, script or
`.husky/**` file changed in the delta.

### Phase 1: Spec Review — PASS
Issues: none blocking.
- The test-file change is in scope. It fixes CodeQL `js/incomplete-sanitization`, which failed CI on PR #1050.
  The assertion it guards does not change.
- The Gate-Chain Implications Checklist matches the real `scripts/check-tokens.mjs` change. The branch adds 5
  `ALLOWLIST` entries (`--motion-index`, `--indicator-x/y/w/h`, `scripts/check-tokens.mjs:106-110`). That
  is the whole diff to the script, and no `.husky/**` file changes (`git diff --name-only 0d8bd55cf...HEAD --
  .husky scripts` lists only `scripts/check-tokens.mjs`). I checked each answer against the source:
  - Execution: read-only Node, `readFileSync`/`readdirSync` only, with no `child_process`, `writeFile` or git
    call (`grep` over the script). Accurate.
  - Environment: `repoRoot` is resolved from `import.meta.url` (`check-tokens.mjs:163`), so the script never
    reads the inherited `GIT_DIR`. Accurate. (`process.cwd()` is used only when an argv path is passed, and
    `.husky/pre-commit` / `ci.yml:79` pass none.)
  - Writes: none, stdout/stderr only. Accurate.
  - Linked worktree vs main checkout: accurate. The persisted isolation transcript is at
    `/home/matt/Development/helio/.concertino/runs/HEL-1573/evidence/.concertino/gate-chain-isolation-evidence/scripts__check-tokens.mjs.md`.
    It shows exit 0, an unchanged fixture `.git`, an unchanged real-repo tripwire, and verdict PASS.
  - First run: accurate. An unlisted property still fails. I re-ran `check:tokens` (OK) and
    `check:tokens:selftest` (10/10).
  - Two factual slips, both non-blocking (see Suggestions). "scans frontend CSS/TSX text" is wrong: `allCssFiles`
    collects `.css` only (`check-tokens.mjs:154-155`). "verified by the isolation test below" is a dangling
    reference: no such test appears in `design.md`, and the evidence lives only at the persisted path above.

### Phase 2: Code Review — PASS
Gates, run fresh by me at HEAD `052627ef6` in `WORKTREE_PATH` (load average was below 2 throughout):
- `npm run lint` passed, exit 0 (zero warnings).
- `npm run typecheck` passed, exit 0.
- `npm run format:check` passed: "All matched files use Prettier code style!"
- `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npm test` passed, exit 0. Root: 61 suites / 524 tests. Frontend: 673 suites /
  7932 tests.
- Logs are in `/home/matt/Development/helio/.concertino/scratch/HEL-1573/eval5-{lint,tc,fmt,jest}.txt`.

Escape completeness:
- `escapeRegExp` (`PanelGrid.css.test.ts:16-18`) uses the standard full class `[.*+?^${}()|[\]\\]`, which includes
  the backslash. The old inline `.replace(/[.>]/g, ...)` escaped only `.` and `>`.
- My probe sends every regex metacharacter, plus `/`, `-`, `>` and space, through the helper and gets a literal
  round-trip match (`true`). Under the old escape, `a\(b` does not match itself literally (`false`), which is the
  defect CodeQL flagged.

Discrimination:
- The executor's evidence is consistent. `mutated-red.txt` shows the placeholder-resizing rule emptied and the
  assertion failing on exactly that selector. `restored-green.txt` shows 5/5 passing. The `PanelGrid.css.orig`
  backup is byte-identical to the current `PanelGrid.css`, so the restore was clean.
- I reproduced it without touching the worktree, using a scratch Node probe that applies the test's exact
  `escapeRegExp` and assertion regex to in-memory mutants of the real `PanelGrid.css`:
  - Original: `[true,true,true]`.
  - Drop `transition: none` from placeholder-resizing: `[true,true,false]` (red).
  - Drop it from the dragging/resizing rule: `[false,false,true]` (red).
  - Replace a selector `.` with `X`: `[true,true,false]` (red). This proves the dot is now matched literally,
    not as a wildcard.
- Evidence: `/home/matt/Development/helio/.concertino/scratch/HEL-1573/eval5-mutation-probe.{mjs,txt}`.

Other checks:
- The two JSDoc blocks are each attached to their own function (`052627ef6`). No dead code.

CI on PR #1050 at head `052627ef6` (`headRefOid` matches):
- CodeQL passes, as do `Analyze (javascript-typescript)`, `Analyze (actions)`, `Analyze (java-kotlin)`,
  `Analyze (python)` and `security`.
- The code-scanning API reports 0 open alerts for `refs/pull/1050/head`.
- When I checked, backend (0-3), e2e (1-4), frontend and docker-image were still pending. This is recorded only;
  per the brief it does not block.

### Phase 3: UI Review — N/A
The delta changes no runtime UI. The only `frontend/**` change is a test file, and the gate behavior it
asserts is unchanged and still discriminates (Phase 2). The full UI review is in evaluation-4.md, and nothing
in this delta gives a reason to repeat it.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `design.md` Gate-Chain checklist, first bullet: "scans frontend CSS/TSX text" should read "scans frontend
  `.css` files" (`check-tokens.mjs:154-155` collects `.css` only).
- `design.md` Gate-Chain checklist, fourth bullet: "verified by the isolation test below" points at nothing in
  the document. Cite the persisted transcript instead:
  `.concertino/runs/HEL-1573/evidence/.concertino/gate-chain-isolation-evidence/scripts__check-tokens.mjs.md`.
- `PanelGrid.css.test.ts:22`: `rule()` still has its own inline escape class, which is complete, so this is
  not a CodeQL issue. It could be written as `escapeRegExp(selector).replace(/\s+/g, "\\s+")` to remove the
  duplication. `>` is not a regex metacharacter, so dropping it from the class changes nothing.

### Throwaway data created
- `/home/matt/Development/helio/.concertino/scratch/HEL-1573/eval5-{lint,tc,fmt,jest}.txt`
- `/home/matt/Development/helio/.concertino/scratch/HEL-1573/eval5-mutation-probe.{mjs,txt}`
- No servers were started, no worktree was created, and no DB rows were written.
