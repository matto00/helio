# Sibling audit (design D5): DraftSaveRaceSpec, DraftSaveSetRaceSpec (and DraftSaveDeadlockSpec's duel/race3 users)

All three specs extend `DraftRaceFixture` and reach the choreography only through `race`, `race3` and `duel`; none builds its own
hooks (`grep -n "parkAfter\|Thread.sleep\|waitFor\|Await\|eventually\|DraftSaveHooks"` on `DraftSaveRaceSpec` and `DraftSaveSetRaceSpec`: no hit).
`RaceSaveHooks` is private to the fixture; `DraftSaveFaultSpec` has its own fault hooks (`failingAt`) that never park.

| Weakness | Where | Shared? | Fix (in the fixture, so every spec gets it) |
| --- | --- | --- | --- |
| `parked` completed at hook-DBIO construction | `RaceSaveHooks.at`, used by `race` (SaveFirst/WriterFirst) and `race3` | Latent for `DraftSaveRaceSpec`/`DraftSaveSetRaceSpec`: they park at `AfterCompare` (`parkAfter = None`), whose hook is built lazily inside a `for`, so construction coincided with execution. Live for `DraftSaveDeadlockSpec` (`parkAfter = Some(<site>)`, eager `afterLock`). | `park` = `DBIO.successful(()).flatMap { signal; DBIO.from(release.future) }` |
| 5000 ms writer/reader/second window decided the verdict | `race` WriterFirst+SaveFirst, `race3` reader wait, `duel` second wait | Yes (all three specs) | condition wait, 60 s hang guard, expiry = `harnessFail` |
| 15 s waits that were notes, not failures (writer reaching gate, save parking, reader stalling, grower finishing) and started the writer anyway | `race`, `race3`, `duel` | Yes | same hang guard; expiry fails; in SaveFirst the writer is NOT started if the save never parks |
| Writer backend lookup `activeBackend(...)` returned only the newest non-idle backend although the participant runs on two pools | `race` SaveFirst, `race3`, `duel` | Yes | `anyWaitsOn(app, target)` over every non-idle backend with that `application_name` |
| "PARKED past its compare" printed for `parkAfter` sites | trace text | DeadlockSpec | trace names the site (`after the <site> lock`) |
| no cross-check that the promise matches Postgres | all parks | Yes | `confirmParked`: save must be `idle in transaction`, held relation locks are traced |
| Commit order of a WriterFirst race inferred from the order the two Futures completed in (`lostUpdate`) | `race` WriterFirst | Yes, and it FIRED in the sibling DraftSaveRaceSpec under load (`dashboard import`, see root-cause.md) | order read from the observed `pg_blocking_pids` wait; Future order only when no wait was seen; basis traced |

`WriterFirst`'s gate-based choreography (the writer held at its first write by the shared advisory GATE) already synchronised on
`pg_locks` (`gateWaiters`) and was not time-based beyond the windows above.
