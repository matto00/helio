## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Scope: the WHOLE branch at `809c7af2` against ticket.md's "Remaining scope" + AC list.
No servers started, no backend spec run, no DB connection opened (HEL-974 constraint honoured).

### What I verified (with evidence)

**Branch shape.** `git log main..HEAD` = 8 commits; `git diff main...HEAD --stat` touches exactly
3 non-artifact files: `.github/workflows/ci.yml`, `scripts/check-openspec-version.mjs`,
`scripts/check-no-credential-in-agent-surface.selftest.mjs`. No `package.json` / `tsconfig.json`
edit (ticket Constraints honoured — `check:openspec-version` already existed at package.json:18).

**AC2 — euid-0 policy, fatal in CI / non-fatal outside.** Read the terminal branch in
`scripts/check-no-credential-in-agent-surface.selftest.mjs` (diff hunk at ~:1138). It is keyed on
`skippedCases.length > 0` and then `if (process.env.CI)` → `console.error("… FATAL SKIP IN CI …")`
+ `process.exit(1)`; otherwise `OK WITH SKIPS` at exit 0. Keying on the accumulated list rather
than `isRoot` means any future skip reason inherits the guard — stronger than the AC asked for.
Ran the full self-test locally with `env -u CI`: `OK`, exit 0, and both new probe cases green.

**AC2 second clause — the fatal branch is demonstrably failable, not asserted.** I did my own
mutation on a scratch copy (`scripts/.mut-probe.mjs`, deleted after): replaced `if (process.env.CI)`
with `if (false)`. Result: `FAIL (2 failure(s))` — "forced skip with CI set exits non-zero" and
"output carries the fatal-skip-in-CI token" both went red. The probe genuinely exercises the branch.
Working tree left clean of the probe (`git status` shows no `.mut-probe.mjs`).

**AC3 — mutation proven red in CI.** `gh run view 34017981081` exists, is CI on this branch
(PR #579), conclusion **X (failure)**, and the job log shows exactly the claimed shape:
`✓ Run npm run check:no-credential-leak` immediately followed by
`X Run npm run check:no-credential-leak:selftest`, with the downstream steps skipped. The gate
printed OK while its self-test failed — precisely the defect class the ticket exists to close.

**AC3 — mutation fully reverted.** sha256 of both `check-no-credential-in-agent-surface.mjs` and
`…selftest.mjs` at `HEAD` are byte-identical to their blobs at `9781d7c0`
(`0b3067d4…`, `c61502cb…`). `git diff --stat 9781d7c0 HEAD -- scripts/ .github/ package.json .husky/`
shows only the cycle-2 amendment (`ci.yml`, `check-openspec-version.mjs`). No mutation residue.

**AC4 — both checks wired, openspec installed, version single-sourced and runtime-asserted.**
`ci.yml` now has: `Install openspec CLI` → `check:openspec-version` → `check:openspec` →
`check:openspec:selftest`. The install step uses the **assignment form**
(`V="$(node scripts/check-openspec-version.mjs --print-expected)"`, `[ -n "$V" ] || exit 1`,
`npm i -g "@fission-ai/openspec@$V"`) — no inline `$()` in the npm argument (skeptic-design-2 CR1a
satisfied). `--print-expected` verified locally: stdout is exactly `1.10.0\n` (od-confirmed, no
banner), exit 0, everything else in that script is `console.error`.

**AC4 — actually green in real CI on this exact commit.** `gh run view 34019846261` →
`headSha=809c7af25e40a726618f76e98921374f1ada3dac`, conclusion **success**. Frontend job log
(`--job=101450272251`) shows the install running (`added 79 packages`),
`check:openspec-version OK — openspec 1.10.0`, `check:openspec` green, and
`check:openspec:selftest` → `17 passed, 0 failed`. The same log shows the two new AC2 probe cases
executing green on a real runner and the self-test ending `check-no-credential-in-agent-surface.selftest: OK`.
This is the thing the previous cycle could not claim.

**AC5 — survey conclusion recorded.** proposal.md:20 and design.md:154. The claim is accurate:
run 34017981081's step list confirms `check:dependabot:selftest` and both (in fact all four)
`check:node-root-encoding` self-tests were already CI-wired. (The cycle-2 rewrite of the ci.yml
comment dropped the survey sentence from the comment; the AC only requires it recorded, and it is.)

**Archive / un-archive hygiene.** `git diff --stat main...HEAD -- openspec/specs openspec/changes/archive`
is **empty** — the archive commit `9781d7c0` was fully reverted by `53adc7d8`, so canonical specs
are byte-identical to `main` and carry neither a duplicated nor a renamed requirement. The change
dir is back under `openspec/changes/` with `.openspec.yaml` intact, and `check:openspec` (hygiene)
passes in CI at HEAD, which is the authoritative check on that state.

**Working tree.** Only `?? evaluation-2.md` (this cycle's own report, not yet committed) — normal
mid-delivery state, not stray code.

### Verdict: REFUTE

One AC is textually unmet, and it is the one whose deliverable is the PR description itself.

### Change Requests

1. **AC3's recorded evidence is missing from the PR description.** The AC reads "the failing CI
   run URL is recorded in the PR description." PR #579's body currently has, verbatim:
   - `Failing CI run (mutation pushed): _pending — to be filled in below_`
   - `Green CI run after revert: _pending_`

   Both placeholders are still there. Replace them with the real, verified URLs:
   - failing: `https://github.com/matto00/helio/actions/runs/34017981081`
   - green after revert: `https://github.com/matto00/helio/actions/runs/34019846261` (headSha `809c7af2`)

   I verified both runs myself; only the recording is missing. Nothing in the code needs to change.

2. **The PR description is stale about cycle 2 and now states something false.** Its
   "Risks / follow-ups" says: *"**Follow-up candidate (not in scope):** `check:openspec` — the
   *gate*, not its self-test — is still absent from `ci.yml`."* That is no longer true — cycle 2
   wired the gate (`- run: npm run check:openspec`) alongside the self-test. Delete that bullet and
   add the cycle-2 story the body omits entirely: the `openspec` CLI was absent from the runner
   (`spawnSync openspec ENOENT`), so an `Install openspec CLI` step installs the exact `EXPECTED`
   version single-sourced via `--print-expected`, with `check:openspec-version` as the runtime
   assertion on what actually landed on PATH. A reviewer reading this body today would not learn
   that ci.yml gained an install step at all.

3. **`tasks.md` still shows 3.1, 3.2 and 4.6 unchecked** (`- [ ]` at lines 46, 48, 76). All three
   are in fact done — 3.1/3.2's mutation-red and revert-green runs, and 4.6's "confirm in CI that
   the install step, `check:openspec-version`, and both openspec checks pass" — I confirmed each
   against the run logs above. Tick them, with 3.2's URL recorded in the same edit as CR1.

### Non-blocking notes

- The two probe cases cost ~107s of the frontend job (07:44:12 → 07:45:50 in run 34019846261),
  because each spawns a full re-run of the ~180-case self-test. Correct by construction (the
  forced-skip hook is the recursion guard, so depth is exactly 1), but if that job's runtime ever
  becomes a concern, a narrower entry point for the probe children is the lever.
- `check-openspec-version.mjs`'s `--print-expected` is positioned above `readInstalledVersion()`,
  so it prints without shelling out to `openspec` — correct, and necessary for the install step to
  work on a runner where the CLI does not yet exist. Worth keeping that ordering constraint in mind
  if the file is ever reorganized; it is currently implicit.
- The `HEL996_FORCE_SKIP_SELFTEST` hook is add-only and loudly named, and is fatal in CI if set —
  the escape-hatch analysis in the PR body is sound.
