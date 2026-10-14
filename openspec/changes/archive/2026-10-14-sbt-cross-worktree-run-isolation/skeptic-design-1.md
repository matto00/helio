## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `e056f4708a5a52bb82c6d2ad5cd0a70c4d73cd90`. The change dir is untracked (planning artifacts only). No sbt was run, per the binding constraints.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/sbt-cache-cross-worktree-replay/HEL-1595`.
- **The orchestrator's planning-time facts, checked against ground truth:**
  - `backend/project/build.properties` is `sbt.version=2.0.9`. Confirmed.
  - `backend/.sbtopts` is only `-Dsbt.ivy.home=.ivy2`. Confirmed.
  - `command -v sbt` is `/home/matt/.local/bin/sbt`, which is sbt-extras (header "A more capable sbt runner... Paul Phillips"). It contains no client logic: `grep -i client` finds nothing. Unknown args such as `--client` go through `addResidual` to the launcher. The design's description is accurate.
  - `Test / testGrouping := Def.uncached {` is at build.sbt:219, and `workingDirectory = Some((Test / baseDirectory).value)` at :226. Confirmed.
  - MISTAKES.md:281 records the HEL-1442 "cache key omits sys.env" entry. MISTAKES.md:319 records the unverified HEL-1374 attach entry, whose "Invocation used" is `sbt -batch -Dsbt.server.autostart=false "testOnly ..."`. Confirmed.
  - The HEL-1446 skeptic report (line 44) says both runs reported `cache 100%, 644 disk cache hits`, and that the bad run passed 8079/0 with process cwd confirmed via `/proc` as HEL-1446/backend. The design's conclusion that "cache 100%" is not the discriminator is correct.
- **D1 is feasible (the deferred property name exists).** I grepped `main_3-2.0.9.jar` (in the `~/.sbt/boot` and coursier caches, read-only) for the key names. It contains `localCacheDirectory` (7 occurrences) and `sbt.global.localcache` (2 occurrences). So a repo-scoped or scratch relocation of the disk cache is plausible, and leaving the exact name to the executor, with the stated "did it take effect" check, is acceptable.
- **The spec delta targets an existing capability.** `openspec/specs/sbt-worktree-isolation/spec.md` exists (it is about Ivy). An ADDED requirement on it is valid. The proposal lists it as "Modified Capabilities", which is consistent.
- **AC coverage:**
  - AC1 (reproduce, cache location and keys) is covered by tasks 1.1–1.5.
  - AC2 (fix plus red-first) is covered by 2.1–2.2.
  - AC3 (non-reproduction: investigate what the skeptic saw) is covered by 1.6.
  - AC4 (MISTAKES entry, CLAUDE.md note, HEL-1374 reconciliation) is covered by 3.1–3.3.
  - The driver constraints are restated: no home-cache change, escalate if the fix is user-level, never signal HEL-1451's processes, and shut down only the run's own server.
  - No placeholders or TODO/TBD.

### Verdict: REFUTE

The plan is mostly sound. However, its reproduction matrix leaves out the one condition the original observation actually had, and the deliverable depends on that matrix. The likely outcome is a bounded non-reproduction. That bound is only meaningful if it covers the observed condition.

### Change Requests

1. **Add a concurrent-run matrix step (design.md D2, tasks.md 1.3–1.5).** The ticket and the HEL-1446 report describe the foreign-path run as happening alongside a *concurrent* HEL-1451 worktree. Every planned step is either serial (step 1: B green, *then* A; step 2: A cold then warm) or idle-server (step 3: B's server is live, but nothing says B is executing a task). The plan never has B actively building or testing against the shared cache while A loads and runs. Write–read races are timing-dependent, and they are the most plausible remaining cache mechanism given that sbt 2 symlinks `target/out` into the shared disk cache (MISTAKES.md:204). Examples of such a race: CAS/action-cache entries, symlinked outputs, or logged output being written by one process while another reads them.
   - **Required:** a step where A's `testOnly` (cold build load) starts while B's run is in progress against the same scratch cache. Run it several times (state N), serially otherwise. Keep it within the memory caps: two tree JVMs at the default `HELIO_TEST_JVM_XMX`, `nice -n 19`.
   - The MISTAKES entry (D4/3.1) must then list this step among the tested conditions. If you deliberately exclude it, state that as an explicit untested gap.
2. **Spec scenario "Another tree's live sbt server does not serve tree A's run" names an ambiguous invocation.** "The repo's documented invocation" currently has two candidates: CLAUDE.md's bare `sbt testFull`, and MISTAKES.md:331's `sbt -batch -Dsbt.server.autostart=false`. Design D2 step 3 also tests plain `sbt` and `sbt --client`.
   - Name the exact invocation(s) the scenario holds for.
   - If `sbt --client` is shown to attach to a foreign server, either exclude it from the requirement or carve it out explicitly. As written, a `--client` attach could be read either as a spec violation or as out of scope.
3. **Move the cheap forensic step ahead of the expensive matrix (D2 step 4 / task 1.6), or at least make it unconditional.** First check the HEL-1446 event log and timestamps against HEL-1451's run window: was HEL-1451 running sbt during the skeptic's first run, and with which command? That costs nothing, and it decides whether the concurrent step (CR1) or the server-attach step (3) is the primary hypothesis. Today it runs only "if none reproduce". In that position it cannot inform the matrix, and a partial reproduction would skip it entirely, even though AC3 asks for exactly this explanation.

### Non-blocking notes

- D1 should state the fallback if neither `localCacheDirectory` nor `sbt.global.localcache` verifiably relocates the cache: escalate rather than run experiment tree B against `~/.cache/sbt`. The Risks line ("a run that wrote to the home cache is still ordinary sbt use") reads as permission to continue, and that conflicts with the ticket's "Experiments use a cache directory scoped to the worktree or the session scratchpad".
- Spec scenario 1 says tree B has an "identical build" and A has "the same build plus one failing test". The AC says "at different code". That is fine, because the failing test makes them differ. But step 1 could also diff a main-source change, since identical main sources legitimately hit content-keyed compile cache entries, which may carry B's absolute paths in replayed warnings. Record which printed lines come from a cache replay and which are freshly logged.
- Tree B lives in the session scratchpad. Task 4.1 deletes it and the scratch cache. Make sure that deletion uses exact paths recorded at creation (MISTAKES/feedback: destructive ops need exact paths).
