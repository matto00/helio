## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `specs/concertino-worktree-setup/spec.md`,
  `tasks.md` in full.
- Read ground truth in the source repo (`~/Development/concertino`):
  `core/scripts/setup-worktree.sh` (full file — confirmed `set -euo pipefail` at line 2;
  confirmed the `;`-split hook loop with `eval "$hook" >/dev/null 2>&1 ) || true` at
  ~line 103), `bin/concertino` (`withDefaults` ~174, `renderEnv` ~364), and
  `config/concertino.schema.json` (confirms `worktree` object has
  `"additionalProperties": false`, so a new `linkModules` field genuinely requires the
  schema edit tasks.md 2.4 calls for).
- Read helio's `concertino.config.json` (`worktree.hooks: ["npx husky install"]`, no
  `linkModules` yet — matches the ticket's premise).
- Confirmed the pre-commit chain (`.husky/pre-commit`, root `package.json`,
  `frontend/package.json`) is read-only w.r.t. `node_modules` for the specific gate this
  ticket targets: `lint` (no `--fix`), `format:check` (no `--write`), `test` (jest, no
  configured cache dir inside `node_modules`). This supports the design's claim that the
  **pre-commit gate itself** never mutates node_modules.
- Confirmed via `git log --oneline -- frontend/package-lock.json` that this repo
  routinely lands tickets that add/upgrade frontend dependencies (react-markdown,
  FontAwesome, ECharts, testing-library, etc.) — i.e., mid-ticket `npm install <pkg>` /
  `npm ci` in a worktree is a normal, expected occurrence, not a hypothetical edge case.
- **Empirically reproduced the core risk** in the scratchpad (three isolated repros, npm
  version as installed on this machine):
  1. `ln -sfn main/node_modules worktree/node_modules`, then `npm install <newpkg>` in
     the worktree: npm prints `npm warn reify Removing non-directory .../node_modules`,
     silently **unlinks the symlink** and creates a fresh real `node_modules` in the
     worktree (full local reinstall) — main's copy survives, but the intended
     near-zero-cost benefit is defeated for exactly the tickets that need to add a
     dependency (the case this feature exists to help).
  2. Same symlink setup, then `npm ci` in the worktree: npm prints the same
     `Removing non-directory` warning, but this time it **recurses into the symlink
     target and deletes its contents** — verified `main/node_modules` was left present
     as a directory but **completely empty** (`left-pad` gone) afterward. This is
     destructive to the **main checkout**, not just the worktree.
  3. Repeated with `cp -al main/node_modules worktree/node_modules` (hardlink copy)
     instead of a symlink: `npm ci` in the worktree completes normally and
     `main/node_modules` is **untouched** (`left-pad` still present). The copy itself
     took `0m0.001s` for a small tree — for helio's real 439MB `frontend/node_modules`
     it will still be low-single-digit seconds at worst (directory-entry + hardlink
     creation, no data copy), i.e., comparable to the symlink's "near-instant" framing
     while being safe against this failure mode.

### Verdict: REFUTE

The core mechanism (Decision 2 in `design.md`, Task 2.2 in `tasks.md`) — an absolute
symlink from the worktree's `frontend/node_modules` straight to the **main checkout's**
`frontend/node_modules` — has a severe, reproducible failure mode that the design does
not account for, plus two secondary specification gaps.

### Change Requests

1. **[Critical — must fix] Symlinking directly to the main checkout's live
   `node_modules` is unsafe; it must not be the mechanism.** As reproduced above, running
   `npm ci` inside *any* worktree whose `node_modules` is this symlink (a completely
   ordinary troubleshooting reflex — "reinstall to fix something," and also literally the
   design's own proposed fallback command) **deletes the contents of the shared main
   checkout's `node_modules`**, silently. Blast radius: it breaks the primary working
   tree's frontend build/tests for the human developer, and simultaneously breaks every
   *other* worktree currently symlinked to the same target in a fleet — all from one
   `npm ci` run in one worktree. This is exactly the "unacceptable risk" question posed to
   me, and it is unacceptable as specified.
   - Required revision: replace `ln -sfn "$REPO_ROOT/$M" "$WORKTREE_PATH/$M"` with a
     **hardlink copy**, e.g. `cp -al "$REPO_ROOT/$M" "$WORKTREE_PATH/$M"` (fall back to a
     plain `cp -a` or the existing `npm ci` path on `EXDEV`/cross-filesystem failure,
     since hardlinks require the same filesystem/mount as the main checkout). Empirically
     this preserves the "near-instant, near-zero-disk" property (shared inodes, no data
     copy) while making the worktree's copy a genuinely independent directory entry, so a
     worktree's own `rm -rf`/`npm ci`/`npm install` cannot reach back into the main
     checkout. Update `design.md` Decision 2, the "Risks / Trade-offs" section, the spec's
     "Symlink by default" requirement/scenarios (rename or reframe as "link" generically,
     since the mechanism is no longer a true symlink), and `tasks.md` 2.2 accordingly.

2. **The design's mitigation for write-safety ("we never `npm install` through the
   symlink, so no writes") is an unenforced assumption, not a real safeguard**, and is
   contradicted by this repo's own history of routinely adding frontend dependencies
   mid-ticket (see `git log -- frontend/package-lock.json`: react-markdown, FontAwesome,
   ECharts, testing-library, etc. all landed via ticket work). Once Change Request 1 is
   adopted this is moot (mutation becomes safe), but if the hardlink approach is rejected
   for some reason, this assumption cannot stand as the sole mitigation and needs a real
   technical enforcement or a loud, unmissable warning in executor-facing guidance.

3. **The spec's "MUST NOT abort worktree setup on failure" requirement is unenforceable
   as currently specified**, given `core/scripts/setup-worktree.sh` runs under
   `set -euo pipefail` (confirmed at line 2) and the only existing fallible step
   (`CONCERTINO_WORKTREE_HOOKS`) is deliberately wrapped in `... || true` to survive that.
   Neither `design.md` Decision 2 nor `tasks.md` 2.2 tells the implementer that the new
   step's fallible commands (`npm ci`, and any use of `cmp -s`/`ln -sfn`/`cp -al` outside
   an `if`/`||` guard) must be similarly guarded. As written, a competent implementer
   could plausibly ship a version where a failed `npm ci` (e.g., transient network
   failure) hard-aborts the entire `setup-worktree.sh` run before it reaches the `READY`
   lines — a regression for every worktree, not just frontend ones, and a direct
   contradiction of the spec's own MUST NOT. Required: `design.md`/`tasks.md` must
   explicitly name the guard pattern (mirroring the existing hooks loop), e.g.
   `... || echo "note: npm ci failed for $M" >&2`.

4. **`tasks.md` section 4 has no test for the "never aborts" requirement.** 4.1/4.2 test
   the happy path (symlink/link resolves) and the lockfile-drift fallback, but nothing
   simulates the fallback command itself failing (corrupt lockfile, unreachable registry,
   permission error) to confirm `setup-worktree.sh` still reaches `READY ...`. Given
   Change Request 3, add a failure-injection scenario to section 4.

### Non-blocking notes

- `design.md`'s risk section dismisses shared-cache risk ("`node_modules/.vite` ...
  acceptable ... parallel dev servers already coordinate via ports") with reasoning that
  doesn't actually address the risk — port coordination prevents bind-address collisions,
  it says nothing about filesystem cache-state correctness. `concertino.config.json`'s
  `devServers.frontend.start` (`npm run dev`) runs inside the worktree using this same
  linked `node_modules`, so concurrent fleet dev servers across different branches would
  share the exact same `.vite/deps` cache directory — a materially new exposure vs. the
  status quo (previously-isolated, independently-installed `node_modules` per worktree).
  The ticket's own Acceptance criterion scopes cost-acceptability to "sequential fleets"
  only; worth having the design either explicitly scope/flag this as a sequential-fleet-
  only guarantee, or address it (e.g. per-worktree Vite `cacheDir`). Not blocking once
  Change Request 1 lands (hardlink copy has the same exposure but at least isn't
  destructive), but worth a documented decision rather than silence.
- Task ordering: `tasks.md` 2.2 doesn't say whether the new link/copy step runs before or
  after `CONCERTINO_WORKTREE_HOOKS` (`npx husky install`). Running it first would let
  `npx husky install` see local `husky` already present (faster, no network), which is a
  free win worth naming explicitly in tasks.md rather than leaving to chance.
