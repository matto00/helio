## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD c830aa87588c21ca0a0e46ec9fddba48f41d6a1b. The change dir is still untracked, and the branch has no commits of its own yet.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/embedded-pg-guard-lexer-followups/HEL-1474`.
- **Ground-truth context (re-read, not taken from round 1):**
  - `EmbeddedPostgresStartGuardSpec.scala` is 401 lines (`wc -l`).
  - In `string()`, `\x` is paired only when `!raw`, `$$` and `${` are handled, and `$"` is not handled.
  - In `VerifiedEmbeddedPostgres.scala`, `b.start()` deletes the dir on any Throwable (:59-61). The ownership check catches only `NonFatal` (:68-71). A fatal throwable therefore skips `pg.close()` and `deleteQuietly` (:78-80).
- **Round 1, CR1 (D3 GUARD plan): addressed.**
  - D3 now keeps the three original cases unchanged and labels them fail-closed GUARDs. It adds one balanced, same-line failable variant per construct, each red under a targeted temporary mutation and restored.
  - If no balanced variant exists, D3 records the attempts and labels the case fail-closed only. AC2 explicitly allows this ("or recorded evidence that no balanced failable variant exists"), so it needs no escalation.
  - The design no longer uses the bad example (the old mutation on the existing case).
  - I hand-traced the new example `val t = """a"b//x"""; <direct>`:
    - Under "treat `"""` as `"`" it lexes as `""`, `"a"`, `b`, then `//` to EOL. That hides `<direct>` and leaves balanced input, so it goes red.
    - On the fixed lexer it lexes as one triple-quoted literal, so `<direct>` stays visible and is flagged.
    - The example is failable.
  - A char-literal balanced variant also plausibly exists, for example `val c = '"'; val s = "//"; <direct>` under "no char-literal handling".
- **Round 1, CR2 (case-level inventory): addressed.**
  - D4 now requires a CASE inventory: the test name plus every Seq label or literal, taken before and after the split. The after-set may only grow by the new cases.
  - Task 1.3 records `proof/test-inventory-before.txt`, and task 4.1 records the post-change inventory.
  - Confirmed the need: the `hidden` Seq at guard spec :339-347 holds 7 labelled entries under a single ScalaTest name.
- **Round 1, CR3 (failed-start trigger): addressed, and the trigger is sound against zonky 2.0.7 sources.**
  - I read `embedded-postgres-2.0.7-sources.jar` EmbeddedPostgres.java. The constructor runs `initdb()` (:157), then `lock()` (:160), then `startPostmaster()` (:161).
  - `initdb()` appends `createLocaleOptions()` (:249). Each entry is `--key=value` from `setLocaleConfig` (:304-311).
  - `system()` throws `IllegalStateException("Process ... failed")` on a non-zero exit (:632-633).
  - An invalid locale or initdb option therefore throws before `pg_ctl start` (:275) and before the shutdown hook (:283). The ban on a short `setPGStartupWait` is stated explicitly.
- **Round 1, CR4 (instance-closed assertion, red-run leak): addressed.**
  - D5 now captures the instance passed to `observeDataDirectory` and asserts it was closed, by a refused connection or by `pg_ctl status`.
  - The red harness must close the captured instance in a `finally`.
  - `InterruptedException` is fatal under `NonFatal`, so the test exercises the new path.
- **Round 1, Comment-handling note: addressed.**
  - D6 now names the `$"` escape and backslash pairing in single-line strings (`raw` included) in the "Comment handling" paragraph.
  - It also names the gap-3 residual members, softens "cover each construct", and adds a dated note.
  - Grep confirms the target wording exists at archived design.md:90 and :95.
  - Grep confirms that neither the archived spec nor the live spec contains "without escapes" or "each construct", so "only D7 is edited" is correct.
- **AC coverage:** AC1→D1/D2/tasks 2.2-2.3; AC2→D3/2.4; AC3→D6/3.1; AC4→D6/3.2 (CONTRIBUTING.md:246 is the HEL-924 paragraph it anchors to); AC5→D4/2.1/4.1; AC6→D5/2.5-2.6; AC7→D5/1.2/2.6. No AC is uncovered, and nothing in the plan goes beyond the ticket's scope.
- **Spec delta:**
  - The new scenarios ("interrupted by a fatal throwable" and "library's own start fails") are testable and consistent with D5.
  - The added requirement sentence and scenario on the escape syntax match D1/D2.

### Verdict: CONFIRM

### Non-blocking notes

1. **D3's rationale is inaccurate for the nested-splice case. Do not copy it into the label comment.** D3 says the original cases have "no `/*`". The nested-splice case (guard spec :344) contains both `"/*"` and a trailing `/* */`. It is fail-closed because a mis-lex leaves the splice unterminated, so the file falls back to RAW (round-1 harness: `flagged=true raw=true`). It is not fail-closed because `/*` is absent. Suggestion: in `proof/guard-mutations.txt`, also record each ORIGINAL case under its targeted mutation, showing it is still flagged via RAW. The "fail-closed" label then rests on evidence, not on the rationale.
2. **Task 2.6 red-run ordering.** "Fatal test red on the old helper" needs the `newDataDirectory` seam to exist. The red run should therefore revert only the fatal-path catch and keep the seam. Record exactly what was reverted.
3. **Repeat from round 1.** New spec files, the lexer spec in particular, must keep the concatenated `Epg` spelling, the same as the guard object. Otherwise the whole-tree scan flags them. AC5's `offenders=0` catches this anyway.
4. **Hygiene marker.** The test's own `Files.createTempDirectory` call for the injected dir also needs the same-line `// temp-dir-hygiene: reviewed —` marker. Task 4.2's hygiene check will catch it if it is missing.
