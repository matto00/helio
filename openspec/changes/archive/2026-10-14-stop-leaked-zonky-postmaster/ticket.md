# HEL-1586: zonky 2.0.7: a start that throws after pg_ctl start leaves a postmaster alive on a deleted data dir (VerifiedEmbeddedPostgres)

## Description

Found while delivering HEL-1474 (helper nits, AC7). Evidence (moved to main):
`openspec/changes/archive/2026-10-13-embedded-pg-guard-lexer-followups/proof/zonky-start-failure.txt`.

In zonky embedded-postgres 2.0.7, `EmbeddedPostgres`'s constructor runs `startPostmaster()`: `pg_ctl -w start`
(EmbeddedPostgres.java:275), registers a shutdown hook (:283), then `waitForServerStartup` can throw `IOException`
(:335). The constructor then throws, so the caller never receives the instance and cannot `close()` it. The
postmaster and the lock-file stream live until JVM exit (the shutdown hook stops it then).

`VerifiedEmbeddedPostgres.startWith` catches a throwing `b.start()` and deletes the attempt's data directory — from
under that still-running postmaster. Effects: a postmaster running on a deleted dir holding a port; no test currently
observes this, and the HEL-1474 failed-start test deliberately uses an initdb-time failure (:157, before the
postmaster) to avoid it.

Possible directions (decide in planning): on a throwing start, run `pg_ctl -D <dir> stop -m immediate` for the
attempt's own dir (never by port) before deleting it; or leave the dir in place when the postmaster may have
launched. Must keep the HEL-1445 rule that a discarded attempt never addresses a foreign cluster.

origin_kind: followup
origin_ticket: HEL-1474

## Acceptance Criteria (derived; ticket gives directions, planning decides)

1. When zonky's start throws after the postmaster was launched on the attempt's own data directory, the helper stops
   that postmaster by addressing only that directory (`pg_ctl -D <dir> stop -m immediate`; never by port, process
   name, or PID search) before deleting the directory, and the library's original error still propagates.
2. No process stop anywhere in the fix or the tests addresses a cluster the attempt did not create (HEL-1445 rule).
3. A red-first regression test reproduces the leaked postmaster deterministically via a fault injected after the
   postmaster launch (not timing), fails on the pre-fix helper, and passes with the fix, asserting no postmaster is
   left alive for the attempt's own directory.
4. Proof (red/green + `ps`/`pg_ctl status` evidence for the attempt's own dir only) is recorded under the change's
   `proof/` directory; the zonky line citations are re-verified against the 2.0.7 sources jar.
5. Existing VerifiedEmbeddedPostgresSpec and EmbeddedPostgresStartGuardSpec scenarios still pass.

## Driver safety constraints (binding)

- Any process stop addresses ONLY the attempt's own data directory. Never stop by port, name pattern, or PID search.
- Never use pkill, pgrep or killall; never signal a parent/grandparent process.
- Nothing may touch a Postgres cluster this run did not create (other lanes and the shared dev DB run Postgres here).
