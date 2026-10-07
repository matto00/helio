# HEL-1302: hel1260 spec + probe nits: diagnosable URL assertion, robust test identification

## Description

Follow-up from HEL-1289. Two small items:

* In `e2e/hel1260-orphan-owner-repair.spec.ts`, the repair-URL check uses `.endsWith(...)`, which prints only `true` or
  `false` on failure. Use `expect(repairPosts[0].url).toMatch(...)` so the actual URL is shown.
* The archived `probe-check-isolation.py` tells the two tests apart by a substring of the folder name, which is fragile.
  Key it on the test title or id instead. If the probe is purely archival, document that limitation.

The test's behaviour must not change.

## Acceptance Criteria

1. The repair-URL assertion in `e2e/hel1260-orphan-owner-repair.spec.ts` uses `expect(repairPosts[0].url).toMatch(...)`
   (anchored at the end, dashboard id escaped/literal) so a failure prints the actual URL; it accepts exactly the URLs the
   old `.endsWith` check accepted for this dashboard, and nothing else in the spec changes.
2. `openspec/changes/archive/2026-10-05-isolate-orphan-repair-e2e-seeding/probe-check-isolation.py` classifies each trace
   as orphan-repair vs UI-create from the test title (or id) recorded inside the trace, not from the trace's folder name;
   a trace whose title cannot be read is reported as a problem, never silently classified.
3. The probe documents (header comment) that it is archival — not run by CI or any gate — and what it keys on.
4. The test's behaviour does not change: the spec still passes (both themes, all four tests), and the URL assertion is
   shown to fail with the actual URL printed when the URL is wrong.

## Origin

origin_kind: followup, origin_ticket: HEL-1289
