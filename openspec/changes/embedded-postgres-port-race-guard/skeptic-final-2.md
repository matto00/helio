## Skeptic Report — final gate (round 2, skeptic-final-2.md)

I reviewed HEAD `2d49fc3e8509709e76d7b9d9924a835c01a76a57`. I resolved the base live with `resolve-review-base.sh` as `6902b57f12a18042daf9b8e4984cc55b2011fc84`. Since round 1 (`feaa10b6e`), the only backend change is `EmbeddedPostgresStartGuardSpec.scala`; the rest of the delta is change-dir artifacts. The change is test-only, so there is no UI and step 4 does not apply.

### What I verified (with evidence)

**Q1: can the helper hand a test a foreign cluster? No.** I read `VerifiedEmbeddedPostgres.scala:44-87` and zonky 2.0.7's `EmbeddedPostgres.java` source myself.

How the helper works:
- Every attempt calls `setDataDirectory` with a fresh `Files.createTempDirectory("epg")`.
- Before the instance is returned, the server's `SHOW data_directory` is compared with `realDir` or `plainDir`.
- If the comparison fails, or the observer throws, the instance is closed and its own dir is deleted.
- zonky's `close()` (`EmbeddedPostgres.java:382-412`) is `pgCtl(dataDirectory, "stop")` and only addresses `-D`, never a port.
- If `Builder.start()` throws, the error propagates after the dir is deleted. This is the accepted D4 behaviour.

Attacks I tried:
- **A foreign cluster reporting our dir.** This would need our unique, live temp dir, so it is impossible.
- **A reused builder.** `setDataDirectory` is overwritten on each attempt, and `setPort(0)` resets zonky's mutated `builderPort` (lines 577-579).
- **Split address families.** The JVM resolves `localhost` the same way for SHOW and for every later connection.

I found no path where a foreign cluster is returned.

**Migration (AC2, C1).** I re-ran `verify-embedded-postgres-migration.py 6902b57f1`: `base occurrences: 226 wrapped: 226 unwrapped: 0 inserted imports: 221`, `RESULT: PASS`. `git grep io.zonky` outside `backend/src/test/scala` hits only `build.sbt`, and there are no Java test sources, so the scan root covers every caller.

**Fresh targeted run (mine).** I ran `nice -n 19 sbt -batch -Dsbt.server.autostart=false -J-Xmx3g "testOnly ...VerifiedEmbeddedPostgresSpec ...EmbeddedPostgresStartGuardSpec"` from the worktree.
- The log names this worktree's project, and both suite headers and all 13 test names appear.
- `Suites: completed 2, aborted 0` and `Tests: succeeded 13, failed 0`.
- It contains 0 `TESTS FAILED` / `*** FAILED` / `RUN ABORTED` / `*** ABORTED` lines.
- The guard is green on the real tree and is not vacuous (>100 files; it finds the helper and a migrated user).

**Round-1 CRs.**
- `zonkyImport` now captures a `{...}` block across newlines (`:28`), and the rename regex is `EmbeddedPostgres\s*=>\s*(?!_)` (`:56`).
- The three spellings are in the reject list (`:124-126`).
- Exemptions are by exact path (`:71-76`, tested at `:156-162`).
- `proof/final-1-guard-rename-red-green.txt` shows red (`*** 1 TEST FAILED ***`) and then green. My probe confirms `{EmbeddedPostgres=>Pg}` is now flagged.

**AC1, AC4, AC5, AC6, AC7.** Nothing in the helper, the regression spec, the RLS paths or the 221 migrated files changed since round 1, which traced these ACs with fresh evidence. Round 1's parity, RLS-mutation and loop verification therefore still applies, and I had no concrete reason to doubt it, so I did not re-run testFull.

**AC8** is a PR-body delivery step, and no PR exists yet.

**Q2: can a realistic spelling bypass the guard? Yes. This is the REFUTE.** I extracted the guard object from HEAD (lines 1-77, with only the scalatest import dropped; byte-checked with `diff`). I compiled it with scalac 2.13.15 alongside probe files, against `embedded-postgres-2.0.7.jar`. Every probe file compiled (class files produced). I then ran `offendersIn("com/helio/x/<file>", text)` on each one:

| Probe | Source (compiles) | Guard result |
|---|---|---|
| B1 | `import io.zonky.test.db.postgres.embedded.EmbeddedPostgres._` then `builder().start()` | `Vector()` (clean) |
| B2 | `import ...embedded.EmbeddedPostgres.{builder => b}` then `b().start()` | `Vector()` |
| B3 | `import ...embedded.EmbeddedPostgres.start` then `start()` | `Vector()` |
| B4 | plain `import ...embedded.EmbeddedPostgres`, then `import EmbeddedPostgres._` inside the object, then `builder().start()` | `Vector()` |
| B5 | `` `EmbeddedPostgres`.builder().start() `` | `Vector()` |
| B6 | `PreparedDbProvider.forPreparer(p).createDataSource()` | `Vector()` |
| Control | `EmbeddedPostgres.builder().start()` | flagged |
| Control2 | `{EmbeddedPostgres=>Pg}` + `Pg.builder().start()` | flagged |

Evidence: `ref=/home/matt/Development/helio/.concertino/runs/HEL-1445/evidence/.concertino/runs/HEL-1445/evidence/skeptic-final-2-guard-static-import-probe.txt`. `violations()` is a pure function, so these results are deterministic and do not depend on tooling.

Why B1-B4 count as realistic:
- Importing a Java class's static members (`import X._`, `import X.member`, `import X.{m => n}`) is an ordinary Scala idiom.
- D7's own stated reason for banning the package wildcard is "a wildcard would let `builder` be referenced unqualified". A member import of `EmbeddedPostgres` does exactly that, one level down.
- `import EmbeddedPostgres._` (B4) does not even start with the zonky package, so `zonkyImport` never sees it.

How the bypasses get through:
- `builderRef` needs the literal `EmbeddedPostgres.builder`.
- `staticStart` needs `EmbeddedPostgres.start(`.
- The import rules only inspect selectors right after `embedded.`.
- An unverified start written in any of these spellings leaves `bad shouldBe empty` green, so AC3's "fails on any direct embedded-Postgres start outside the helper" is not met.

### Verdict: REFUTE

### Change Requests
1. **`EmbeddedPostgresStartGuardSpec.scala:28,52-57`: reject any member import from `EmbeddedPostgres`.** Flag any import whose path reaches `EmbeddedPostgres` followed by `.` (whitespace and newlines allowed, with or without the `io.zonky...embedded.` prefix). For example, flag `import` + `[\w.\s]*` + `EmbeddedPostgres\s*\.` (with `_`, `*`, `{...}`, `builder` or `start` after it). This covers B1-B4.
   - Make sure the rule still accepts the plain `import io.zonky.test.db.postgres.embedded.EmbeddedPostgres` and the multi-selector `{EmbeddedPostgres, ...}` form.
   - An alternative closes every spelling at once: a bytecode-level guard that scans the compiled test classes for call sites of `EmbeddedPostgres.builder`/`EmbeddedPostgres.start`/`EmbeddedPostgres$Builder.start` outside `com/helio/testkit/VerifiedEmbeddedPostgres*`, while keeping the per-line exemption. Either approach is acceptable. Pick one and justify it in design.md D7.
2. **Add B1-B4 to the reject list at `:115-129`, red-first.** Show them red against the current implementation, then green after the fix, and record the transcript in `proof/`. Add the plain import and a `{EmbeddedPostgres, Other}` selector to the accept list, so the new rule cannot over-match.
3. **Close B6 or rule it out in writing.** Either add a rule rejecting imports of zonky's other cluster-starting entry points (`PreparedDbProvider`, `EmbeddedPostgresRules`, `EmbeddedPostgresExtension`, `PreparedDbExtension`, `SingleInstancePostgresExtension` and the similar classes in the jar), or record in D7 a decided, named exclusion explaining why these are out of scope.
4. **Optionally cover B5.** A backtick-quoted identifier (`` `EmbeddedPostgres` ``) is a deliberate evasion rather than an accident. Handle it if it costs one regex tweak (allow an optional backtick around the name in each pattern); otherwise list it in D7 as an accepted residual.
5. **Re-run gates.** Re-run the guard and the helper spec in a fresh sbt JVM, judged by log, and re-run `verify-embedded-postgres-migration.py`. As before, a testFull re-run is not needed, because only the guard spec changes.

### Non-blocking notes
- `resolve-review-base.sh` returned `6902b57f1`, while the local `main` log shows a later `5ba82b39f` (HEL-1468). The merge base is unaffected, but the PR should be checked for drift and conflicts against current `origin/main` before merge.
- AC8: the PR body must say HEL-1470 is fixed by this PR.
- The red transcript shows only the first failing case, because the reject test is a single `foreach`. The new cases would be more legible as separate `in` blocks or with a collected list of non-flagged cases.
