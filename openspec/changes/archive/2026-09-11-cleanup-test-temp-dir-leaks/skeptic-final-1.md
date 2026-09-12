## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit: `7c1a409757f34e1015951717c9b96dc2e99616b4`
Live-resolved review base: `dcc59552948c98dfac59f7ceab830b890cc6b737` (via `resolve-review-base.sh`, exit status checked)
Diff scope: 53 files, +1043/-102.

All findings below are derived from ground truth I ran/read myself. The executor's
`files-modified.md` and `evaluation-1.md` were read only as claims to refute.

### What I verified (with evidence)

**1. `TempDirectorySupport.afterAll` genuinely re-throws (does not swallow/log).**
Read `backend/src/test/scala/com/helio/testkit/TempDirectorySupport.scala` in full.
`tryDelete` returns `Option[Throwable]` and never throws itself; `afterAll` does
`registered.synchronized(registered.toList).flatMap(tryDelete)` and, if `failures.nonEmpty`,
`throw new RuntimeException(...)` naming the count and messages with `failures.head` as cause —
inside a `try`/`finally { super.afterAll() }`. Confirmed: collect-all-then-re-throw, with
`super.afterAll()` still guaranteed to run. No logging-only path exists. The design-gate
skeptic's correction genuinely landed.

**2. The guard matches all four spellings actually present.**
`scripts/check-test-temp-dir-hygiene.mjs` `SPELLINGS` = `\bFiles\.createTempDirectory\(`,
`\bFiles\.createTempFile\(`, `\bjava\.io\.File\.createTempFile\(`, `\bFile\.createTempFile\(`.
The FQN form `java.nio.file.Files.createTempDirectory(` is covered because `\b` matches at the
`.`→`F` boundary. Ran the guard's selftest fresh: **9 passed, 0 failed, exit 0** — it asserts each
spelling individually, all four in one file (proving the scan doesn't stop at the first hit), both
exemption paths (same-line and line-above), and that a *non-adjacent* reviewed comment does NOT
exempt an unrelated call. Ran the guard against the real migrated tree: `Test temp-dir hygiene
check: clean`, exit 0.

**3. The "59 → 57" recount is legitimate (spot-checked against the base myself).**
`git grep -nE "createTempDirectory|createTempFile"` at `dcc59552` over `backend/src/test/**/*.scala`
returns exactly **59** lines (47 + 12). I filtered for lines whose content begins with `//`, `*`,
or `/*` and got exactly **2**:
- `LocalFileSystemSpec.scala:157` — ``// `Files.createTempFile` — but is not, and is not claimed to be, guarded by``
- `AssistantConversationServiceSpec.scala:28` — `` *  over a `Files.createTempDirectory` temp dir (mirrors ...``

Both are prose with no open-paren call. 59 − 2 = **57 real code sites**. The claim holds; this is
not a count massaged to shrink the migration.

**4. The 3 `// temp-dir-hygiene: reviewed` exemptions are sound, not migration-dodging.**
Read each in context:
- `CsvUrlFetchSpec.scala:55` (`keystoreDir`) — `afterAll` (line 117-121) calls
  `Try(deleteRecursively(keystoreDir))` then `super.afterAll()`; `deleteRecursively` (123-126)
  genuinely recurses and `deleteIfExists`. Real cleanup.
- `DataSourceServiceCsvUrlSpec.scala:82` (`keystoreDir`) — identical pattern at `afterAll`
  140-145 / helper 147-150. Real cleanup. (Its *other* site, `tmpDir`, WAS migrated to
  `newTempDir` — so the exemption is scoped to the genuinely-clean one, not used as a blanket.)
- `LocalFileSystemSpec.scala:208` — `Files.createTempFile(precondDir, ".probe", ".tmp")` where
  `precondDir = tempDir.resolve("d2-precondition")` and `tempDir = newTempDir("helio-fs-test")`.
  The probe is created *inside* a registered tree, so the trait's deepest-first recursive walk
  sweeps it. Sound; separate registration would be redundant.

All three are "already cleaned by construction," each with a grep-visible reason. None avoids work
that was actually needed.

**5. The AC's evidence requirement is present AND independently reproduced (I did not take it on trust).**
`files-modified.md` documents 3982 → 3982 across a full `sbt test`, and names the guard-failability
mutation (a scratch `object Hel1120ScratchMutation` with one bare call of each of the four
spellings, guard exited 1 flagging all four, then reverted). I re-ran the real thing myself:

```
BEFORE=3982
$ sbt -batch test
[info] Total number of tests run: 4246
[info] Suites: completed 277, aborted 0
[info] Tests: succeeded 4246, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] Total time: 303 s
sbt_exit=0
AFTER=3982
```

Zero net growth, full suite green. I also ran a check *stronger* than the executor's, because
their before/after only counted 10 hand-chosen prefixes and would be blind to a leak under any
other prefix:

```
$ find /tmp -maxdepth 1 -newermt '12 minutes ago' | wc -l
0
```

**Zero** `/tmp` entries of *any* prefix were created during the whole 5-minute suite run. This is
self-authenticating (a content/count measurement, not an mtime-ordering inference between
relocated artifacts) and closes the prefix-list gap in the original evidence.

**6. Hook/CI wiring and parity genuinely pass.**
`.husky/pre-commit` and `.github/workflows/ci.yml` each add both `check:test-temp-dir-hygiene` and
`:selftest` immediately after `check:scala-quality`, in the `frontend` job named in `ci-complete`'s
`needs:`. `package.json` defines both scripts. Ran fresh:
`check:precommit-ci-parity` → "OK — every hook script is covered by ci-complete", 20 hook scripts /
20 ci-complete-covered, both new scripts in both lists, exit 0; `:selftest` → 5 passed, 0 failed,
exit 0.

**7. No DB migration.** `git diff --name-only <base>...HEAD | grep -i migration` → NONE. V107
remains unused, as the ticket required.

**Beyond the requested list — AC3's frontend half.** AC3 says sweep *backend and frontend* specs
for `createTempDirectory`/`mkdtemp`. `files-modified.md` lists no frontend findings, and
design.md:37 asserts "premise check found no frontend leak pattern" — an assertion I did not
accept. I grepped and found 6 real `fs.mkdtempSync` sites
(`frontend/src/theme/accentTextClosureGuard.css.test.ts:139/171/193/218`,
`frontend/src/theme/focusRingTokenGuard.css.test.ts:658/684`). Every one is wrapped in
`finally { fs.rmSync(dir, { recursive: true, force: true }) }`. The claim is accurate — there is
genuinely nothing to fix in the frontend. See non-blocking note 1 on the *listing* requirement.

**AC trace**
- AC1 (every temp dir deleted in `afterAll`, including on failure) — met. Trait deletes every
  registered path; `afterAll` fires after each test's own `finally`, verified live by
  `LocalFileSystemSpec`'s two permission-restore tests passing inside my full green run.
- AC2 (before/after `/tmp/helio-*` count across a full `sbt test` must not grow) — met, and
  reproduced by me first-hand (3982 → 3982, plus 0 new entries under any prefix).
- AC3 (sweep backend + frontend, list findings even where nothing changed) — met. 57 backend sites
  triaged (37 files migrated, 3 reviewed-exempt), frontend swept and independently confirmed clean.

### Verdict: CONFIRM

The mechanism that prevents recurrence (shared trait + static guard + selftest, wired into both
pre-commit and CI, with parity enforced) is real and failable, not decorative. The four points
that two prior rounds turned on all survive independent re-derivation from ground truth.

### Non-blocking notes

1. AC3 asks to "list what was found even where nothing needed changing." The backend side does
   this thoroughly, but the frontend finding is compressed into a single design.md clause ("no
   frontend leak pattern") without naming the 6 `mkdtempSync` sites. I verified the conclusion is
   correct, so this is a documentation-completeness nit, not a defect — but naming those 6 sites
   in the PR body would make the AC's "list" requirement self-evident to a future reader instead
   of requiring the re-grep I had to do.
2. `LocalFileSystemSpec.scala:16` mixes in both `BeforeAndAfterAll` and `TempDirectorySupport`
   (which already extends it). Harmless and compiles; droppable in a future tidy-up. (Same nit the
   evaluator raised; I confirmed it is cosmetic — trait ordering is correct everywhere, with
   `TempDirectorySupport` last in every `with` list, and no migrated spec overrides `afterAll`
   without calling `super.afterAll()`. I scanned all of them.)
3. `evaluation-1.md` is currently untracked in the worktree. Not code and not my call, but the
   orchestrator should ensure delivery artifacts land in the commit if that is the convention here.
