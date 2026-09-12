## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `8fc7face201a696ba4c3011d5a148702b3a3d79d` (planning artifacts uncommitted, as expected at a design gate).

### What I verified (with evidence)

**Round-1 CR1 (bare-alias `npm test`) — CLOSED.** design.md:41-47 now specifies parsing both `npm run <script>` and the bare npm alias forms; tasks.md:19-21 carries the same requirement; the self-test (design.md:71-75, tasks.md:28-34) requires a bare-alias fixture case. Ground truth: `.husky/pre-commit:21` is literally `npm test`, so this line was a real blind spot and is now covered.

**Round-1 CR2 (generic resolution, no hand-maintained table) — CLOSED.** design.md:48-55 resolves each hook script name from the repo's own `package.json` `scripts` entry and extracts every `node <path>` occurrence, explicitly covering the non-node commands. Checked against root `package.json`: the six non-`node` hook entries are `lint` (eslint), `typecheck` / `check:helio-mcp-types` (`npm --prefix …`), `check:e2e-types` (tsc), `format:check` (prettier), and compound `test` (`jest && npm --prefix frontend test`). All six are name-matched in `ci.yml`'s `frontend` job (lines 28-31, 44, 96), so name-match-only coverage for them is sufficient and non-vacuous.

**Round-1 CR3 (coverage scoped to `ci-complete`) — CLOSED in design.md/tasks.md.** design.md:56-63 and tasks.md:22-24 scope the CI parse to `.github/workflows/ci.yml` and only the jobs named in its `ci-complete` `needs:` array. Ground truth `ci.yml:406-408`: `ci-complete: if: always()`, `needs: [frontend, backend, security, e2e]` — the array exists in the form the design assumes, and a step added to `frontend` gates it with no `needs:` edit (tasks 2.1/2.2 verified true in advance).

**"pure Node.js" overclaim — CORRECTED.** design.md:6-8 now states `check-repo-integrity.mjs` and `check-spec-structure.mjs` shell out to `git config` / `which`. Accurate.

**No new gap in the wiring half.** Decision 1's insertion point (after `check:openspec:selftest`, `ci.yml:95`) still precedes `npm test` at `ci.yml:96` — fine. Exclusions handling of `selftest:concertino-git-env` (design.md:68-70) matches the hook's own trailing comment (`.husky/pre-commit:23-27`): it is not in the hook, so the guard never sees it. AC coverage unchanged and complete (AC1→2.1/2.2, AC2→3.1-3.4, AC3→1.1).

**Two residual defects found (below).**

### Verdict: REFUTE

Both remaining items are paragraph-level edits to the artifacts; the technical approach is sound and I would ship it once these are corrected.

### Change Requests

1. **`proposal.md:14-18` still specifies the exact rule design.md Decision 2 now rejects as a bypass hole.** It reads: parse "`.husky/pre-commit`'s `npm run` step list and compares it against every `npm run <script>` invocation across `.github/workflows/*.yml`" — i.e. the `npm run`-only parse (refuted CR1) and the all-workflows glob (refuted CR3), verbatim. That is a direct proposal-vs-design contradiction in the durable artifact a later reader will consult first. Rewrite that bullet to match design.md Decision 2: both invocation forms on the hook side, and coverage scoped to `ci.yml`'s jobs listed in `ci-complete`'s `needs:` array.

2. **design.md:44-46's hook-line count is wrong, and is presented as measured ("confirmed by direct count").** The text says "18 `npm run` lines + this 1 bare-alias line" and design.md:50 says the resolution "covers all 19 entries uniformly". Ground truth in this worktree: `grep -c '^npm run ' .husky/pre-commit` → **17**; `grep -c '^npm '` → **18** total (17 `npm run` + 1 `npm test`). The figures inherited from skeptic-design-1 CR1 are off by one. Correct both numbers to 17 + 1 = 18, or drop the count — nothing in the guard's behavior depends on it, but a verified-sounding number that is wrong is exactly the kind of claim that gets cited downstream as fact.

### Non-blocking notes

- design.md:42-43 lists `npm ci` among "bare npm alias forms (npm's own built-in shorthand for `npm run <alias>` when `package.json` defines that script key)". `npm ci` is npm's clean-install command, not a `run` alias (npm's aliases are `test`/`start`/`stop`/`restart`), and root `package.json` defines no `ci` script. The design's "when `package.json` defines that script key" qualifier makes this harmless in practice — but note that `ci.yml:25-27` contains three real `npm ci` / `npm --prefix … ci` lines on the *CI-parse* side, so the implementer should make sure the alias list doesn't cause `ci` to be treated as a script name there either.
- Round 1's note about `.yaml`-suffixed workflows is now moot: the guard reads the single fixed path `.github/workflows/ci.yml`.
