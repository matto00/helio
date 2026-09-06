# Mutation evidence — HEL-846

Per design.md Decision 2a: every planted credential-shaped value below was
written **only** into an untracked, `.gitignore`d `.hel846-`-prefixed scratch
file (`openspec/.hel846-plant.md`,
`docs/.hel846-plant.md`, `notes/.hel846-plant.md`), never into this tracked
file. What's pasted below is the gate's own stderr, which names `file:line`
and the convention hint only — it never echoes the matched value (verified in
`checkSecretLiterals`/`checkDeliverySecrets`). Where the planted value itself
must be described, it is elided.

Planted values used throughout (never real credentials, never written here):

- **Vendor-shaped plant**: `helio_pat_` followed by 72 characters of a
  repeated, obviously-synthetic hex-shaped filler (`a1b2c3d4e5f6` x6) —
  carries no synthetic marker.
- **High-entropy plant**: a 44-character run of the letter `a`, assigned to
  `API_KEY=` — carries no synthetic marker.

## 1. Baseline (task 1)

```
$ npm run check:no-credential-leak
check-no-credential-in-agent-surface: OK (82 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 0 violations)

$ npm run check:no-credential-leak:selftest
... (all cases ok) ...
check-no-credential-in-agent-surface.selftest: OK
```

## 2. Marker widening is strictly more permissive (task 2.4)

Re-ran after widening the marker set / adding `_`→`-` normalization: gate and
selftest both still green, unchanged counts (confirmed separately below once
the new surfaces are also added).

## 5.1 — AC1 red-then-green, vendor rule (all three surfaces)

### openspec/

```
$ node scripts/check-no-credential-in-agent-surface.mjs
check-no-credential-in-agent-surface: FAIL

  - openspec/.hel846-plant.md:2: contains a hardcoded vendor-prefixed credential-shaped literal — carry a synthetic marker (e.g. "should-never", "dummy") or elide the value before committing

1 violation(s). ...
EXIT:1
```

After removing the plant:

```
$ node scripts/check-no-credential-in-agent-surface.mjs
check-no-credential-in-agent-surface: OK (5969 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 5864 delivery-evidence, 15 docs, 8 notes, 0 violations)
EXIT:0
```

### docs/

```
$ node scripts/check-no-credential-in-agent-surface.mjs
check-no-credential-in-agent-surface: FAIL

  - docs/.hel846-plant.md:2: contains a hardcoded vendor-prefixed credential-shaped literal — carry a synthetic marker (e.g. "should-never", "dummy") or elide the value before committing

1 violation(s). ...
EXIT:1
```

Removed → green (same OK line as above).

### notes/

```
$ node scripts/check-no-credential-in-agent-surface.mjs
check-no-credential-in-agent-surface: FAIL

  - notes/.hel846-plant.md:2: contains a hardcoded vendor-prefixed credential-shaped literal — carry a synthetic marker (e.g. "should-never", "dummy") or elide the value before committing

1 violation(s). ...
EXIT:1
```

Removed → green (same OK line as above).

## 5.2 — AC1 red-then-green, high-entropy rule

Plant: `API_KEY=` + 44-char alphabet-pure filler, under `openspec/`.

```
$ node scripts/check-no-credential-in-agent-surface.mjs
check-no-credential-in-agent-surface: FAIL

  - openspec/.hel846-plant.md:2: identifier "API_KEY" is assigned a high-entropy credential-shaped value — carry a synthetic marker (e.g. "should-never", "dummy") or elide the value before committing

1 violation(s). ...
EXIT:1
```

Removed → green.

## 5.3 — Marker convention holds, including underscore normalization

Same high-entropy plant carrying `-dummy` suffix → gate stayed green (OK
line, 5970 files scanned, 0 violations).

Same plant carrying an underscore-separated marker (`...should_never`) →
gate stayed green (OK line, 5970 files scanned, 0 violations).

Temporarily removed the `_`→`-` normalization (`value.toLowerCase()` instead
of `value.toLowerCase().replaceAll("_", "-")`) with the underscore-marker
plant still in place:

```
$ node scripts/check-no-credential-in-agent-surface.mjs   # normalization removed
check-no-credential-in-agent-surface: FAIL

  - openspec/.hel846-plant.md:2: identifier "API_KEY" is assigned a high-entropy credential-shaped value — carry a synthetic marker (e.g. "should-never", "dummy") or elide the value before committing
  - openspec/changes/credential-shaped-string-commit-guard/design.md:46: identifier "CONNECTOR_MASTER_KEY" is assigned a high-entropy credential-shaped value — carry a synthetic marker (e.g. "should-never", "dummy") or elide the value before committing
  - openspec/changes/credential-shaped-string-commit-guard/skeptic-design-1.md:30: identifier "CONNECTOR_MASTER_KEY" is assigned a high-entropy credential-shaped value — carry a synthetic marker (e.g. "should-never", "dummy") or elide the value before committing
  - openspec/changes/credential-shaped-string-commit-guard/skeptic-design-2.md:41: identifier "CONNECTOR_MASTER_KEY" is assigned a high-entropy credential-shaped value — carry a synthetic marker (e.g. "should-never", "dummy") or elide the value before committing
  - docs/cloud-dev-setup.md:54: identifier "CONNECTOR_MASTER_KEY" is assigned a high-entropy credential-shaped value — carry a synthetic marker (e.g. "should-never", "dummy") or elide the value before committing

5 violation(s). ...
EXIT:1
```

This also independently confirms design.md Decision 2's claim that
normalization is what removes the live `CONNECTOR_MASTER_KEY =
REPLACE_WITH_OUTPUT_OF_openssl_rand_dash_base64_32` false positive in
`docs/cloud-dev-setup.md`, plus incidentally caught three of this very
change's own design/skeptic artifacts quoting that same doc line — all of
which pass again once normalization is restored, confirmed below.

Restored normalization → gate green again (verified byte-identical restore
via `diff` against the pre-mutation copy). Removed the plant → green.

## 5.4 — Each new surface is genuinely scanned (checked for all three; openspec/ shown here, docs/ and notes/ produce the analogous drift line)

Planted vendor-prefix value under `openspec/`, then removed the
`delivery-evidence` entry from `SURFACES`:

```
$ node scripts/check-no-credential-in-agent-surface.mjs   # delivery-evidence entry removed, plant present
check-no-credential-in-agent-surface: FAIL

  - COVERAGE DRIFT: top-level directory "openspec" is not classified as covered, partial, or acknowledged-unscanned. Add it to a declared surface's root (SURFACES), to PARTIAL_COVERAGE with the scanned subtree and a reason, or to ACKNOWLEDGED_UNSCANNED with a one-line reason.
EXIT:1
```

Both required observations hold: the run **still fails**, but for the drift
reason only — the vendor-prefix violation itself is never reported (the
credential is no longer detected as a credential). Restored the `SURFACES`
entry → green (OK line, unchanged counts). Repeated for `docs` (removing the
`docs` entry) and `notes` (removing the `notes` entry): both produced the
identical shape — `COVERAGE DRIFT: top-level directory "docs"/"notes" is not
classified...`, and the vendor-prefix violation was absent from stderr in
both cases. Removed plants → green.

## 5.5 — The check is genuinely dispatched

With the vendor-prefix plant in place under `openspec/`, removed
`"deliverySecret"` from the `delivery-evidence` surface's `checks` array
(replaced with `["importGraph"]` so `assertSurfacesValid`'s non-empty
requirement still holds):

```
$ node scripts/check-no-credential-in-agent-surface.mjs   # deliverySecret removed from checks
check-no-credential-in-agent-surface: OK (5970 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 5865 delivery-evidence, 15 docs, 8 notes, 0 violations)
EXIT:0
```

Silent pass — exactly the HEL-956 CR1 silent-no-op class. Restored the
`checks` array.

Separately, restored `checks` but removed `deliverySecret` from the
`needsText` disjunction only:

```
$ node scripts/check-no-credential-in-agent-surface.mjs   # deliverySecret removed from needsText only
check-no-credential-in-agent-surface: OK (5970 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 5865 delivery-evidence, 15 docs, 8 notes, 0 violations)
EXIT:0
```

Same silent pass. Restored both mutations, removed the plant → green.

## 5.6 — Vacuity guard covers the new surfaces

Used the mutated-copy harness convention rather than renaming a tracked
directory (design.md/tasks.md explicitly forbid renaming `openspec/`).
Pointed the `notes` surface root at a nonexistent path on a mutated copy
(`scripts/.hel846-selftest-mutated-surfaces.mjs`, `.gitignore`d):

```
$ node scripts/.hel846-selftest-mutated-surfaces.mjs
check-no-credential-in-agent-surface: FAIL

  - COVERAGE DRIFT: top-level directory "notes" is not classified as covered, partial, or acknowledged-unscanned. Add it to a declared surface's root (SURFACES), to PARTIAL_COVERAGE with the scanned subtree and a reason, or to ACKNOWLEDGED_UNSCANNED with a one-line reason.
  - VACUOUS SURFACE: "notes" (root notes-hel846-nonexistent) matched zero files. A surface matching nothing means its root has moved, been renamed, or been deleted — fix the surface's root, or remove it from SURFACES and reclassify the directory in the coverage-drift guard.
EXIT:1
```

Both drift and vacuity fire, naming the surface and its (nonexistent) root.
Removed the mutated copy; control run on the shipped script → green.

## 5.7 — `assertSurfacesValid` still holds for the new entries

Unrecognized check name (`"deliverySecretTypo"` on the `notes` entry):

```
$ node scripts/.hel846-selftest-mutated-checks.mjs
file:///.../scripts/.hel846-selftest-mutated-checks.mjs:499
        throw new Error(
              ^
Error: SURFACES: surface "notes" declares unrecognized check "deliverySecretTypo" — known checks are: importGraph, credentialProp, bcrypt, email, secretLiteral, deliverySecret
    at assertSurfacesValid (...)
EXIT:1
```

Duplicate id (`docs`/`notes` entries both given id `"docs"`):

```
$ node scripts/.hel846-selftest-mutated-checks.mjs
file:///.../scripts/.hel846-selftest-mutated-checks.mjs:490
      throw new Error(`SURFACES: duplicate id "${surface.id}" — every surface id must be unique`);
            ^
Error: SURFACES: duplicate id "docs" — every surface id must be unique
    at assertSurfacesValid (...)
EXIT:1
```

Both throw before any scan runs. Removed the mutated copies; control run on
the shipped script → green (OK line, unchanged counts).

## 6 — AC2: zero false positives on the real tree (task 6)

Worktree, no plants present:

```
$ node scripts/check-no-credential-in-agent-surface.mjs
check-no-credential-in-agent-surface: OK (5969 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 5864 delivery-evidence, 15 docs, 8 notes, 0 violations)
```

Main checkout (the modified script copied temporarily into
`/home/matt/Development/helio/scripts/.hel846-maincheckout-test.mjs`, run,
then removed — main checkout never left modified; `git status --short`
confirmed clean afterward):

```
$ node scripts/.hel846-maincheckout-test.mjs
check-no-credential-in-agent-surface: OK (5977 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 5872 delivery-evidence, 15 docs, 8 notes, 0 violations)
```

(File counts differ slightly from the worktree run because the two
checkouts' `openspec/changes/**` trees differ in content at the moment of
measurement — both are green with 0 violations, which is what this
comparison is for.)

Named legitimate cases confirmed present and passing (the overall 0-violation
runs above already prove none of these trip the gate):

- `helio_pat_xxxxxxxx` in `helio-mcp/src/config.ts:28` and
  `helio-mcp/README.md:38` — confirmed via `grep -n`.
- `helio_pat_<valid-token>` spec placeholders in
  `openspec/changes/archive/2026-07-12-dependabot-codeql-security-fixes/specs/{csrf-protection,request-authentication}/spec.md` —
  confirmed via `grep -rn`.
- `sk-ant-SECRET-SHOULD-NEVER-LEAK-xyz` present in the HEL-401 archive and
  two other files — confirmed via `grep -rl`; all pass (carries the
  `should-never` marker).

Wall-clock runtime: pre-change `time` of the unmodified gate against the
3-surface baseline was not separately timed (the OK-line-only baseline in
task 1 predates this measurement); post-change (6 surfaces, 5969 files):
`real 0m0.479s` (`user 0m0.427s`, `sys 0m0.088s`) — well under the "under a
second" estimate in design.md Risks.

## 7.4 — Mutation-verify the self-test itself

Disabled `checkDeliverySecrets` dispatch in the shipped script
(`if (false && surface.checks.includes("deliverySecret")) checkDeliverySecrets(...)`)
and ran the full self-test:

```
$ node scripts/check-no-credential-in-agent-surface.selftest.mjs
...
case: removing '_'->'-' normalization on a mutated copy -> the same underscore marker goes red
  FAIL - removing normalization turns the underscore-marker case red
...
check-no-credential-in-agent-surface.selftest: FAIL (9 failure(s))
```

9 of the new HEL-846 self-test assertions failed once the check was
disabled — confirming the self-test genuinely proves the check is live, not
merely present. Restored the shipped script (confirmed byte-identical via
`diff` against the pre-mutation copy) and re-ran:

```
$ node scripts/check-no-credential-in-agent-surface.selftest.mjs
...
check-no-credential-in-agent-surface.selftest: OK
```

## Cycle 2 (evaluation-1.md CR1) — plant path staleness fix

`evaluation-1.md` CR1 found that the original plant path,
`openspec/changes/credential-shaped-string-commit-guard/.hel846-plant.md`, is
tied to this change's own in-flight directory, which `/opsx-archive` moves.
The evaluator reproduced a crash (`ENOENT` on `writeFileSync`) by renaming
that directory to its archive path and running the self-test.

**Fix:** planted at each surface's permanent root instead —
`openspec/.hel846-plant.md`, `docs/.hel846-plant.md`,
`notes/.hel846-plant.md` — none of which is tied to any change's name or
lifecycle. Updated the matching `.gitignore` entry in the same commit. Added
a `writeHel846Plant` helper that calls `mkdirSync(dirname(path), {
recursive: true })` before every write, as a belt-and-braces guard against
the same defect class recurring at a nested path in the future.

**Re-ran the full self-test after the fix — all HEL-846 cases pass** (see
the full transcript excerpt below; every prior mutation in this file was
also re-run against the corrected `openspec/.hel846-plant.md` path and
produces the identical shape of result, now updated throughout this file).

```
$ node scripts/check-no-credential-in-agent-surface.selftest.mjs
...
case: baseline is green before planting a vendor-prefix secret under openspec/
  ok - baseline exits 0
case: planted vendor-prefix credential under openspec/ -> FAIL
  ok - planted vendor-prefix credential under openspec/ fails the gate
  ok - failure names the planted file and the vendor-prefixed message, never the matched value
case: removing the planted openspec/ vendor-prefix credential -> PASS
  ok - gate passes again after removal
...
check-no-credential-in-agent-surface.selftest: OK
```

**Re-ran the evaluator's exact archive-rename simulation** — renamed
`openspec/changes/credential-shaped-string-commit-guard/` to
`openspec/changes/archive/2026-09-05-credential-shaped-string-commit-guard/`
and ran the self-test against that state:

```
$ mv openspec/changes/credential-shaped-string-commit-guard openspec/changes/archive/2026-09-05-credential-shaped-string-commit-guard
$ node scripts/check-no-credential-in-agent-surface.selftest.mjs
...
check-no-credential-in-agent-surface.selftest: OK
SELFTEST_EXIT:0
```

No crash — the self-test completes and passes green with the change
directory moved aside, exactly the scenario the evaluator used to reproduce
the original defect. Renamed the directory back immediately;
`git status --short` afterward showed only the expected pre-existing
modifications, with the moved directory's tracked contents byte-identical
(no diff reported for any file inside it).

## 10.4a — Final self-check: this change's own committed artifacts pass

Re-ran the finished gate against the finished change directory with all
plants removed and no mutated copies present:

```
$ node scripts/check-no-credential-in-agent-surface.mjs
check-no-credential-in-agent-surface: OK (5969 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 5864 delivery-evidence, 15 docs, 8 notes, 0 violations)
```

`mutation-evidence.md` itself (this file) contains no unelided
credential-shaped value — every planted value described above is described
by shape only, and every literal quoted from the gate's own stderr is
file:line-and-message only (verified: the gate's failure messages never
echo the matched value, by inspection of `checkSecretLiterals` and
`checkDeliverySecrets`, and by the assertions in the self-test cases above
that explicitly check the matched value is ABSENT from stderr).
