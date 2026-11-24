## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 80bf27cb705334fb3c5ef7fc7fa756bdfdc509d8. The base was resolved live with `resolve-review-base.sh`: d4e59f00629852df6debf9cc988c0c8a183483a4.

### What I verified (with evidence)

**The diff, read in full.** `git diff d4e59f006...HEAD` covers 36 files. The production changes are:

- **Backend:**
  - `PipelineScheduleService.find` now authorizes with `pipelineRepo.findByIdShared(pipelineId, Some(user))`, then reads with the new `PipelineScheduleRepository.findByPipelineIdInternal` (`withSystemContext`, documented as authorized-caller-only).
  - `put` and `delete` are unchanged and still use `findByIdOwned`.
  - I read `findByIdShared` (PipelineRepository.scala:83-107). It admits the owner, or a caller with a `resource_permissions` row of type `pipeline`, and returns `None` for anyone else. So a stranger and an unknown id both still get 404.
- **Client:**
  - **Header gating:** `PipelineSpineHeader` and `MobilePipelineHeader` gate the schedule menu items and the interactive chip on `canEdit && isOwner`. Everyone else gets `<SpineScheduleChip readOnly>`, which is a `span` with the `--static` modifier, no handler and no tab stop, and renders nothing when there is no schedule.
  - **Dialog:** `PipelineDetailDialogs` opens the schedule dialog only when `scheduleOpen && canEdit && isOwner`.
  - **Toggle:** the toggle guard in `usePipelineSourceScheduleActions` is now keyed on `isOwner`.
  - **Fail-closed defaults:** the chip defaults to `readOnly = true`, and `isOwner` is false until both the pipeline and the user are known.
- **Other write paths:** I grepped `frontend/src` for `savePipelineSchedule`, `deletePipelineSchedule`, `setScheduleOpen` and `onToggleScheduleEnabled` outside tests. The only remaining write entry points are the dialog (now owner-gated), the toggle hook (now owner-gated) and the two headers' menu items and chip (now owner-gated).
- **Contract and docs:** the schema change is to the description only. The response shape is unchanged and carries no owner id. The CLAUDE.md route line states the rule.

**AC trace:**

1. *The access rule is decided, and server and client agree for owner, editor and viewer.* **Met.**
   - Server: GET goes through `findByIdShared`; PUT and DELETE go through `findByIdOwned`.
   - Client: writes are gated on `isOwner`, and grantees get the read-only chip.
   - Both match the owner ruling: read all, owner writes.
2. *No grantee gets a control whose save the server refuses.* **Met.**
   - Every client write entry point is gated on `isOwner`.
   - My e2e run confirms that an editor sees no "Add schedule" (`hel1794` editor test, and `hel1837` desktop and phone).
3. *Tests for each role, on the route and in the UI.* **Met.**
   - `PipelineScheduleRoutesSpec` "pipeline schedule access by role" covers:
     - the owner's GET, PUT and DELETE;
     - an editor and a viewer: GET 200 with a body identical to the owner's and no owner or grantee key, GET 404 when there is no schedule, PUT 404 with the schedule unchanged, PUT that creates nothing, DELETE 404 with the schedule kept;
     - a stranger: 404 on GET, PUT and DELETE;
     - an unknown id: 404.
   - Jest adds the `granteeSchedule` tests for spine and mobile, the chip tests and the dialog gating test.
   - There is a new e2e, `hel1837`.

**Gates, re-run fresh by me on the lane DB `helio_hel1837`:**

- **Backend:** `sbt -J-Xmx3g testOnly PipelineScheduleRoutesSpec PipelineScheduleServiceSpec` exited 0 with `Tests: succeeded 57, failed 0`. Every HEL-1837 test is listed in the log as passing. Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1837/skeptic-final-sbt.txt`.
- **Jest:** the `pipelines/ui/spine` and `pipelines/ui/mobile` directories, plus `PipelineDetailDialogs.memo`, `PipelineDetailPage.spine` and `PipelineDetailPage`, ran with 3 workers and exited 0: 29 of 29 suites and 374 of 374 tests passed. Log: `.../scratch/HEL-1837/skeptic-final-jest.txt`.
- **e2e:** `hel1837-grantee-schedule-chip` and `hel1794-viewer-read-only` ran with 2 workers on port 7269 and exited 0, with 6 passed. Log: `.../scratch/HEL-1837/skeptic-final-e2e.txt`.

**Changes to existing tests:**

- I read the diff of every pre-existing test the branch touches. Each one moves the existing owner-path tests onto an explicit owner store, or flips an assertion as the ruling requires:
  - the editor's "Add schedule" is now `toHaveCount(0)`;
  - the viewer gets an assertion that the chip is a `span`.
- None of these weakens a check.
- The phone test's Share assertion changed from absent to present because that test now runs as the owner. That is correct for the owner.

**Red-first evidence:**

- `red-run.txt` records 5 backend tests and 11 jest tests failing before the implementation, plus three mutation results (M1 to M3).
- I did not re-run the mutations, because as the skeptic I may not modify code. They are consistent with the tests I read: M2's barrier, the explicit ownerId JOIN in `findByPipelineId`, is exactly what the grantee service tests exercise.
- Under the lane rules, the red run travels inside the implementation commit. That is accepted.

**UI judgment.**

- I took fresh screenshots from my own e2e run and looked at them myself. Persisted copies:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1837/evidence/e2e-evidence/HEL-1837/editor-desktop-light-chip.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1837/evidence/e2e-evidence/HEL-1837/viewer-desktop-dark-chip.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1837/evidence/e2e-evidence/HEL-1837/editor-phone-dark-chip.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1837/evidence/e2e-evidence/HEL-1837/viewer-phone-light-chip.png`
- **Reuse:** the read-only chip uses the existing `spine-header__chip` pill, with the same border token, mono `--text-xs` type and muted colour as the owner's chip. No new literal values were added; the only additions are `cursor: default`, scoping the hover rule with `:not(--static)`, and `content: none` on the phone tap overlay.
- **Placement:** it sits where the owner's chip sits, on desktop and on phone, and on phone it sits under "View only" for a viewer.
- **Theme parity:** light and dark are consistent.
- **Paused state:** the "Paused" marker keeps its italic muted style.
- **Verdict:** reusing the state pill matches the sibling status chips, so it is not an off-pattern one-off.

### Verdict: CONFIRM

### Non-blocking notes

- **Pre-existing chip behaviour, not introduced here.** At a 1280 px desktop width with the context list open, `viewer-desktop-dark-chip.png` shows "next Nov 24, 02:06 PM" while the expression is clipped to nothing. The cause is the `max-width: 26ch` chip, the `flex: none` next-run sub-label, and the ellipsized `chip-text` (HEL-1579 CSS, which this branch does not change). The owner's chip has the same classes and content, so the owner sees it too.
  - It matters a little more now: for a grantee this chip is the only place the schedule shows, apart from the `title` tooltip.
  - Candidate follow-up for triage: give `chip-text` a minimum width, or drop the next-run text before the expression.
- **Task 3.0 is still open.** The base "Schedule bar" requirement in `pipeline-schedule-config-ui` still says the chip is never hidden. The owner-qualified wording is deliberately deferred to the archive step, and the archive must carry it.
- `evaluation-2.md` is untracked in the worktree (`git status`), so it needs committing at delivery.
