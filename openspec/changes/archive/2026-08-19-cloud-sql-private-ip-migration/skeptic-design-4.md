## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Targeted re-check of the human-directed resolution to round 3's blocking finding
(CR7). Round 3 already ran a fresh full-plan pass; this is not a repeat of that —
it is a focused, rigorous check of the one resolution (design.md Decision 4c +
tasks.md task 5.3b + the task 6.1 update) against ground truth.

### What I verified (with evidence)

- Read `infra/deploy-backend.sh` directly (17 args → `gcloud run deploy helio-backend
  --image=... ... --project=helio-493120`, no trailing arg forwarding), not the
  orchestrator's description of it. Confirmed the script's actual final line (`cat -A`,
  lines 30–32) is `--project=helio-493120` with **no** trailing `\` — it is genuinely
  the terminating line of the multi-line invocation, exactly as design.md Decision 4c /
  task 5.3b assume.
- Re-verified round 3's "zero pre-existing positional-param handling" claim myself:
  `grep -n '\$@\|getopts\|\$1\b' infra/deploy-backend.sh` → no hits. Also checked
  `infra/.env.deploy.example` (the file the script `source`s before the `gcloud`
  invocation) for any `set --`/`$@` that could clobber positional params before they
  reach the append point → no hits, so sourcing `.env.deploy` cannot interfere with
  `"$@"` reaching the `gcloud` call.
- Read `design.md` Decision 4c (lines 82–98) and `tasks.md` task 5.3b (lines 50–53) and
  the updated task 6.1 (line 64) in full, in their current on-disk state.
- **Did not just reason about the fix abstractly — simulated it.** Copied the real
  `deploy-backend.sh` to a scratch dir, applied the literal edit task 5.3b describes
  (appended `\` to the `--project=helio-493120` line, added a new `"$@"` line after
  it — the only way to "append `"$@"` to the end of the invocation" given the file's
  actual structure), stubbed `.env.deploy` and replaced `gcloud` with an argv-dumping
  shim on `PATH`, then ran the modified script under the real `set -euo pipefail`
  header two ways:
  - **No extra args** (simulating task 8, an ordinary future deploy): produced exactly
    the same 17 args, in the same order, as the unmodified script — byte-for-byte
    identical `gcloud` invocation. Exit code 0, no `set -u` unbound-variable error from
    the empty `"$@"` expansion.
  - **`--no-traffic`** (simulating task 6.1, the cutover deploy): produced the same 17
    args plus `--no-traffic` as arg 18. Exit code 0.
  - Separately confirmed in isolation (bash 5.3.15, matching this script's
    `#!/usr/bin/env bash` shebang) that `"$@"` under `set -euo pipefail` with zero
    positional parameters does not trigger a nounset error — positional parameters are
    specially exempted from `set -u`, unlike ordinary unset scalars or (pre-4.4 bash)
    empty arrays, which is the usual footgun people associate with this pattern.

### (a) Does the `"$@"` passthrough syntactically and correctly solve the stated problem?

Yes, confirmed by direct simulation, not just reasoning. Appending `"$@"` (quoted, so
each forwarded argument survives as its own word rather than being word-split/re-globbed)
as a new line continuation after the script's actual last flag (`--project=helio-493120`)
is syntactically sound bash and gcloud accepts trailing flags appended after all other
named flags without issue. `./infra/deploy-backend.sh --no-traffic` reaches `gcloud run
deploy` as `--no-traffic` appended after `--project=helio-493120`, which is exactly the
mechanism Decision 4 needed and round 3 found missing.

### (b) Does task 8's "ordinary future deploys are unaffected" claim hold?

Yes, confirmed empirically above: zero extra args → `"$@"` expands to nothing, and the
resulting `gcloud` invocation is identical to today's. No behavior change for any
existing/future caller that doesn't pass extra flags.

### (c) Any other gap this specific fix introduces or leaves open?

None found that rises to blocking:

- The unrestricted nature of the passthrough is a *generic* footgun (any future caller
  could append a flag that collides with an already-hardcoded one, e.g. accidentally
  overriding `--allow-unauthenticated`, and gcloud's argparse takes last-flag-wins) —
  but this is the explicit, already-documented tradeoff of the human's chosen option
  (Decision 4c literally frames the passthrough as "a generically useful capability...
  not a one-off hack scoped only to this migration"), not an undisclosed side effect
  the resolution introduced silently. Not a design defect; noting as non-blocking.
- No interaction with `--set-env-vars`'s custom `^|^`-delimited value: that flag is
  entirely self-contained earlier in the fixed argument list; `"$@"` is appended after
  it and cannot corrupt or reorder it (confirmed in the simulated argv dump — arg 9 is
  untouched).
- `source .env.deploy` (with `set -a; ...; set +a`) runs before the `gcloud` invocation
  and does not reset `$@` — `set -a`/`set +a` only toggle the export attribute on
  variable assignments, and sourcing a plain `VAR=value` file (confirmed via
  `.env.deploy.example`, no `set --` present) cannot touch positional parameters.
  Confirmed no interference.
- task 5.3 (VPC-connector flags, `--add-cloudsql-instances` removal) and 5.3b both edit
  the same file but are independent edits — order between them doesn't matter since
  both land before task 5.4 (tests) and task 6 (deploy).

### Verdict: CONFIRM

Round 3's CR7 is resolved. The `"$@"` passthrough (design.md Decision 4c, tasks.md task
5.3b) is syntactically correct as specified, verified by direct simulation against the
actual script rather than by inspection alone, and introduces no new gap that would
block execution.

### Non-blocking notes

- Task 5.3b's instruction ("append `"$@"` to the end of the gcloud run deploy
  invocation") doesn't spell out that this requires adding a trailing `\` to the
  now-not-last `--project=helio-493120` line before the new `"$@"` line — this is
  standard-enough bash multi-line-command editing that I don't consider it a design gap
  requiring another revision, but flagging in case the executor wants it made fully
  explicit.
- Carrying forward round 3's already-noted non-blocking items (date-label off-by-one,
  task 5.3's `--add-cloudsql-instances` removal-vs-flag punt, task 6.3 privileged-pool
  endpoint specificity) — not re-litigated here, still non-blocking, unchanged by this
  round's narrower scope.
- Environmental, repeated from round 3: this worktree's `scripts/concertino/` is still
  a stale/partial copy (missing `next-report-number.sh`, `persist-evidence.sh`,
  `emit-event.sh`, etc.). I again invoked the main checkout's copies directly by full
  path rather than guessing a fallback filename.
