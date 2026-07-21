## Context

Concertino's `core/scripts/setup-worktree.sh` (source; rendered into helio's
`scripts/concertino/setup-worktree.sh` by `concertino sync`) creates a git worktree,
copies env files, and runs `CONCERTINO_WORKTREE_HOOKS` (helio: only `npx husky
install`). It never populates `node_modules`, so Husky's frontend jest/lint step
cannot run at commit time and every backend-only ticket resorts to `git commit -n`.

The hook mechanism (line ~105) is `( cd "$WORKTREE_PATH" && eval "$hook" >/dev/null
2>&1 ) || true`, splitting `CONCERTINO_WORKTREE_HOOKS` on `;`. That forbids multi-
statement logic in a single hook string and swallows all output/errors, so a robust
symlink-or-`npm ci`-on-lockfile-diff routine cannot live cleanly in a config hook.
A hook could reference the template's internal `REPO_ROOT` var (subshells inherit it),
but coupling a project config to an undocumented internal name is leaky and untested.

## Goals / Non-Goals

**Goals:**
- A fresh worktree runs the full Husky pre-commit chain (incl. frontend jest/lint)
  without `commit -n`.
- Near-instant, near-zero-disk by default (hardlink copy of the main checkout).
- Correct when a ticket changes frontend deps (lockfile differs → real install).
- Reusable + testable in the concertino source, not helio-specific shell in a string.

**Non-Goals:**
- Unconditional per-worktree `npm ci` (hundreds of MB each — bloated HEL-323's orphan).
- Touching the Husky hook chain, backend/`sbt` setup, or any application code.

## Decisions

1. **Add a first-class step to the core template, driven by a new config field**
   `worktree.linkModules: string[]` (list of module dirs relative to repo root, e.g.
   `["frontend/node_modules"]`). `bin/concertino renderEnv` emits it as
   `CONCERTINO_LINK_MODULES` (space-separated, same pattern as `CONCERTINO_ENV_FILES`).
   Document it in `config/concertino.schema.json`. Rationale: reusable across projects,
   testable, and avoids the `;`-split / leaky-internal-var problems of a config hook.

2. **Hardlink copy, NOT a symlink (design-gate round 1 finding).** A direct
   `ln -s $REPO_ROOT/M $WORKTREE_PATH/M` is **destructive**: the skeptic empirically
   reproduced that running `npm ci` in a worktree whose `node_modules` is such a symlink
   recurses through the link and **deletes the contents of the shared main checkout's
   `node_modules`** — and `npm ci`/`npm install` in a worktree is exactly our own
   lockfile-drift fallback and a routine troubleshooting reflex. So per module dir `M`
   (parent `P = dirname(M)`, lockfile `P/package-lock.json`):
   - Skip if the worktree already has `M` (real dir or existing link) — idempotent.
   - If the main checkout's `M` exists AND the worktree lockfile matches the main
     lockfile (`cmp -s`), populate `M` with a **hardlink copy** `cp -al $REPO_ROOT/M
     $WORKTREE_PATH/M`. Shared inodes ⇒ near-instant, near-zero disk, but the worktree's
     `M` is an independent directory entry, so a later `rm -rf`/`npm ci` in the worktree
     cannot reach back into the main checkout (skeptic-verified: main survives).
   - If `cp -al` fails (e.g. `EXDEV` — worktree on a different filesystem than the main
     checkout, so hardlinks are impossible), fall back to `npm ci` in `$WORKTREE_PATH/P`.
   - Otherwise (lockfile differs, or main `M` missing) run `npm ci` in `$WORKTREE_PATH/P`
     so the worktree gets its own correct modules.
   - If neither a lockfile nor main modules exist, emit a `note:` and continue.

3. **Best-effort under `set -euo pipefail` (skeptic CR-3).** The template runs with
   `set -euo pipefail`, so every fallible command in this step (`cmp -s`, `cp -al`,
   `npm ci`) MUST be guarded so a failure can never hard-abort setup before the `READY`
   lines — mirroring the existing hooks loop's `... || true`. Use explicit `if`/`||`
   guards that degrade to `echo "note: <what failed> for $M" >&2` and continue.

4. **Runs as a dedicated step** (after env-file copy) and **before** the
   `CONCERTINO_WORKTREE_HOOKS` loop, so it has `$REPO_ROOT`/`$WORKTREE_PATH` in scope,
   can surface `note:` lines, and so `npx husky install` sees a populated `node_modules`
   (local `husky`, no network).

5. **Enable in helio:** `concertino.config.json` gets
   `worktree.linkModules: ["frontend/node_modules"]`; re-sync via
   `node ~/Development/concertino/bin/concertino sync` regenerates helio's
   `scripts/concertino/setup-worktree.sh` + `.concertino.env`. Verify by grep.

## Risks / Trade-offs

- **Mutation safety (resolved).** With a hardlink copy the worktree's `M` is an
  independent directory entry; `npm ci`/`npm install`/`rm -rf` in the worktree unlink +
  recreate files rather than editing shared inodes in place, so the main checkout and
  sibling worktrees are unaffected (skeptic-verified). This removes the write-safety
  assumption the symlink approach depended on.
- **Same-filesystem requirement.** Hardlinks need the worktree and main checkout on one
  filesystem. helio's worktrees live under `.claude/worktrees/` inside the repo, so this
  holds; the `EXDEV` → `npm ci` fallback covers the exotic case.
- **Shared Vite cache (sequential-fleet scope).** A hardlink copy still shares
  `node_modules/.vite/deps` inode-wise until first write; `devServers.frontend.start`
  (`npm run dev`) runs inside the worktree. This is a sequential-fleet-only guarantee —
  matching the ticket's Acceptance ("sequential fleets"). Parallel fleets running dev
  servers concurrently should set a per-worktree Vite `cacheDir` (noted as follow-up;
  out of scope here, and it does not affect the pre-commit gate this ticket targets,
  which never runs the dev server).
- **Lockfile convention** assumes the lockfile sits at `dirname(M)/package-lock.json`.
  True for helio (`frontend/`); documented as the convention for the field.
- **Stale modules if deps change mid-ticket** after setup: mitigated because the common
  case (deps unchanged) is correct, the lockfile-diff at setup catches dep-changing
  tickets with a real `npm ci`, and CI is the backstop.

## Planner Notes (self-approved)

- No external dependency, API, or breaking change → no human escalation.
- Chose Option 2 from the ticket (link + lockfile-diff fallback) over Option 1
  (unconditional `npm ci`) on disk/time grounds, and over a config-only hook on
  robustness/testability grounds. Design-gate round 1 corrected the link mechanism from
  symlink to hardlink copy after the skeptic reproduced the symlink's destructive
  `npm ci` failure mode. Skeptic owns final judgment on the trade-off.
