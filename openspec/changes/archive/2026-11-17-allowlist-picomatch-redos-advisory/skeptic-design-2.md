## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 2e98eba9287d61a47957129f1f097ea039125d92 (artifacts only, untracked change dir; no implementation yet).

### What I verified (with evidence)

- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/allowlist-picomatch-redos-advisory/hel-1751`.
- Re-read ticket.md, proposal.md, design.md, tasks.md, both spec deltas and skeptic-design-1.md.
- **Round-1 CR1 (path model + exact entry shape): addressed.** design.md Context now describes the DFS truncation:
  a re-hit parent returns the caller's path, so the head depends on DFS order and the trailing `>` stays. It cites
  root `jest-util>picomatch>` and frontend/ `picomatch>`. D2 requires the verbatim reported path, trailing `>` kept,
  plus `*`. It names `"GHSA-fc5q-39xc-vjpf|picomatch>*"` and forbids `picomatch*`, with the reason. D2's tightness
  argument is now the correct one: new prod path → new top-level node → new head. tasks.md C1 states the same rule.
- **Round-1 CR2 (grouped heads): addressed.** D2 allows grouping only as `<full head>>*` (for example `jest>*`), forbids
  `jest*` and gives the `jest-newprod>picomatch` reason. It also requires every grouped head to pass D3. Bare leading
  `*` is forbidden everywhere.
- **Round-1 CR3 (negative proof on shipped code, with a control): addressed.** D4 and task 3.2/C2 rule out a
  reimplemented matcher. They require the installed CLI with the committed config, an npm shim or a scratch lockfile,
  a control (an allowlisted dev path that must NOT be reported) and the three non-allowlisted cases, each reported
  with a non-zero exit, for both configs.
- **Feasibility of the D4 shim route, checked against the shipped code** (`node_modules/audit-ci/dist/chunk-FA3SOWIW.js`):
  - L807: `npmExec = _npm || "npm"`.
  - L827: `runProgram`, which calls cross-spawn `spawn(command, ...)` (L8, L111). That resolves `npm` through PATH,
    so a PATH-first shim is a real route.
  - L824-831: any stderr output throws `Invocation of npm audit failed`.
  - L353-372: with `package-manager` set to "auto", npm is chosen only when `package-lock.json` or
    `npm-shrinkwrap.json` exists in the directory.
  See non-blocking notes.
- **Frontend MODIFIED scenario ("zero vulnerabilities of moderate severity", highs covered by allowlist) matches
  reality.** The scratch `npm audit --json` metadata reads frontend/ `{"moderate":0,"high":46,"total":46}` and root
  `{"moderate":0,"high":43,"total":43}`.
- D5 now carries the round-1 non-blocking note: the `gh api` result is the stated reason, and "a patch exists" is
  explicitly not it. D3 now covers truncated heads. The churn risk goes in the PR body (D2).
- No new placeholders, contradictions or scope drift. The AC-to-task mapping is unchanged from round 1 and complete.

### Verdict: CONFIRM

### Non-blocking notes

- D4 shim mechanics, from the shipped code: the shim must write nothing to stderr (L829 throws on any stderr line). The
  scratch dir needs a `package-lock.json` (it can be a stub), or the run must pass `--package-manager npm`, so
  auto-detection picks npm (L360-366). A run that dies with "Invocation of npm audit failed" or a package-manager
  error is a harness failure. It is not the negative proof. The evidence must show the control unreported AND the
  three cases under "Found vulnerable advisory paths".
- The positive control should use a path string copied verbatim from the real audit-ci output (including a
  trailing-`>` truncated path in at least one tree). That way the control also exercises the trailing-`>` rule.
