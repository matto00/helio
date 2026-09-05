## Skeptic Report — design gate (round 2, skeptic-design-1.md)

### What I verified (with evidence)

- Read `proposal.md`, `design.md`, `tasks.md`, and `specs/url-backed-source-run-refresh/spec.md` in full from the
  current worktree tree.

1. **Proposal/design contradiction on Decision 4 (CR1)**: `proposal.md`'s Non-goals section now explicitly states
   "The engine DOES write refetched bytes back to storage for `image` alone — see design Decision 4 — because an
   image row references its bytes by `storageKey` rather than carrying them inline. `text`/`pdf`/`csv` run paths
   stay read-only." This directly cross-references and agrees with `design.md` Decision 4's rationale. No remaining
   "no write-back" language conflicts with it. Contradiction genuinely gone, not softened.

2. **Spec requirement + scenario for write-back (CR2)**: `specs/url-backed-source-run-refresh/spec.md` contains a
   dedicated Requirement, "A re-fetched image source's stored bytes are replaced atomically," with three scenarios:
   newest-bytes-readable-at-`storageKey`, concurrent-reader-never-sees-partial-file, and
   failed-write-leaves-no-temp-file. These are concrete, testable, and go beyond a bare assertion — they name the
   specific hazards (torn read, temp litter) the atomicity change must close.

3. **Non-atomic-write hazard analysis (CR3)**: `design.md` Decision 4 explicitly analyses the hazard: "Because that
   write now fires on every run rather than only on a user-initiated refresh, `LocalFileSystem.write` is made
   atomic... The temp file is cleaned up on failure so a failed write does not litter the uploads tree." The Risks
   section also records the coordinator's verification that no other in-flight run touches `LocalFileSystem`
   (HEL-844/868/914 excluded), closing the concurrent-write contention question raised by the prior CR3.

4. **Coordinator ruling — atomic write, same-directory constraint, no trait/GCS change**: Confirmed in three
   places — `proposal.md` Impact ("no `FileSystem` trait change, no GCS change"), `design.md` Decision 4 ("This is
   confined to `LocalFileSystem.write`'s body: the `FileSystem` trait is unchanged, and `GcsFileSystem` needs no
   change"), and `tasks.md` 3.3a ("Do not change the `FileSystem` trait or `GcsFileSystem`"). The same-directory
   requirement for `ATOMIC_MOVE` is stated three times: design.md ("a temp file under `/tmp` or any other mount
   silently degrades to a copy, leaving the torn-read hazard intact"), spec.md requirement body ("staged in a temp
   file in the SAME directory as the target"), and tasks.md 3.3a ("in the same directory as the target").

5. **Non-vacuous atomicity test guard**: `tasks.md` 4.5a requires "Atomicity guard that FAILS if `write` reverts to
   a bare `Files.write` — assert the temp-and-move behaviour itself... A test that only asserts the final bytes
   would pass against the non-atomic implementation and is not acceptable as this guard." This explicitly forecloses
   the vacuous-test failure mode the coordinator required be avoided.

6. **Hard run constraints unchanged**: No Flyway migration (explicit non-goal, tasks 5.1 verifies `db/migration/`
   untouched), no browser automation (design Non-Goals), and the excluded files
   (`WorkspaceContextService.scala`, `PipelineService.scala`, `api/protocols/patchsets/**`, `helio-mcp`, REST
   connector fetch path, schema inference) are listed as untouched in design Non-Goals and re-verified in tasks 5.2.

### Verdict: CONFIRM

All three prior change requests and the coordinator's subsequent ruling (keep write-back, atomic
`LocalFileSystem.write`, same-directory temp file + `ATOMIC_MOVE`, no trait/GCS change, non-vacuous atomicity test)
are genuinely reflected across proposal.md, design.md, the spec, and tasks.md — not merely asserted in one place
and silently absent elsewhere. No further design-gate objections.

### Non-blocking notes

- None.
