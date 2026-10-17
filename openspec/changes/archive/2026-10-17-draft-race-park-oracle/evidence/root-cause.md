# HEL-1654 root cause: (b) a test-harness race. HEL-1629's lock protocol has NO gap.

## Verdict

The orchestrator's lead hypothesis is CONFIRMED by database evidence, not by code reading. `DraftRaceFixture.RaceSaveHooks`
completed its `parked` promise when the hook's DBIO was **constructed**; `PipelineDraftWrites.lockDefinition` constructs the
per-site `afterLock(site)` DBIOs eagerly (the `val panels/advisory/rules/outs = taken(site, ...)` bindings), right after
`hooks.at(Begin)` and **before the first lock statement runs**. So for every `parkAfter = Some(<non-pipeline site>)` the harness
declared the save "parked" while it held no lock at all, started the writer, and a writer that does not need the save's first
lock (the alert evaluator, which never touches `panels`) committed. That is `writer COMMITTED while the save was parked` with
`blockedObserved=false`. (a) a real gap is refuted: whenever the save really is parked, the writer blocks on it.

`PatchSetStale` in the attempt-2 control is NOT used as evidence either way (design-gate note 1).

## Evidence

1. **Unperturbed, old fixture (probe section A, `probe-parked-locks.log.txt`).** `parkAfter = SaveRules`, save genuinely parked:

   ```
   SaveFirst parked-declared (save pid 3600967)
     ACT 3600967 app=race-save state=idle in transaction q=SELECT r.id FROM alert_rules r ...
     LOCK 3600967 alert_rules RowShareLock granted=true   (+ dashboards, panels, pipelines, transactionid ExclusiveLock)
   SaveFirst after writer wait (writer completed=false, waiting=true)
     ACT 3600973 app=race-writer state=active wait=Lock/transactionid blocked_by={3600967} q=insert into "alert_events" ...
     LOCK 3600973 transactionid ShareLock granted=false
   ```
   The save holds the rules lock and the writer is blocked by the save's backend: the protocol works.

2. **Forcing probe, old fixture (section B).** An external session holds `panels.<pa> FOR UPDATE`, so the save's FIRST protocol lock
   (`hel1498_lock_panels`) waits. At the instant the harness declares the save parked:

   ```
   SaveFirst parked-declared (save pid 3601969)
     ACT 3601969 app=race-save state=active wait=Lock/transactionid blocked_by={3601882} q=SELECT hel1498_lock_panels($1..$6)::text
     LOCK 3601969 transactionid ShareLock granted=false        <- NO alert_rules / outputs / pipelines lock held
   SaveFirst after writer wait (writer completed=true, waiting=false)
     ACT 3601975 app=race-writer state=idle q=COMMIT           <- the writer COMMITTED; nothing blocked it
   ```
   Result: `protected: RaceOutcome(SaveFirst, save=200, ..., violation=true, blockedObserved=false)`, trace `save PARKED past its
   compare` / `writer COMMITTED while the save was parked`: the CI signature, with the save provably not holding the lock.

3. **Statistical repro, old fixture, unperturbed, CI-like load** (`repro-under-load.log.txt`): 6 of 15 runs of
   `DraftSaveDeadlockSpec` red (7 failing cases), including the protected evaluator case (run 12) and a `PatchSetStale` control
   (run 7). CI saw 2 of 3; main's push run passed once.

4. **Same forcing probe, new fixture (section C).** `parked` now fires only after the locks are held:
   `save idle in transaction`, `alert_rules/dashboards/panels/pipelines` granted, writer `wait=Lock/transactionid blocked_by={save}`;
   both cases green (`old-vs-new.log.txt`).

## Why it was intermittent

The window between "parked" (construct time) and the save actually holding `alert_rules` is two statements long (panels lock,
pipeline row lock). The writer starts on another thread; on a 2-vCPU runner whether it reaches its INSERT before the save's
statements is a scheduling coin flip. A second, independent weakness: the writer-observation window was a fixed 5000 ms and the
writer backend lookup returned only the latest non-idle backend of two pools; both can flip a protected case to
`blockedObserved=false` on a slow runner.

## Second oracle weakness, found by the proof runs (same fixture, same class: a timing proxy decided a verdict)

After the park fix, 50/50 on `DraftSaveDeadlockSpec` passed, but the first sibling loop (`DraftSaveRaceSpec` + `DraftSaveSetRaceSpec`, 10 runs)
had one red: run 2, `dashboard import` protected WriterFirst (`pre-commitorder-fix/sib-2.log`, line 1261):

```
protected: RaceOutcome(WriterFirst, save=200, writer=ok, violation=true, deadlock=false, blockedObserved=true)
  save (backend 3839965) PARKED past its compare, holding no wait on the writer
  save (backend 3839965) is idle in transaction past its compare, holding relation locks on [alert_rules,dashboards,outputs,panels,pipelines]
  gate released: writer may commit
  writer is WAITING on the parked save
  save: 200 committed; writer: ok            -> true was not equal to false (DraftSaveRaceSpec.scala:210)
```
Postgres showed the writer waiting on the parked save, so the writer committed AFTER the save (a valid serialization, no lost update). The
verdict `violation=true` can only come from `lostUpdate` (no "COMMITTED while the save was parked" note, no `serialCheck` on that writer), which
took "the writer committed first" from the order the two Futures completed in. The save's Future completes after more steps than its commit,
so on a loaded runner the (faster) writer's Future completed first. This is pre-existing (the old fixture computed it identically) and independent
of the park signal. Fix: the commit order is read from the observed lock wait (`saveWaitedOnWriter` => writer first, `writerWaitedOnSave` =>
save first); only when neither wait was observed does it fall back to Future completion order. The trace now prints which basis was used.
All proof runs below were redone on the fixture with both corrections.

## Release exposure

None. See `release-exposure.md`: v0.9.8 = 29cb0a60f; 544bd79ea is not an ancestor; no V137 in the v0.9.8 tree; no release tag contains it.
Production behaviour is unchanged by this ticket (test-fixture change only).

## Database used

The race specs do not use a local Postgres: every spec boots its own zonky embedded Postgres in a temp data directory
(`TwoUserRlsApiFixture`, `VerifiedEmbeddedPostgres`), so nothing touched the shared `helio` DB or any server on the machine.
No `helio_hel1654` database was needed, so none was created.
