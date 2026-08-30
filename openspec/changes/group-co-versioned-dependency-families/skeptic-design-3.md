## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Cold read of `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/dependabot-update-grouping/spec.md`, plus the live `.github/dependabot.yml`,
`frontend/package.json`, `scripts/` and the worktree's `node_modules` state.
Round-2's report was read only as a set of claims to re-verify.

**CR1 (probe recipe / no-trace mechanism) — GENUINELY FIXED.**
`tasks.md` §5 is renumbered 5.1–5.4 (no `4.5`/`4.6`/`4.7` task numbers remain in the
task list). 5.1 now gives the literal command with `--no-save --no-package-lock`,
which is the flag pair that actually prevents the `frontend/package.json` and
`frontend/package-lock.json` writes Non-Goal line 20 forbids, and requires an
`npm ls` version readout so the transcript is attributable to a known version set.
5.3 restores with `npm --prefix frontend ci` *before* section 6 runs, with the reason
stated. 5.4 asserts no trace. Checked the mutation is self-contained: this worktree's
`frontend/node_modules` is a real directory (not a symlink to the main checkout) and
root `node_modules` is absent — so the probe cannot leak into another checkout, and
`npm --prefix frontend ci` is a sufficient restore.

**CR2 (stale counts) — GENUINELY FIXED.**
Measured independently: `node -e` over `frontend/package.json` → **18** production,
**16** dev. `design.md:93` now reads "18 production plus 16 dev entries". `grep` finds
no surviving `17 `/`15 dev` count anywhere in `design.md`. The Decision 1 table still
enumerates all 18 rows and closes with "18 of 18 accounted for".

**CR3 (fixture count) — GENUINELY FIXED, and strengthened past the original ask.**
Task 6.2 now requires the selftest output to name each of the six cases (a)–(f)
individually and explicitly rejects a pass-count summary line, naming case (f) as
CR3's coverage control. This closes the loophole where a silently-skipped case
satisfies the assertion. Task 2.6 defines exactly six cases (a)–(f); 6.2's set matches
2.6's set.

**Non-blocking notes from round 2 — all taken.** Decision 6 now carries the
"scope of what the probe closes" paragraph (type contract vs. the grouped PR closing
the wider `frontend`), the `dependencies`-only coverage scoping is justified in prose,
and the `react-redux@9.2.0` → `@types/react: "^18.2.25 || ^19"` edge is recorded in the
Decision 1 `react core` row with an explicit reason not to merge the groups.

**Independent failability audit (the hard evidence rule).** Every claimed check is
failable, not merely parseable:
- Task 1.1 forces a recorded RED transcript naming `fortawesome` against the
  *unmodified* config, and 6.3 re-runs the same command green. That red/green pair on
  one command is the failable core, and it is ordered before the config edit.
- Task 2.4's matcher is constrained to anchor both ends with `*` as sole wildcard, so
  the check cannot pass for the wrong reason via substring matching.
- Task 2.5a's coverage assertion is a real control (it is the one that would have
  caught `react-grid-layout`), and 2.3a pins the `declaredIndependent` allowlist
  verbatim, so the two lists cannot drift silently.
- Task 2.2 forbids a YAML dependency — load-bearing, since root `node_modules` is
  confirmed absent here while the gate must run from a linked worktree.
- The plan does not lean on the Jest gate anywhere (HEL-880 is explicitly cited in
  Decision 3 as the reason for a standalone script).

**Constraint compliance.** Surface is confined to `.github/dependabot.yml`,
`.github/workflows/ci.yml`, `.husky/pre-commit`, root `package.json` scripts block and
the two new `scripts/check-dependabot-groups*.mjs` (tasks 3.x/4.x); 3.4 asserts no
manifest/lockfile/version change; 6.5 forbids `concertino sync`, the HEL-897 e2e spec,
`dependabot-auto-merge.yml`, and any database work. Decision 5 not reopened.
Verified against the live config that the reorder premise is real: `/frontend` declares
`dev-dependencies` before `react`, and all four configs sit at
`open-pull-requests-limit: 10`, so tasks 3.2/3.3 act on true starting state.

**Spec delta.** Three requirements with scenarios that are behavioural and
discriminating (family grouped, unrelated package *not* swept, split config rejected,
stale declaration rejected) — they match the validator tasks rather than restating the
YAML.

### Verdict: CONFIRM

All three round-2 change requests are fixed against ground truth, not merely narrated
as fixed. The plan is implementable as written: every task names a concrete artifact or
command, the evidence chain has a genuine red-before-green pair, and the two rot
directions of the hand-maintained family table are both mechanically enforced. The two
residuals below are wording-level and cannot produce a wrong or unverifiable outcome.

### Non-blocking notes

- `tasks.md:58` (task 7.2) still says "check it against task **4.5**'s local probe".
  Stale cross-reference after the §5 renumber; the intended target is 5.1. Unambiguous
  — there is exactly one local probe in the plan — so it misleads nobody, but fix it
  in passing.
- `design.md:114` still describes the probe as done "in a throwaway working copy",
  which is the pre-CR1 phrasing; `tasks.md` 5.1 supersedes it with the exact
  `--no-save --no-package-lock` in-place recipe. Tasks govern execution, so this is
  cosmetic, but the design prose now describes a different mechanism than the tasks
  and one line would reconcile them.
- Decision 3's prose lists four selftest fixtures; `tasks.md` 2.6 defines six. The
  task list is the operative one and 6.2 asserts against six, so the executor cannot
  build the smaller set — but the design paragraph reads as an older draft.
