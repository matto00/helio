## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 00929533879814cca440e7eb4b60edb8f9953348. The diff base was resolved live by resolve-review-base.sh as
2e98eba9287d61a47957129f1f097ea039125d92. Scratch for this review is in
/home/matt/Development/helio/.concertino/scratch/HEL-1751/skeptic/.

### What I verified (with evidence)

- **Scope of the diff.** `git diff --name-only BASE...HEAD`, excluding openspec/, lists only `.audit-ci.jsonc` and
  `frontend/.audit-ci.jsonc`. No package.json or package-lock.json changed: `git diff --stat` on those paths is
  empty. Prettier `--check` passes on both .jsonc files.
- **AC1/AC2, form and comment.** Every new entry is `GHSA-fc5q-39xc-vjpf|<full-package-name>>*`. There is no bare
  GHSA id, no leading `*`, and no `picomatch*` form. Each file has one block comment naming HEL-1751, the reason
  (dev-only, no patch, 4.0.7 latest), the tool families on the paths, and review-by 2026-12-17. The comment covers
  the whole group rather than each entry, which matches the grouping deviation recorded in design.md.
- **audit-ci path model, read from the installed source.** I read node_modules/audit-ci 7.1.0,
  dist/chunk-FA3SOWIW.js:704-750. A reported path is built by walking the vulnerable module's `effects`. Its head
  is always a key of npm audit's `vulnerabilities` that was reached through effects. That is either a closure
  member with no vulnerable dependents, a cycle-truncation point, or a memoized closure member's path. The only
  bare head is `picomatch` when picomatch is a direct dependency. So **every head is a member of picomatch's
  effects closure**, and `matchString` (line 167) anchors the regex with `^...$`.
- **Committed lists against the closure.** I recomputed the effects closure from the four audit JSON dumps in
  scratch (two runs per tree). Root gives 43 and frontend/ gives 46, identical to the committed entries in both
  runs.
- **Can CI flake red (the orchestrator's question)?** I computed an upper bound: every lockfile package that
  transitively depends on picomatch by name, over dependencies, optionalDependencies and peerDependencies
  (`skeptic/maxclosure.js`). Every listed entry falls inside this bound. The bound adds only these packages:
  - root: `jest-pnp-resolver` (dev)
  - frontend/: `jest-pnp-resolver` (dev) and `@vitejs/plugin-react` (dev)

  Both reach picomatch only through a peer range (`jest-resolve: *`, and a multi-major `vite` range). Those ranges
  include versions that are not vulnerable, so arborist's metavuln calculator does not flag them
  (`audit-report.js:172-186`). That depends on the published registry, not on run order. The observed 45-vs-46
  variation was an entry dropping out (`@types/jest`). A missing entry is harmless: audit-ci only prints a
  "Consider not allowlisting" warning and still exits 0. A head outside the list would need a registry or lockfile
  change, and in that case going red is the correct, fail-closed result. **Conclusion: no run-order flake can
  produce an unlisted head on this lockfile.**
- **AC3, positive.** Installed audit-ci was run by absolute path in the worktree, 3 times per tree, with
  `--report-type summary`. All 6 runs exited 0 and printed "Passed npm security audit". The helio-mcp CI form
  (`--config helio-mcp/.audit-ci.jsonc --directory helio-mcp`) also exited 0. The set of "Consider not
  allowlisting" entries changed between runs, which confirms that the reported heads are unstable while the
  pass/fail result is not.
- **AC3, negative (my own scratch lockfiles, real npm lockfiles, installed audit-ci, both committed configs).**
  - A prod dependency on `chokidar@3.6.0` exits 1 under both configs, reporting `chokidar>readdirp>picomatch` (one
    earlier run reported `chokidar>anymatch>picomatch` and `readdirp>picomatch`).
  - A direct prod dependency on `picomatch@4.0.7` exits 1 under both, reporting `picomatch`.
  - The control, a dependency on `jest-util@30.2.0`, exits 0 under both. It is allowlisted, so the configs are
    parsed and do match.
- **Residual risk, already disclosed (not new).** A direct prod dependency on `micromatch@4.0.8` exits 0 under
  the root config, because it reports `micromatch>picomatch`. That string is textually identical to the real
  dev-only path `micromatch>picomatch>` that root already reports. Under frontend/, which has no `micromatch`
  entry, it exits 1. audit-ci path strings carry no dev/prod information, so no allowlist that accepts root's real
  path can tell these cases apart. The verbatim-path D2 would have the same gap, and the HEL-1246
  `*micromatch>braces*` precedent was broader. design.md "Risks / Trade-offs" discloses this.
- **AC4.** I re-ran `npm audit --omit=dev` live: root reports "found 0 vulnerabilities", and so does frontend/.
- **AC5, braces.** I ran `gh api /advisories/GHSA-vfj7-8cjw-p6xm` live: `withdrawn_at` is 2026-10-23T12:53:02Z.
  The entry was removed and none of my audit runs report vfj7. Removal is correct.
- **No patch exists.** `npm view picomatch version` returns 4.0.7. `gh api /advisories/GHSA-fc5q-39xc-vjpf` gives
  `withdrawn_at` null and `first_patched_version` null.
- **Standing constraints.**
  - C1: the entries use the permitted `<full-head>>*` grouping form, and the deviation from verbatim entries is
    recorded with its reason.
  - C2: the executor's negative proof used the installed CLI with a control. I independently reproduced the same
    kind of proof with real registry lockfiles, as listed above.
- **AC6 (the PR's `security` job is green)** cannot be observed before the PR exists. The local CI-equivalent
  commands all pass, as shown above.

### Verdict: CONFIRM

### Non-blocking notes

- The root `micromatch>*` entry also matches a future direct prod dependency on micromatch (shown above with
  negC). Consider adding a CI step `npm audit --omit=dev --audit-level=moderate` in root and frontend/. It would
  catch exactly the prod-path case that audit-ci's path model cannot express.
- The PR body could say that npm audit's effects set can shrink between runs, which is harmless, and that it
  cannot grow on an unchanged lockfile. Only `jest-pnp-resolver` and `@vitejs/plugin-react` could ever join it,
  and only through a registry change.
- `evaluation-2.md` is untracked in the worktree. Commit it with the rest of the change artifacts.
