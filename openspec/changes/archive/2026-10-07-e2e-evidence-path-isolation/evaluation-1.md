## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 0f695ad3d427572f681a444d0c716aac87486801. Base (live, resolve-review-base.sh): 33dcf8fd22fe21f4823697aec101033e7f637c30.

### Phase 1: Spec Review — FAIL

Issues:

1. **Restated-ticket AC was narrowed without saying so: the guard is scoped to `openspec/changes`, but the ticket says `openspec/`.**
   The restated Linear ticket (ticket.md, "Restated ticket") says: "Add a guard that stops a spec from writing
   under `openspec/` again, and prove it with a red run." AC1, design D3, and the spec delta
   (`specs/e2e-evidence-path-guard/spec.md`, "Guard against reintroducing ad-hoc evidence paths") all scope it to
   `openspec/changes` instead. ticket.md says "The acceptance criteria above already cover this restated scope".
   They don't cover all of it:
   - Rule (b) (screenshot `path` must be `evidencePath(...)`) fails closed for **screenshot** writes anywhere, and
     `evidencePath` rejects separators and `..`. That part is sound.
   - Rule (a) only matches the literal substring `openspec/changes` (`scripts/check-e2e-evidence-paths.mjs:93`).
     Any other write under `openspec/` passes. I ran the guard against fixture trees and recorded exit codes:
     - `writeFileSync(resolve(__dirname, "../openspec/specs/foo/a.png"), buf)`: exit 0
     - `mkdirSync(resolve(__dirname, "../openspec/specs/foo/screenshots"), { recursive: true })`: exit 0
     - `const d = join(__dirname, "..", "openspec", "changes", "x"); mkdirSync(d);`: **exit 0**. This is the
       incident's own shape (hel1350's `mkdirSync(SHOTS)` created the ghost change dir before any screenshot
       was taken), just written as path segments.
     - `page.pdf({ path: "../openspec/x.pdf" })`, `download.saveAs("openspec/foo/a.csv")`,
       `recordVideo: { dir: "openspec/vids" }`: exit 0
     - For comparison, `screenshot({ path: resolve(__dirname, "../openspec/specs/x/a.png") })` and
       `writeFileSync("openspec/changes/x/a.png", buf)` both exit 1.
   - Today no e2e `.ts/.mts/.js/.mjs` file references `openspec` outside a comment (`git grep -n openspec -- e2e`
     hits only `e2e/README.md`, which the guard does not scan). Widening the rule therefore costs no false
     positives.

Other checks:
- AC1 (no spec writes to openspec/changes or a cwd-relative path; one cwd-independent gitignored location): PASS
  for all 10 migrated specs. `git grep` finds no remaining `.concertino/runs`, `mkdirSync`, `writeFileSync`,
  `saveAs`, `.pdf(`, or `recordVideo` sites in e2e outside the helper.
- AC2 (pre-commit + CI guard with red selftest): wired in `package.json`, `.husky/pre-commit`, and
  `.github/workflows/ci.yml`. Red is proven for the base tree (guard-base-red.txt, 29 violations) and by a
  rule (b) mutation (mutation-2.2.txt). It does not yet cover the `openspec/` scope (issue 1).
- AC3 (check:openspec gitignored-only exemption): PASS. Verified live: a ghost
  `openspec/changes/zz-eval-ghost/screenshots/a.png` gave exit 0 and the stderr notice. Adding a committable
  `notes.md` to the same dir brought back `change "zz-eval-ghost" has no tasks`. The exact files were removed
  afterward. The mutation proof is in mutation-3.2.txt. The no-git case fails closed (selftest).
- AC4 (helper probe leaves git status clean and nothing under openspec/changes): PASS. I re-ran it myself: I
  transpiled `e2e/support/evidencePath.ts` in place (`__dirname` kept) and ran it with cwd `/`. It resolved to
  `<worktree>/e2e-evidence/HEL-9999/eval-probe.png`, `git status --porcelain` was empty, `openspec/changes`
  was unchanged, and `../a.png`, `../HEL-1`, `..`, and the ticket `openspec` all threw. I removed the exact
  probe file and dirs afterward.
- Tasks all checked and consistent with the diff. Scope is clean: the 10 spec hunks touch only import, path,
  mkdir, and header-comment lines. CONSTRAINTS: `[]`.

### Phase 2: Code Review — PASS

Gates were run fresh in WORKTREE_PATH. No `frontend/**` or `backend/**` files changed, so npm test, the
frontend build, and sbt are not triggered. I ran the gates relevant to the changed files:
- `check:e2e-evidence-paths`: exit 0 (60 files)
- `check:e2e-evidence-paths:selftest`: 12/12
- `check:openspec`: exit 0
- `check:openspec:selftest`: 21/21
- `check:e2e-types`: exit 0
- `format:check`: exit 0
- `lint`: exit 0

The code is well-scoped and readable. The helper is small and validated, and it resolves from its own location.
The guard's comment stripping skips strings, its paren matching is balanced, and indirection fails closed. The
D5 exemption fails closed and runs through the existing hermetic `runGit`. No CONTRIBUTING [mechanical]
violations found. DESIGN.md is not applicable.

### Phase 3: UI Review — N/A

No UI-affecting files changed (`frontend/**`, ApiRoutes, `schemas/**`, `openspec/specs/**` untouched). The
driver directed no browser use. AC4 was covered by the helper probe above instead of a live e2e run.

### Overall: FAIL

### Change Requests

1. `scripts/check-e2e-evidence-paths.mjs:93` (rule (a)): widen it from the literal `openspec/changes` to any
   non-comment reference to the `openspec` tree in e2e source. On the comment-stripped text, match both
   - `openspec/` (substring), and
   - a standalone quoted path segment `"openspec"`, `'openspec'`, or `` `openspec` `` (e.g. `/(["'`])openspec\1/`).

   Keep the reviewed escape hatch. Update the violation message, the header comment (lines 5-8), and the final
   remediation text to say `openspec/`. No current e2e source trips this (verified above).
2. `scripts/check-e2e-evidence-paths.selftest.mjs`: add red cases with exact expected lines:
   - (a) `mkdirSync(resolve(__dirname, "../openspec/specs/foo/screenshots"), { recursive: true });`
   - (b) `writeFileSync(resolve(__dirname, "../openspec/specs/foo/a.png"), buf);`
   - (c) `const d = join(__dirname, "..", "openspec", "changes", "x");`

   Add a green case where `openspec` appears only in a comment alongside a non-path word containing it (if any
   such case is plausible), or keep the existing comment-only green case. Then show the new cases red by mutating
   rule (a) back to `/openspec\/changes/g`. Record the result in a `mutation-*.txt` next to the existing ones and
   restore the rule.
3. Bring the planning artifacts in line with the restated ticket:
   - ticket.md AC1/AC2: state that no e2e source may reference a path under `openspec/` (not only
     `openspec/changes/**`), and drop "already cover this restated scope" or make it true.
   - design.md D3 rule (a): same change.
   - `specs/e2e-evidence-path-guard/spec.md`: change the guard requirement's "references `openspec/changes`" to
     the `openspec/` tree, and add a scenario for a non-screenshot write such as
     `mkdirSync(join(__dirname, "..", "openspec", "changes", "x"))`.

### Non-blocking Suggestions

- `scripts/check-e2e-evidence-paths.mjs:177` uses the raw `` import.meta.url === `file://${process.argv[1]}` ``
  entry guard. As `scripts/check-no-credential-in-agent-surface.mjs:973-995` documents, this pattern is
  fail-open: a path with a percent-encodable character or a symlinked invocation means `main()` never runs and
  the process exits 0. The paired selftest would catch it, because its red cases spawn the guard the same way,
  so this is not blocking. The realpath and `pathToFileURL` form from that file would make the guard robust on
  its own.
- Rule (b) only inspects `.screenshot(`. If you want "evidence writes" to mean all file-producing Playwright
  APIs, consider also requiring `evidencePath(` for `page.pdf({ path })` and `download.saveAs(...)`. None exist
  in e2e today. CR1's `openspec` rule already closes the openspec-specific gap.
