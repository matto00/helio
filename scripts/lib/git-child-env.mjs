/**
 * Hermetic environments for child processes that shell out to `git`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Git exports repo-locating variables into hook subprocesses. From a LINKED
 * WORKTREE -- which is this repo's entire delivery model -- the exported
 * `GIT_DIR` is `<repo>/.git/worktrees/<name>`, not `<repo>/.git`:
 *
 *   from a main checkout:    (no GIT_DIR)   GIT_INDEX_FILE=.git/index     <- relative
 *   from a linked worktree:  GIT_DIR=<repo>/.git/worktrees/<name>         <- absolute
 *                            GIT_INDEX_FILE=<repo>/.git/worktrees/<name>/index
 *
 * `GIT_DIR` beats `cwd` unconditionally, so a script that builds a throwaway
 * fixture repo under `mktemp` and passes `cwd: fixtureDir` still operates on
 * the REAL repository when invoked from a hook. On 2026-08-21 that turned a
 * fixture `git init` into a re-init of the real repo: git's
 * `guess_repository_type()` treats any `GIT_DIR` whose basename is not `.git`
 * as bare, so it wrote `core.bare = true` into the shared config and bricked
 * the main checkout for ~70 minutes. `core.bare` is a common (non-worktree)
 * key, so every linked worktree kept working and the damage surfaced far away
 * from its cause. See HEL-805.
 *
 * The footgun is invisible in ordinary testing: run the same script straight
 * from a shell and it passes, because there is no `GIT_DIR` to inherit and
 * `GIT_INDEX_FILE` is relative. It only misbehaves under a hook.
 *
 * ALLOWLIST, NOT DENYLIST
 * -----------------------
 * The first fix here was a denylist of six repo-locating names. Hours later
 * `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE` (also exported to hooks, during
 * `rebase` and `commit --amend`) turned out to be missing from it, and
 * `GIT_CONFIG_PARAMETERS` -- which injects the caller's `-c` overrides into
 * every child git -- was missing from both. Denylists fail open: you learn a
 * name is missing only when it bites. Child `git` gets an explicit minimal
 * environment instead, so names nobody has thought of yet cannot leak.
 */

/**
 * The only variables a child `git` inherits. Deliberately short.
 *
 * Nothing `GIT_*` belongs here. A caller that genuinely needs to set one --
 * e.g. a fixture deliberately backdating a commit -- passes it explicitly via
 * the `extra` argument below, which makes the intent visible at the call site
 * instead of depending on ambient state.
 */
export const CHILD_ENV_ALLOWLIST = [
  "PATH", // locate the git binary and its subcommands
  "HOME", // global gitconfig; git works without it, kept to avoid an unrelated behaviour change
  "TMPDIR", // temp files git may create
  "LANG",
  "LC_ALL",
  "SystemRoot", // Windows: git fails to resolve DNS/sockets without it
];

/**
 * Build a hermetic environment for a child `git` invocation.
 *
 * @param {Record<string, string>} extra Explicit per-call variables. Applied
 *   AFTER the allowlist, so an intentional value always wins over the default.
 * @returns {Record<string, string>}
 */
export function gitChildEnv(extra = {}) {
  const env = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

/**
 * Build an environment for a child process that is NOT `git` itself but may
 * shell out to it -- another node script, or a third-party CLI whose full env
 * needs we do not control (npm/node internals, proxies, terminal settings).
 *
 * A strict allowlist would be wrong here because we cannot enumerate what such
 * a tool legitimately needs. Instead inherit everything except the `GIT_*`
 * namespace, matched by PREFIX rather than by a list of known names, so a
 * variable git adds in a future release is excluded automatically.
 *
 * @param {Record<string, string>} extra Applied after the strip.
 * @returns {Record<string, string>}
 */
export function nonGitChildEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GIT_")) continue;
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}
