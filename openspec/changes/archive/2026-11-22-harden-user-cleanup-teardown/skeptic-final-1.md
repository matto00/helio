## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `b1f9768c85674017e4c9212a499a2ba3e9c575db` against live base `5af3a438c33ce494272162f7d3c1e2df9c6d2c7d`
(resolved with `resolve-review-base.sh main origin`, exit 0). Scratch output:
`/home/matt/Development/helio/.concertino/scratch/HEL-1817/skeptic-final/`.

### What I verified (with evidence)

**Item 1 (teardown order). AC met.**
- I read `e2e/support/userCleanupRun.cjs` at HEAD. Once `psql(sql, label)` returns, root resolution (including the lazy
  `require("./db.cjs")`, `readBackendEnv`, `resolveUploadsRoot` and `conversationFolderPaths`) runs inside a try/catch.
  A failure there counts every record as failed. Each folder's `isSymlink`, `lstatOrNull` and `remove` call sits in its
  own try/catch. The only statements left outside a try after the commit are the `deps.*` default assignments, which
  cannot throw, and the `log(...)` call. With the default `console.log` I found no realistic synchronous throw from the
  log call. `deleteRegistryRun` then calls `rmSync(dir)` before it throws on `failed > 0`. A psql throw still propagates
  before any folder work, so the directory is kept.
- Every new failure message carries only a count. I checked all four:
  - the log line `<label>: removed R of N conversation folders, F failed`;
  - the throw `userCleanup: F of N conversation folders could not be removed (...run scripts/prune-orphan-conversation-folders.mjs...)`.
    It names only a script path, never a user id or an uploads path;
  - the seam check detail `{failed}`;
  - the landing-captures line `F conversation folders not removed`.
- Red first: I extracted commit `b12a634ab` (the red selftests over the base production code) with `git archive` into
  scratch and ran it myself. Result: `54 passed, 8 failed`. The "run:" cases fail because the remove error escapes with
  a path. The "registry:" cases fail because `deleteRegistryRun` is not yet a function. At HEAD the same file gives
  `62 passed, 0 failed` (`userCleanup-selftest.txt`).
- I ran my own mutations on a scratch copy of HEAD:
  - throwing before `rmSync`: 3 registry cases FAIL;
  - adding the records to the throw message: the count-only assertion FAILs, and it caught the leaked ids.
- "Next run accepts the state": the case "a second run on the cleared dir returns 0 without calling psql" passes.

**Item 2 (prune credentials). AC met.**
- `credentialEnv` is pure. It was extracted verbatim from `dbConnection`, so `dbConnection`'s behaviour is unchanged.
- The prune script reads only `process.env.DB_USER`/`DB_PASSWORD`, and it does not read `backend/.env`. It passes
  `credentialEnv(...)` as the psql env and adds both values to `secrets` for psql's scrub and for its own catch.
- The fake-psql selftest is red at `b12a634ab` (`16 passed, 2 failed`) and green at HEAD (`18 passed, 0 failed`).
  The success and failure output never contains either sentinel, the URL or the database name.
- My mutation that drops `password` from `secrets` makes "CLI failure output redacts..." FAIL, and the sentinel
  password appears in the output. So the selftest guards the scrub. No new code prints a URL or a credential.

**Item 3 (split). AC met.**
- I compared the base `LocalFileSystemSpec.scala` (442 lines) with the concatenation of the four new files (100, 200,
  82 and 118 lines), as a multiset of stripped non-blank lines:
  - 0 base lines are missing;
  - the only added lines are package and imports, the class headers and doc comments, the per-suite
    `ec`/`tempDir`/`fs`/`await` scaffolding, the `should {` wrappers and closing braces.
- Test names: 23 before and 23 after, the same multiset. Base order is preserved within each suite:
  - Spec 8;
  - AtomicWrite 4;
  - Prune 6;
  - FromEnv 5.
- I re-ran the four suites myself with
  `sbt -J-Xmx3g 'set Test / javaOptions += "-Duser.home=<scratch>/home"' testOnly <4 suites>`. Exit 0,
  `Tests: succeeded 23, failed 0`. `<scratch>/home/.helio/uploads` exists afterwards (`sbt-lfs.txt`).
- The committed `split-counts-before.txt` and `split-counts-after.txt` record 23 and 23.
- The design said three suites and the build has four (`LocalFileSystemAtomicWriteSpec`, added to stay under the
  250-line budget). This is disclosed in `files-modified.md` and `split-counts-after.txt`, and it does not change
  behaviour.
- The comment update in `ClaudeConfigSpec` is correct: the env helpers now live in `LocalFileSystemFromEnvSpec`.

**Other gates (re-run by me):**
- `npm --prefix helio-mcp run typecheck`: exit 0.
- `tsc --noEmit -p e2e/tsconfig.json`: exit 0.
- `prettier --check` on every changed JS/TS/MD file: clean.

**Scope:** every changed file maps to one of the three items or to the change artifacts. No product code changed, and
there is no API or schema impact. There are no UI changes, so I skipped the design and visual step.

**Evidence and mtime:** my verdict rests on content diffs, selftest output and test counts. It does not rely on any
mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes
- The red state for the five "registry:" cases is `delReg is not a function`, a missing export, not a behavioural red.
  The behaviour is still guarded at HEAD: my mutation (throwing before `rmSync`) turns those cases red.
- The fake psql in failure mode echoes PGUSER and PGPASSWORD but not the URL. URL redaction on that path rests on
  psql's existing `secrets` scrub, which the older "never prints the connection string" case covers.
- `landing-captures/run.mjs` still logs `deleted throwaway user <id>`. That line predates this change and is outside
  this ticket.
