## Context

See proposal.md (Why) and ticket.md (premise validation). Current writers, verified by `git grep`:

- `e2e/hel1275`, `hel1277`, `hel1350`, `hel1351`: `const SHOTS = resolve(__dirname, "../openspec/changes/...")`
  then `mkdirSync(SHOTS)` + `screenshot({ path: resolve(SHOTS, ...) })`. `__dirname` is the running worktree's
  `e2e/`, so the write stays in that worktree; the defect is the target (a change dir that gets archived).
- `e2e/hel588`, `hel1085`, `hel1087`, `hel1088`, `hel1095`, `hel1169`: `screenshot({ path: ".concertino/runs/..." })`
  — resolved against Playwright's process cwd.
- `scripts/check-openspec-hygiene.mjs:235` errors on any `openspec list --json` entry with `status: "no-tasks"`;
  `openspec list` lists any directory under `openspec/changes/`, including one holding only `screenshots/*.png`.
- Pattern to follow for the guard: `scripts/check-test-temp-dir-hygiene.mjs` (+ `.selftest.mjs`), wired in
  `package.json`, `.husky/pre-commit`, and `.github/workflows/ci.yml` (line ~120).

## Goals / Non-Goals

**Goals:** one cwd-independent evidence location; a failable guard; the check:openspec decision.
**Non-Goals:** see proposal.md; no change to what any spec asserts — only where its PNGs land.

## Decisions

**D1 — Location `e2e-evidence/<TICKET>/` at the worktree root, gitignored.** Alternatives: Playwright
`testInfo.outputPath()` / `test-results/` (rejected: Playwright wipes `outputDir` at each run start, so a
reviewer's evidence vanishes on the next run, and the path is per-test-hashed); `.concertino/runs/<TICKET>/evidence`
(rejected: that namespace belongs to concertino's run store in the main checkout — `persist-evidence.sh`, retention
pruning — and a worktree-local copy of it is a different directory with the same name, which is exactly the
confusion this ticket is about); keeping per-change openspec dirs (rejected: the defect). Add `/e2e-evidence/` to
`.gitignore` explicitly (PNGs are already ignored by `*.png`, but the dir must be ignored as a whole so
non-PNG evidence never shows in `git status`).

**D2 — Helper `e2e/support/evidencePath.ts`:** `evidencePath(ticket: string, file: string): string`. Root is
`resolve(__dirname, "../..")` — computed from the helper's own location, never `process.cwd()`. Validates `ticket`
against `/^HEL-\d+$/` and `file` against `/^[A-Za-z0-9._-]+$/` excluding `.`/`..`, throws otherwise; `mkdirSync`
recursive; returns the absolute path. Callers drop their `SHOTS` constants and `mkdirSync` calls. Check that
`e2e/tsconfig` / `check:e2e-types` still pass.

**D3 — Guard `scripts/check-e2e-evidence-paths.mjs`:** walks `e2e/**/*.{ts,mts,js,mjs}`, strips `//` and `/* */`
comments (string-aware enough not to strip `//` inside a string literal), then flags: (a) any remaining
reference to the `openspec/` tree (the substring `openspec/`, or a standalone quoted segment `"openspec"`/`'openspec'`/`` `openspec` ``, which catches `join(__dirname, "..", "openspec", ...)`); (b) every `.screenshot(` call whose argument text (balanced-paren scan to the
matching `)`) contains a `path` property whose value does not start with `evidencePath(`. A `.screenshot()` with
no `path` (returns a buffer) is allowed. Exempt the helper file itself. Escape hatch: a
`// e2e-evidence-path: reviewed — <reason>` comment on the call's first line, mirroring temp-dir-hygiene's; the marker MUST be matched on the raw line before comment stripping, or the
escape hatch can never fire.
Takes an optional target-root argument so the selftest runs it against fixture trees. Output: one
`file:line: reason` per violation, exit 1; exit 0 with a one-line summary count otherwise.

**D4 — Selftest:** fixture trees in an `mkdtemp` dir under the OS temp dir, removed in `finally`; cases: change-dir
resolve path (red), cwd-relative string (red), template-literal path (red), `openspec/` references (a `mkdirSync`/`writeFileSync` under `openspec/specs`, a standalone `"openspec"` segment, and `openspec/changes`) in non-comment
string (red), the same text in a comment (green), helper call over multiple lines (green), no-path screenshot
(green), escape hatch (green). Plus a "real tree" case: the guard passes on the repo itself after migration.

**D5 — check:openspec gitignored-only exemption.** For a `no-tasks` change, run
`git ls-files --cached --others --exclude-standard -- openspec/changes/<name>` (via the existing hermetic
`gitChildEnv`, `cwd: targetRoot`). Empty output → notice `openspec-hygiene: openspec/changes/<name> holds only
gitignored files (not a change; safe to remove) — skipped` on stderr, no error. Non-empty, or git unavailable /
the call throws → the existing error (fail-closed, consistent with D6 in the script header). Rationale: a dir that
can never be committed cannot be an unfinished proposal; blocking every commit on local debris (owner had to
authorise a move by hand) is pure cost. An empty change dir also yields empty `ls-files` output and is skipped
the same way (vacuously "only gitignored files"; equally uncommittable). The guard in D3 removes today's source of such dirs; D5 makes the hook
robust to the next unknown one. Selftest cases added to `check-openspec-hygiene.selftest.mjs`: ignored-only dir →
pass + notice; dir with one untracked committable file and no tasks → fail (existing behaviour preserved).

## Risks / Trade-offs

- [A regex/scan guard can be evaded by indirection, e.g. `const p = "..."; screenshot({ path: p })`] → rule (b)
  rejects any `path` value not literally starting `evidencePath(`, so indirection fails closed rather than passing.
- [D5 could hide a real proposal whose files were accidentally gitignored] → only possible if `.md` files are
  ignored, which no rule does; the notice still names the dir on every commit.
- [Migrating ten specs could change what they assert] → the diff on those files must be confined to path lines;
  evaluator checks `git diff` per file (fixing a now-stale header comment about where screenshots land, e.g.
  hel1350:12, is in scope).
- [Sibling HEL-1330 (open PR, branch `task/guard-spec-live-isolation/HEL-1330`) rewrites the login/isolation lines of
  hel588, hel1085, hel1087, hel1088, hel1275] → keep this change's hunks on those files to the screenshot-path and
  import lines only, so a rebase/merge onto whichever lands first is mechanical; re-run the guard after reconciling.

## Gate-Chain Implications Checklist

`.husky/pre-commit` gains `npm run check:e2e-evidence-paths` and `npm run check:e2e-evidence-paths:selftest`.

- **What does it execute?** `node scripts/check-e2e-evidence-paths.mjs` (read-only file walk + regex) and its
  selftest (writes fixture trees into an `mkdtemp` dir, runs the guard on them as a child `node` process).
- **What environment does it inherit, and from where?** The hook's environment (incl. git's `GIT_DIR`/`GIT_INDEX_FILE`
  exports). Neither script invokes `git`, so those exports are inert; no other env is read.
- **Does it write anything outside its own sandbox?** The guard writes nothing. The selftest writes only under its
  own `mkdtemp` directory and removes it in `finally`.
- **Does it behave differently from a linked worktree than from a main checkout?** No: root is resolved from the
  script's own location, and no git metadata is consulted.
- **What happens on its first run?** It scans the already-migrated tree and must pass; the selftest's real-tree
  case asserts this. Run from a pre-migration tree it would fail, which is the intent.

The D5 change to `check-openspec-hygiene.mjs` adds one `git ls-files` call through the existing `gitChildEnv`
allowlist with `cwd: targetRoot`, the same hermetic pattern every other git call in that script already uses.

## Planner Notes

- Self-approved (ticket explicitly asks to "decide"): D5's answer is "yes, exempt with a notice".
- Self-approved: fix lives in helio; premise validation showed no concertino-rendered file is involved.
- Self-approved: include the six cwd-relative specs (the ticket's own first suspect shape) so one rule covers all.
