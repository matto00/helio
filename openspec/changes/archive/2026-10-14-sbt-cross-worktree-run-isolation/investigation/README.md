# HEL-1595 investigation: can sbt 2 `testFull` report another worktree's results?

Verdict: NOT REPRODUCED. 0 of 5 concurrent-race repeats, 0 serial cache-replay runs, 0 server-attach runs showed a
foreign path or a foreign result. No build change is needed or made. All transcripts are in `transcripts/`
(ANSI stripped; the two testFull logs are trimmed to head/key lines/tail).

Setup (paths recorded for exact-path deletion, constraint C2): tree A = this worktree; tree B =
`/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/HEL-1595/treeB` (whole-repo
`git archive HEAD`, no `.env`); shared experiment cache =
`/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/HEL-1595/cache`
(via `-Dsbt.global.localcache`, see cache.md). Ordinary sbt use also wrote the user coursier cache, `~/.sbt/boot`
and `~/.config/sbt/2/server/<hash>/` (one dir per tree that ran a server); none was cleaned up.

| Step | What ran | Outcome |
|---|---|---|
| 0 forensics | events.jsonl of both lanes | forensics.md: HEL-1451 had a live `sbt run` from 05:05:54, inside the skeptic's window |
| 1.2 | B `testFull` (no probe) | EXIT 0, 8083 tests, 0 failed (1.2-B-testFull) |
| 1.3 | B passes probe, then A (same class name, failing assert) `testOnly` and `testFull` | A failed, EXIT 1, 1 failed / 8083 succeeded; `cache 100%, 644 disk cache hits` printed anyway (1.3-*) |
| 1.4 | A cold (target + project/target removed) and warm vs the full shared cache | project lines and build.sbt warnings name A only; no B path (1.4-*) |
| 1.5 | live B server, A: (a) bare `sbt`, (b) `-batch -Dsbt.server.autostart=false`, (c) `--client` | A's project lines name A, probe failed, EXIT 1 in all three. (c) started A's OWN server (session-only observation: a different socket hash; the transcript evidence that it did not attach is 3.2-c's `starting sbt server in the background` plus A's project lines and failed probe), shut down with `--client shutdown` from A's dir (3.*) |
| 1.7 (added cycle 3) | `testFull` in B (cold, fresh cache) and, once B had executed tests, `testFull` in A with the failing probe, overlapping test execution (~13 min each) | A: EXIT 1, 8083 ok / 1 failed, own paths, 0 foreign lines; B: EXIT 0, 8084 ok (5.*-concurrent-testFull) |
| 1.6 | N=5 concurrent: B cold compile in progress (550 main + 659 test sources, ~79 log lines in), A cold started 3 s after, same shared cache | 5/5: A's paths name A, A's marker class printed `marker-A-n`, A failed EXIT 1, B passed EXIT 0, 0 foreign-path lines in either log (4.*) |

Findings that matter for HEL-1374 / C3:
- A command-mode `sbt "<cmd>"` starts NO server: `project/target/active.json` never appeared while
  `sbt 'eval Thread.sleep(45000)'` ran. That `ls`/`cat` output was observed in the session but not captured in
  3.0-B-sbt-sleep-default (sbt stdout only). That a live `sbt run` behaves the same is INFERRED, never observed.
  The shell-mode server's `active.json` content is printed in the session only; the hash comparison was
  session-only (3.1-B-procs.txt holds process lines only; cite 3.2-c). Nor did `--server` (a launcher no-op here). A server
  exists only in shell mode (`sleep N | sbt`, transcripts 3.0-B-sbt-shell-server) or after `sbt --client`. B's
  `sbt run` itself exited on boot (no `.env`: Flyway "no PostgreSQL user name", 3.0-B-sbt-run), so the foreign
  server was modelled with the shell-mode JVM (pid/pgid in 3.1-B-procs.txt; its `active.json` was session-only), shut down
  with `sbt --client shutdown` from B's `backend/`, and its leftover `sleep` wrapper group signalled by recorded pgid.
- The server socket is keyed by project directory (separate hash per tree), and `active.json` is read from the
  invoking directory's `project/target`, so a client cannot find another tree's server by cwd.

Best-supported explanation of the skeptic's observation (INFERENCE, labelled): a `loading project definition from
<tree>` and `set current project ... build file:<tree>` line is printed freshly by the sbt JVM from its own base
directory; the cache holds no log text and no absolute tree paths (cache.md), so a replay cannot produce it. The
transcript the skeptic read was therefore most likely produced by a JVM whose base directory really was HEL-1451's,
e.g. output of another lane's run surfaced through a shared/fixed-name log or an earlier command in the same shell,
not a cache hit or a server attach. This was not reproduced and cannot be tied to a specific cause from the
records (no timestamp or command for the bad run exists). The `cache 100%` line was a red herring: it appears in
every run, including the one that failed its tests.

Untested conditions (the concurrent `testFull` pair was run in cycle 3, row 1.7): a live detached `sbt run` backend in the other tree (what HEL-1451 ran in the window; B's `sbt run`
died at boot and C3 forbids supplying `.env`), the real `~/.cache/sbt` (forbidden), a native sbtn thin client binary (only `sbt --client` via
sbt-extras exists here), and a source of foreign paths outside sbt (shared log files).

Note: the `MARKER=marker-<tree>-<n>` line stands in for `target/out` symlink provenance in the race repeats (the
marker class was compiled from that tree's own source and printed by that tree's test).
