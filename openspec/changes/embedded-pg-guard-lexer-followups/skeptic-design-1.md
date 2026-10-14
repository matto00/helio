## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD c830aa87588c21ca0a0e46ec9fddba48f41d6a1b (the change directory is untracked, so no commits on the branch yet).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/embedded-pg-guard-lexer-followups/HEL-1474`.
- **Context claims in design.md:** confirmed. `EmbeddedPostgresStartGuardSpec.scala` is 401 lines. `string()` at :79-95 pairs `\x` only when `!raw` (:90) and handles `$$` (:91) and `${` (:92) but not `$"`. `VerifiedEmbeddedPostgres.scala` is 97 lines. `b.start()` deletes the dir on any Throwable (:59-61). The ownership check catches only `NonFatal` (:68-71), so a fatal throwable skips `pg.close()`/`deleteQuietly`. `SOFT_BUDGET = 250` (check-scala-quality.mjs:70). The archived design's "`raw"..."` without escapes" (design.md:90) and "cover each construct" (:95) are present.
- **scalac 2.13.15 escape facts (D1): CONFIRMED by compiling.** I compiled a scratch file with the cached `scala-compiler-2.13.15.jar` and ran it:
  - `s"a $" b"` gives `[a " b]`
  - `raw"a\"b // c"; val after = 42` gives `[a\"b // c] len=9`, and `42` prints, so it lexes as one literal followed by code
  - `s"""x $" y"""` gives `[x " y]` (`$"` is valid in triple-quoted strings too)
  - `raw"a\\"; ...` gives `[a\\]` and `raw"q\x\"z"` gives `[q\x\"z]`, so `\x` pairs with any next character in raw. D1(b), "pair `\x` in every single-line string, raw included", matches scalac.
- **D2 red/green (simulated):** I copied the guard object (spec :1-239) into a scratch harness, with flags for the two fixes and three mutations, and ran `violations`:
  - Pre-fix: `dollar-quote` and `raw-bsq` are both `flagged=false` (RED). Their accept twins are `flagged=false`, which is correct.
  - With both fixes: both are `flagged=true` and the accept twins stay unflagged. The proposed reject/accept cases and one-line fixes behave as designed.
- **GUARD mutations (D3 / AC2): FAILS.** See CR1. In the harness, none of the three original GUARD cases turned red under the natural targeted mutations:
  - triple-quoted case under "treat `"""` as `"`" (the design's own example): `flagged=true`
  - nested splice case under "no recursion into nested `${`": `flagged=true raw=true`
  - char-literal case under "no char-literal handling": `flagged=true raw=true`

  Structural reason: in the triple-quoted case (spec :343) and the char-literal case (:345), the direct start sits on its own line, and the input contains no `/*`. The lexer blanks only `//`-to-EOL and block comments, and it never strips string contents. So no lexer mis-lex can hide line 2. A mis-lex either leaves the token visible or goes unbalanced and falls back to RAW, which is fail-closed and still flagged. Archived skeptic-final-4.md:69 makes the same observation ("Multi-line hiding fails closed"). A simple "same-line" rewrite is not enough either: I tried `s"${f("""a"b//x""")}"; <direct>` and `s"${f('"', "//")}"; <direct>`. Under their mutations both went RAW and stayed flagged, because the `//` eats the splice's closing `}`. A case that can go red has to stay balanced after the mis-lex.
- **zonky 2.0.7 (D5/AC7 groundwork):** I read `embedded-postgres-2.0.7-sources.jar` EmbeddedPostgres.java:
  - The constructor runs `initdb()` (:157), `lock()` (:160) and `startPostmaster()` (:161).
  - `startPostmaster` launches `pg_ctl -w start` without checking its exit status (:275) and registers a JVM shutdown hook (:283). It then calls `waitForServerStartup`, which throws `IOException("Gave up waiting…")` after `pgStartupWait` (:335).
  - So a start that throws in `waitForServerStartup` has already launched a postmaster that the caller has no handle on. The design's suggested trigger, "short `setPGStartupWait`", is the one route most likely to leave a live postmaster whose data dir the helper then deletes. See CR3.
- **Spec delta:** the MODIFIED requirement text diffs cleanly against `openspec/specs/backend-embedded-postgres-isolation/spec.md`. The third requirement (RLS) is untouched and correctly omitted. The scenarios are testable.
- **Seam shape (D5):** a defaulted `newDataDirectory: () => Path` on `private[testkit] startWith` is the right shape. The builder is by-name and zonky mutates it, so the test cannot otherwise learn the attempt's directory, and scanning `java.io.tmpdir` for `epg*` would race other suites. `check-test-temp-dir-hygiene.mjs:33` requires the `// temp-dir-hygiene: reviewed —` marker on the same line as the call, so the default must keep the marker on that line. Task 4.2 runs the check, so this is covered.
- `InterruptedException` is fatal under `scala.util.control.NonFatal`, so the proposed fatal test actually exercises the new path.

### Verdict: REFUTE

### Change Requests

1. **D3 / task 2.4: the GUARD-mutation plan cannot satisfy AC2 for 2 of the 3 cases, and the design's example mutation does not turn its case red (verified above).**
   - Revise D3 to state the structural fact. The triple-quoted (:343) and char-literal (:345) cases put the direct start on a separate line with no `/*` in the input, so no lexer mutation can hide it.
   - Specify what the executor does about it. Recommended: keep each original case unchanged and add a balanced, failable variant per construct, then show it red under a named targeted mutation. Example: a top-level `val t = """a"b//x"""; <direct>` turns red under "treat `"""` as `"`" without going unbalanced. The executor still has to find and prove balanced forms for the nested-splice and char-literal constructs.
   - Also say what happens if no balanced failable form exists for a construct: record it as a fail-closed guard with the RAW-fallback evidence and escalate on AC2. Do not invent a mutation outside the construct, such as breaking `//` handling itself.
   - Drop "treat `"""` as `"`" as the example mutation for the existing triple-quoted case.
2. **D4 / task 1.3 / 4.1: the test inventory is too coarse to catch a lost case.** The cases being moved are entries inside `Seq`s (for example the 7-entry `hidden` Seq at :339-347), not ScalaTest test names, so a before/after diff of test names cannot show that one was dropped. The inventory must list every case label or string per test, before and after. The after-set must equal the before-set plus the new cases, with the three GUARD entries shown at their new location.
3. **D5 / task 2.6: the failed-start test must use a failure that cannot leave a postmaster behind, and must say so.** zonky starts the postmaster (:275) and registers a shutdown hook (:283) before `waitForServerStartup` can throw (:335). A "short `setPGStartupWait`" trigger can therefore leave a running postmaster on a deleted directory in the shared test JVM. Prefer a failure before `startPostmaster`: initdb failing through an invalid locale config, or `lock()` failing. Otherwise the test must prove that no postmaster survives, for example that its port refuses connections afterwards. Record the chosen trigger and its zonky line in `proof/zonky-start-failure.txt`.
4. **D5 / task 2.6: the fatal-path test must also prove `pg.close()` ran (AC6 says "closes the attempt's instance").** As designed it asserts only that the throwable is the same object and the dir is gone. Capture the instance passed to `observeDataDirectory` and assert it is stopped, for example that a fresh connection to its port fails, or that a second `close()` is a no-op through zonky's `closed` flag. Also, the red-against-pre-fix run of this test leaks a live postmaster. The red demonstration must close it explicitly, for example in a `finally` in the throwaway red harness, so the run does not contaminate the forked group.

### Non-blocking notes

- New spec files (the lexer spec in particular) must use the same concatenated spelling (`"Embedded" + "Postgres"`). Otherwise the whole-tree scan flags them. D4 says this only for the guard object.
- D6: the archived "Comment handling" paragraph (design.md:90) lists `$$` among the handled constructs. When it is corrected, it should also list `$"` and raw `\x` pairing, not only drop "without escapes".
- The new `$"` rule sits in `string()` beside `$$`. Order does not matter, since they are disjoint on the next character.
