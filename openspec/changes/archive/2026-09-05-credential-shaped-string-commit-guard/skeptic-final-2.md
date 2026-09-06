## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Spawned cold at `f7217c96`. Every statement below is from a command I ran
myself in this worktree. **No browser / Playwright / e2e — deliberately
skipped** per the orchestrator's constraint: another worktree holds the
Playwright session, and this change is build tooling with zero UI surface
(`git diff origin/main..HEAD --name-only` touches only `scripts/*.mjs`,
`.github/workflows/ci.yml`, `.gitignore`, `CONTRIBUTING.md` and change
artifacts). `DESIGN.md` does not apply; there is nothing to render.

Per the brief I did **not** re-derive round 1's substantive verification
(both rules red across all three surfaces, `deliverySecret` in
`KNOWN_CHECKS`/dispatch/`needsText`, vacuity + drift participation, the
`runMutatedScript` exactly-one-occurrence guard, the `{32,}`→`{200,}`
match-nothing mutation, AC tracing). I had no reason to doubt it and it is
recorded with reproducible commands in `skeptic-final-1.md`.

### (a) CR1 — genuinely fixed

Read against each other, not narrated:
- Shipped `.gitignore:80-82` = `/openspec/.hel846-plant.md`,
  `/docs/.hel846-plant.md`, `/notes/.hel846-plant.md` (plus the two
  `/scripts/.hel846-selftest-mutated-*.mjs` entries at `:83-84`).
- `files-modified.md:7` now names exactly those five root-anchored paths and
  adds the rationale + the `9a563bbb` provenance. It matches the shipped
  `.gitignore` character-for-character on all five entries. **CR1 closed.**

### (b) The claimed second fix and the claimed audit — independently checked

- **Selftest bullet (`files-modified.md:4`)** now states the root-level plant
  paths and the `writeHel846Plant` / `mkdirSync(dirname, {recursive:true})`
  guard. Verified against the shipped file: `selftest.mjs:96-98` are exactly
  `openspec/.hel846-plant.md`, `docs/.hel846-plant.md`,
  `notes/.hel846-plant.md`. Accurate.
- **Repo-wide grep for the old change-directory plant path**
  (`grep -rn "hel846-plant"` over the whole tree, and a second grep for
  `credential-shaped-string-commit-guard/.hel846`): three hits survive —
  `evaluation-1.md:135,148,168` and `mutation-evidence.md:307`. I read each
  in context. All four are **historical narrative describing the defect and
  its correction** (evaluation-1.md is the report that raised the CR;
  mutation-evidence.md:307 opens "Cycle 2 (evaluation-1.md CR1) — plant path
  staleness fix … the original plant path … is tied to this change's own
  in-flight directory", then states the fix at :313-322 with the corrected
  root paths). None is a live claim about the shipped state, so none carries
  the copy-it-forward hazard CR1 named. The executor's audit claim holds.
- **Every remaining `files-modified.md` bullet checked against
  `git diff origin/main..HEAD`:**
  - `:5` ci.yml — confirmed: the two `run` steps land in the **`frontend`**
    job (job list at ci.yml:13/58/104/366), after `check:dependabot:selftest`
    and before `npm test`, with a HEL-846 precedent comment mirroring the
    HEL-913 one directly above. Accurate.
  - `:6` CONTRIBUTING.md — confirmed: new
    `### Credential handling in delivery evidence (HEL-846)` section with the
    revoke rule, the mechanical backstop, the marker convention, the
    standing-repo-wide-constraint paragraph, and the added Pre-Commit Policy
    line. Accurate.
  - `:3` script bullet — spot-confirmed the load-bearing claims (no
    `package.json` change: `check:no-credential-leak[:selftest]` already
    existed at `package.json:26-27` on main, so "no new npm script" is true).
  - `:8`/`:9` mutation-evidence.md new; tasks.md 46/46 `[x]`, 0 `[ ]`.
  - **Omissions:** `files-modified.md` does not list `.openspec.yaml`,
    `proposal.md`, `design.md`, `ticket.md`, `specs/`, or the
    `evaluation-*`/`skeptic-*` reports, all of which are in the diff. Not a
    defect: it is a record of *implementation* files, and the sibling archive
    `2026-09-05-widen-credential-leak-gate/` (HEL-956) carries no
    `files-modified.md` at all — no convention is violated.

### (c) What f7217c96 introduced

`git show --stat f7217c96` = three files: `files-modified.md` (+4/-2, the two
bullets above) and the two previously-untracked reports `evaluation-2.md`
(+124) and `skeptic-final-1.md` (+153). Expected and correct — round 1's own
non-blocking note asked for exactly this so they are not lost with the
worktree. No code, workflow, `.gitignore` or script change. Nothing new
introduced.

### (d) Fourth defect of the "something that MOVES" class — searched, none found

I looked specifically and found **no fourth defect of that class.** What I
actually checked:

1. **The archive step, executed not reasoned about.** I `git mv`d
   `openspec/changes/credential-shaped-string-commit-guard` →
   `openspec/changes/archive/2026-09-05-credential-shaped-string-commit-guard`
   and ran both gates in that state: `check:no-credential-leak` → `OK (5990
   files … 0 violations)` exit 0; selftest → `OK` exit 0. Restored with
   `git mv`; `git status --porcelain` empty. Nothing in the change is bound
   to its own directory name any more.
2. **Worktree vs. main checkout.** `repoRoot` is
   `dirname(fileURLToPath(import.meta.url))/..`
   (`check-no-credential-in-agent-surface.mjs:206`) — path-derived, never
   `.git`-shaped (a linked worktree's `.git` is a *file*), so it resolves
   identically in a worktree and in main. `classifyTopLevelDirs` skips
   `name.startsWith(".")`, so `.claude/worktrees/**` and `.concertino/`
   cannot trip the coverage-drift guard in a dev checkout while being absent
   in CI.
3. **A sibling merging underneath.** The nearest sibling is **HEL-956**
   (`351d0168`, archived as `2026-09-05-widen-credential-leak-gate`), which
   introduced the very `SURFACES`/vacuity/drift machinery this change extends.
   It is already **on `origin/main` beneath this branch**, and this branch is
   rebased onto `4ff73647` — so the interaction is already realized, not
   pending, and the full gate suite is green on top of it.
4. **A renamed/moved surface root.** Covered by the shipped vacuity guard
   (`VACUOUS SURFACE`) and drift guard, both of which round 1 proved the three
   new surfaces participate in.
5. **The gate becoming vacuous in CI later.** The only residual I could
   construct is speculative and pre-existing (see non-blocking note 1).

### Mechanical gates — all re-run by me at `f7217c96`, all exit 0

| gate | result |
| --- | --- |
| `check:no-credential-leak` | `OK (5991 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 5886 delivery-evidence, 15 docs, 8 notes, 0 violations)` |
| `check:no-credential-leak:selftest` | `OK` |
| `check:openspec` | `openspec/ is clean` |
| `check:schemas` | `schemas in sync with JsonProtocols (74 checked across 48 protocol files)` |
| `check:spec-structure` | `spec-structure check passed (351 canonical specs, 0 issues)` |
| `format:check` | `All matched files use Prettier code style!` |
| `lint` | `eslint . --max-warnings=0`, exit 0 |
| `typecheck` | `tsc --noEmit`, exit 0 |
| `npm test` | `256 suites / 2650 tests passed` (+ root suite), exit 0 |

Everything I mutated (the archive-rename simulation) was restored;
`git status --porcelain` is **empty**.

### Verdict: CONFIRM

CR1 is closed, the executor's claimed second fix and audit both check out
against ground truth, `f7217c96` introduces nothing else, and the
archive/rename/worktree/sibling interaction surface is green under a real
executed rename. Ships.

### Non-blocking notes

- `ci-complete` treats a **skipped** job as success by design (ci.yml:360-366).
  If a future ticket adds a `paths: frontend/**` filter to the `frontend`
  job, `check:no-credential-leak` — whose whole point is scanning
  `openspec/`, `docs/`, `notes/` — would stop running on exactly the
  evidence-only PRs it exists for, and report green. This is pre-existing and
  identical for `check:node-root-encoding` and `check:dependabot`, so it is
  not this ticket's defect; worth a tracked follow-up if path filters are ever
  introduced.
- Round 1's two open notes stand: the `xxxx` marker widening is a
  shared-helper change (it also loosens `mcp`'s pre-existing `secretLiteral`
  check), and the documented residual limit (a `helio_session` cookie in a
  pasted `curl` transcript is not caught) deserves a ticket rather than only a
  header comment.
