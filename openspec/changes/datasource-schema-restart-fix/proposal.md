# Proposal — Data Source schema disappearance investigation (HEL-256)

## Why

Linear HEL-256 reports a P0 trust failure: a Data Source's inferred schema
*sometimes* disappears after a backend restart. The bug invalidates Helio's
"upload-and-trust" promise for CSV (and possibly Static/SQL) sources.

## What changes (cycle 1: investigation-only)

This change folder is **investigation-only**. No production source files are
modified. The deliverables for cycle 1 are:

1. End-to-end trace of the Sources-page schema display path (UI → API → DB)
2. Empirical reproduction attempts for CSV, Static, and SQL sources, both
   with and without overrides, with single and multiple backend restarts
3. Direct inspection of the dev DB to identify which of the six pre-recorded
   candidate root-causes (ticket.md) is responsible
4. Fix design with surface estimate (handed to cycle 2)
5. Regression test plan (handed to cycle 2)

## Cycle 2 (out of scope here)

A separate change folder (or this one extended) will implement the fix and add
a restart-persistence regression test for CSV + Static + SQL per ticket AC #2.

## Impact

- **Affected specs**: none yet (cycle 1 is investigation)
- **Affected code**: none (cycle 1 commits only `openspec/changes/datasource-schema-restart-fix/*`)
- **Risk**: zero — no production code is touched in cycle 1
