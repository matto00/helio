## Evaluation Report — Cycle 1 (evaluation-2.md)

Scope: Phase-4 fold-in on HEL-1085 (commit bf8f5808), owner ruling `fold-in`,
design.md D11. Docs-only: two `MISTAKES.md` trap entries + tasks.md 5.1-5.3
ticks + ticket.md "Fold-in scope" note. NOT the original HEL-1085 delivery
(already merged as PR #672 / b1b954e3 — evaluation-1.md / skeptic-final-1.md
are that scope's reports and are not under review here).

### Phase 1: Spec Review — PASS
- tasks.md 5.1-5.3 all addressed: two MISTAKES.md entries added under
  `## Tooling` (5.1/5.2) and tasks ticked (5.3 scope-guard self-check).
- Entries match design.md D11's described content (commit-timeout
  backgrounding trap, pgrep self-match trap).
- No AC reinterpreted; no scope creep — `git diff --stat` against the
  freshly-resolved base (19d16159c41ff17463436a6d502705e5c409ca41) shows
  only `MISTAKES.md` and paths under `openspec/changes/**` (the
  archive-restore rename plus this change's own files, including the new
  `skeptic-design-2.md`). No source/schema/spec changed.
- No regressions possible — docs-only diff.
- Planning artifacts (tasks.md, ticket.md, design.md) reflect the
  implemented behavior.
- Constraints C1-C6 honored; C2 (the pgrep self-match trap) is exactly what
  this scope documents, and the entry itself correctly uses the anchored
  `pgrep -c -f '^bash .*<script>'` form rather than repeating the unanchored
  pattern as guidance.

### Phase 2: Code Review — PASS
Gates re-run fresh in `WORKTREE_PATH` (this scope only touches root-level
markdown + openspec/, none of the `frontend/**`/`backend/**` glob triggers,
so only the root/docs-relevant gates apply):
- `npm run format:check` — PASS ("All matched files use Prettier code
  style!"). Root markdown is checked (`.prettierignore` excludes only
  `openspec/`), confirmed clean.
- `npm run lint` — PASS, zero warnings.
- `npm run check:openspec` — PASS ("openspec/ is clean"; the in-flight
  form-field-renderers change is correctly flagged as "complete but in
  flight," not an error).
- `npm test` not run (docs-only diff, no JS/TS changed; not required by the
  brief for this scope).

Fact-checked entry content against the actual tree, not the plan:
- `.husky/pre-commit` actually runs: repo-integrity, lint, typecheck,
  e2e-types, helio-mcp-types, format:check, schemas, spec-structure,
  openspec(+selftest), dependabot(+selftest), scala-quality,
  test-temp-dir-hygiene(+selftest), no-credential-leak(+selftest),
  tokens(+selftest), then `npm test` — matches the entry's description
  ("lint, three typechecks..., Prettier, and schema/spec-structure/
  openspec.../dependabot.../scala-quality/test-temp-dir-hygiene.../
  credential-leak.../token... checks, then the full Jest suite").
- `scripts/concertino/await-sentinel.sh` usage line 38:
  `Usage: await-sentinel.sh <SENTINEL_PATH> <TIMEOUT_SEC>
  [POLL_INTERVAL_SEC]>` and `MAX_TIMEOUT_SEC` hard cap 1800s (line 58,
  `AWAIT_SENTINEL_MAX_TIMEOUT_SEC:-1800`) — matches the entry's "hard cap
  1800s" reference exactly (the entry doesn't literally restate the 1800s
  figure inline but correctly says await-sentinel.sh should be used instead
  of hand-polling; the neighboring `pgrep` entry cites `await-sentinel.sh`
  correctly as the alternative for the same reason it's built — sentinel
  existence, not process match).
- `.git/worktrees/<name>/COMMIT_EDITMSG` recovery path: `git rev-parse
  --git-dir` in this worktree printed `/home/matt/Development/helio/.git/
  worktrees/HEL-1085` — matches the entry's description of the path being
  "whatever `git rev-parse --git-dir` prints for that worktree."
- Anchored pgrep pattern `pgrep -c -f '^bash .*<script>'` is stated
  correctly and is the form the entry recommends as the fix, not the
  unanchored pattern it's warning about.
- `grep -c 'backgrounded mid-hook' MISTAKES.md` = 1,
  `grep -c 'matches itself' MISTAKES.md` = 1 — both match the literal
  wording the executor used ("backgrounded mid-hook," "matches itself" in
  the pgrep entry's opening sentence).
- Field evidence present and accurate: HEL-1087 executor hit the timeout
  trap despite an explicit warning; the pgrep self-match is credited with
  seven occurrences (CON-200, driver x2, CON-189, CON-193, HEL-1084's five
  leaked shells, HEL-1150) — matches the brief's enumeration.

Standard code-quality checks (DRY, readable, modular, dead code, etc.) are
not meaningfully applicable to a two-paragraph docs addition; entries are
clear, specific, in the established "trap that looks correct and fails
silently" voice, consistent ~70-80 column wrapping matching neighboring
entries, correctly placed after "Linear: closing an epic cascades to its
children" and before the `## Process` divider.

### Phase 3: UI Review — N/A
No source, spec, or schema files changed in this scope (docs-only:
MISTAKES.md + openspec/changes/** planning artifacts). No UI-affecting
trigger paths (`frontend/**`, `ApiRoutes.scala`, `schemas/**`,
`openspec/specs/**`) matched. Dev servers/Playwright correctly not started
for this cycle.

### Overall: PASS

### Non-blocking Suggestions
- None.
