## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `specs/concertino-worktree-setup/spec.md`,
  `tasks.md`, `workflow-state.md`, and the prior `skeptic-design-1.md` (treated as a claim
  to re-verify, not as fact).
- Read ground truth in the source repo (`~/Development/concertino`):
  - `core/scripts/setup-worktree.sh` (full file): confirmed `set -euo pipefail` at line 2,
    `REPO_ROOT`/`WORKTREE_PATH` variable names at lines 39/58 match what `design.md`/
    `tasks.md` reference, the env-file copy loop (lines 88-97), and the hooks loop
    (lines 99-107, `... || true` guard) — confirms the round-2 design's placement
    ("after env-file copy, before the hooks loop") and its guard-pattern citation are
    grounded in the real file, not invented.
  - `bin/concertino`: confirmed `withDefaults` (~174-184) sets `worktree.envFiles`/
    `worktree.hooks` defaults with the exact pattern design.md/tasks.md 2.3 says
    `linkModules` should follow, and `renderEnv` (~364-372) emits `CONCERTINO_ENV_FILES`/
    `CONCERTINO_WORKTREE_HOOKS` via `.join(' ')`/`.join(';')` — confirms the proposed
    `CONCERTINO_LINK_MODULES = c.worktree.linkModules.join(' ')` pattern is consistent
    with existing code, not a new convention invented for this ticket.
  - `config/concertino.schema.json`: confirmed the `worktree` object has
    `"additionalProperties": false` and no `linkModules` property yet — the schema edit
    tasks.md 2.4 calls for is genuinely required, not speculative.
- Confirmed helio's `concertino.config.json` `worktree` block has no `linkModules` yet
  (matches the ticket's premise) and that `gates` already run `lint`/`format:check`/
  `test`/`build` scoped to `frontend/**` — consistent with the fix targeting exactly the
  gate this ticket cares about.
- Traced all four round-1 Change Requests against the round-2 artifacts:
  1. Destructive symlink → **resolved**. `design.md` Decision 2 and `tasks.md` 2.2 now
     specify `cp -al` (hardlink copy), explicitly reject `ln -s`/`ln -sfn`, and cite the
     round-1 empirical reproduction. `spec.md`'s "Hardlink copy by default" requirement
     matches.
  2. Unenforced write-safety assumption → **moot/resolved** given (1).
  3. `set -euo pipefail` unenforceable "MUST NOT abort" → **resolved**. `design.md`
     Decision 3 explicitly names the guard pattern (mirror the hooks loop's `|| true`,
     degrade to `note:` + continue) and `tasks.md` 2.2a calls it out as CRITICAL for every
     fallible command (`cmp -s`, `cp -al`, `npm ci`). `spec.md`'s second requirement and
     its "failing module-populate step does not abort" scenario match.
  4. Missing failure-injection test → **resolved**. `tasks.md` 4.3 adds a dedicated
     failure-injection task that checks `setup-worktree.sh` still reaches `READY` lines.
  Non-blocking notes (Vite cache scope, task ordering before hooks) → both explicitly
  addressed: `design.md` Risks section scopes the shared-cache exposure to sequential
  fleets (matching the ticket's own Acceptance wording) and flags per-worktree Vite
  `cacheDir` as an explicit follow-up; Decision 4 pins the new step before the hooks loop
  with a stated rationale (husky sees local `husky` already present).
- Traced every ticket Acceptance line to a covered task/spec scenario (fresh worktree
  runs full Husky chain without `commit -n` → spec scenario 1 + tasks 4.1; setup-time/
  disk cost measured → tasks 4.1; fix lands in concertino source + re-synced + verified
  by grep → tasks 3.2/3.3; root-cause-first → tasks 1.1). No AC is left uncovered.
- Checked the schema/config/env-var naming path end-to-end (`concertino.config.json`
  `worktree.linkModules` → schema `properties.worktree.properties.linkModules` →
  `withDefaults` default `[]` → `renderEnv` → `CONCERTINO_LINK_MODULES` in
  `.concertino.env` → consumed in `setup-worktree.sh`) — internally consistent, no gaps.

### Verdict: REFUTE

The core mechanism (hardlink copy) is now sound and the four round-1 Change Requests are
genuinely resolved in `design.md`, `tasks.md`, and `specs/concertino-worktree-setup/spec.md`.
However, the revision was not propagated to all planning artifacts: `design.md`'s own
"Goals" section and the entirety of `proposal.md`'s "What Changes" section still describe
the **rejected, destructive symlink mechanism** as the plan — a direct, unresolved internal
contradiction against `design.md`'s own Decision 2/3, `spec.md`, and `tasks.md` 2.2, on
exactly the point that was the safety-critical finding of round 1.

### Change Requests

1. **`design.md` line 21 contradicts `design.md`'s own Decision 2 (line 38+).** The Goals
   section still reads: `- Near-instant, near-zero-disk by default (symlink to the main
   checkout).` This is the rejected mechanism the same document dismantles two paragraphs
   later. Required revision: reword to reference the hardlink copy, e.g. "Near-instant,
   near-zero-disk by default (hardlink copy of the main checkout's modules)."

2. **`proposal.md`'s entire "What Changes" section (lines 9-21) describes the rejected
   symlink mechanism, not the hardlink copy the rest of the change settled on.**
   Specifically:
   - Line 14-15: "For each configured directory the template symlinks the worktree copy
     to the main checkout's `node_modules` (near-instant, zero extra disk)..."
   - Line 27: "...(default: symlink to the main checkout, `npm ci` fallback on lockfile
     drift)..." (this is in the "New Capabilities" summary under `## Capabilities`)

   This is not a wording nitpick: `proposal.md` is the concise, canonical "what changes"
   summary a future reader (or an executor scanning artifacts top-down) is most likely to
   read first and trust literally. As written, it instructs implementing the exact
   destructive mechanism (symlink into the main checkout's live `node_modules`, which
   `npm ci` in the worktree can wipe) that round 1 empirically proved unsafe and that
   `design.md`/`spec.md`/`tasks.md` explicitly reject. Required revision: rewrite both
   passages to describe the hardlink-copy + guarded-fallback mechanism, consistent with
   `design.md` Decision 2 and `spec.md`'s "Hardlink copy by default" requirement.

Once these two passages are brought in line with the rest of the change set (which is
otherwise sound, well-specified, and testable), this design is ready to proceed. No other
blocking issues found.

### Non-blocking notes

- `ticket.md` line 26 ("Symlink `frontend/node_modules` → the main checkout's
  `node_modules`... **Recommended default.**") is stale relative to the final decision,
  but `ticket.md` is the original ticket/options record, not a live planning artifact the
  design supersedes in place — `design.md`'s own Planner Notes already flag the
  supersession ("Design-gate round 1 corrected the link mechanism from symlink to
  hardlink copy"). Not required to edit, but worth being aware an unwary reader of
  `ticket.md` alone would get the stale recommendation.
- `design.md`'s algorithm (Decision 2) has one narrow, low-severity gap for the fully
  generic (non-helio) case: if the worktree's own lockfile is missing (unusual, but the
  field's contract doesn't require it to exist) while the main checkout's `M` *does*
  exist, `cmp -s` fails, the "lockfile differs" branch is taken, and `npm ci` is
  attempted in a directory with no lockfile — this would fail (safely, since it's
  guarded to a `note:` per Decision 3) but produces no populated modules where a hardlink
  copy might otherwise have been possible. Does not affect helio (its
  `frontend/package-lock.json` is always tracked/checked out with the worktree). Not
  blocking; flagging only in case the executor wants to special-case it while already in
  the code.
