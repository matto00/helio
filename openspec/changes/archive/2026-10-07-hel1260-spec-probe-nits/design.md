## Context

See proposal.md - Why. `e2e/hel1260-orphan-owner-repair.spec.ts:88` currently reads
`expect(repairPosts[0].url.endsWith(`/api/dashboards/${dashboardId}/layout/repair`)).toBe(true)`.
The archived probe sets `name = tz.split('/')[-2]` and `isorphan = 'survives' not in name`.

## Goals / Non-Goals

**Goals:** diagnosable URL failure with an identical accepted set; probe classification that does not depend on the
output-folder slug. **Non-Goals:** any change to the spec's control flow, waits, seeding, or the other tests.

## Decisions

1. **URL assertion.** `expect(repairPosts[0].url).toMatch(new RegExp(`/api/dashboards/${escaped}/layout/repair$`))`
   where `escaped` is `dashboardId` passed through a small local helper
   `s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")` (`RegExp.escape` is unavailable: Node 22, e2e tsconfig ES2022) (ids are UUIDs today, but escaping keeps the accepted
   set exactly equal to the old `endsWith` set regardless of id shape). End-anchored `$` mirrors `endsWith`; no start
   anchor, mirroring `endsWith`. Alternative considered: `toContain` — rejected, not end-anchored, so it widens the
   accepted set. Alternative: `toBe(fullUrl)` — rejected, needs the base URL and narrows the set.
2. **Probe keys on the trace's own test title.** Playwright 1.55.1 (the installed version) records the test-runner
   trace title on the `context-options` event's `title` field (`playwright-core/lib/server/trace/recorder/tracing.js:147-150`),
   built by `traceTitle()` (`playwright/lib/worker/testTracing.js:107-108`) as
   `<file relative to testDir>:<line> › <titlePath[1:] joined by " › ">`, e.g.
   `hel1260-orphan-owner-repair.spec.ts:37 › owner open of an orphaned text panel … (light)`.
   Rule, per trace.zip:
   - Collect the `title` of every `context-options` event across every `.trace` file in the zip (browser context,
     `request` fixture context, extra chunks each emit one). Require **exactly one distinct** value; zero titles or
     conflicting titles → append a problem (`no title` / `conflicting titles=[...]`), never a default.
   - Split that title on ` › `. The first segment, with its trailing `:<line>` removed, MUST equal
     `hel1260-orphan-owner-repair.spec.ts`; otherwise a problem (`wrong file=<...>`).
   - The **last** segment is the test's own title. Orphan-repair when it starts with
     `owner open of an orphaned text panel`; UI-create when it starts with `creating a text panel through the UI`;
     anything else → problem `unclassified title=<...>`.
   - The executor still confirms this against a real trace from this spec (task 1.4); a mismatch with the source-derived
     format is a reason to stop and report, not to improvise a looser match.
   Alternative considered: test id (`testIdForTagging`) — rejected as the primary key because ids are opaque hashes of
   file+title and not readable in output; title is what the ticket names.
3. **Archival documentation.** Header comment: archival evidence for HEL-1289, not invoked by CI/hooks/gates, keyed on
   the in-trace test title (prefixes listed), usage `python3 probe-check-isolation.py <playwright output dir>`.
4. **Editing an archived change file.** Acceptable: the probe is a script, not a spec artifact, and the ticket names
   it. The executor MUST run `npm run check:openspec` to confirm the hygiene check accepts the edit.

## Risks / Trade-offs

- [Risk] A trace format without the title field → probe reports every trace as unclassified (loud, not silent);
  mitigation: verified against a real trace (Decision 2).
- [Risk] The regex change alters which URLs pass → mitigated by end-anchoring + escaping; the executor demonstrates the
  red (a mutated URL fails and prints the actual URL) and the green.

## Planner Notes

- Self-approved: skip_specs (no behavior change); leaving the UI-create test's `endsWith` filter untouched.
- Verification of the spec runs under the driver's machine cap: Playwright `--workers` ≤ 3, `nice -n 19`, lane-private
  ports from workflow-state, never the shared Playwright MCP browser.
