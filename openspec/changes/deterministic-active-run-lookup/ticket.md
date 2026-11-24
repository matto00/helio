# HEL-1833: findActiveRunInternal returns an arbitrary open run; manual submit allows overlapping open runs (hook dedupe nondeterministic)

## Description

origin_kind: followup
origin_ticket: HEL-1626 (PR matto00/helio#1244, merged as 1d28e30f2). The owner chose a standalone ticket.

HEL-1626 made every latest-run read deterministic (`started_at DESC, id DESC`). Its final reviewer found a related gap outside that scope:

* `PipelineRunRepository.findActiveRunInternal` returns any open run (`queued` or `running`) with no ORDER BY.
* A manual `PipelineRunService.submit` does not check for an overlapping open run, so two open runs of one pipeline can exist at once.
* Hook-triggered run dedupe, and any other caller of `findActiveRunInternal`, then gets either run, at random.

## Do

* Find every caller of `findActiveRunInternal` and what it does with the result.
* Make the lookup deterministic, using the same `started_at DESC, id DESC` order, or whatever its callers need.
* Find out whether overlapping open manual runs are intended. Check the HEL-505 concurrency cap and the auto-run "pipeline already running" path (HEL-1739). If preventing the overlap would change product behaviour, ask the owner first.

## Acceptance criteria

- [ ] A test that fails first: with two open runs of one pipeline, the lookup returns the same run every time, chosen by a documented rule.
- [ ] The overlap question is answered in the PR, with evidence.
