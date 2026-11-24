## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Scope: the fold-in only. That is the last AC in ticket.md, design.md Decisions 10-11, tasks.md section 6 and
Standing Constraint C20. I reviewed it against branch head cafed670cd4732c9d205ba269c4203878f56eec3, which already
contains the delivered owner-side change.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/hel1791-hel1582-e2e-hardening/hel-1830`.
  HEAD is cafed670c.
- **Premise: the shared editor exceeds 60.** I grepped every `principal=editor` REQUEST-COUNT line in
  `t4-1791-20x.txt` and `t4-1791-throttle4x.txt`:
  - The second (cumulative) editor reading is 71-74 at 1x and 79-80 at 4x.
  - evaluation-1.md:35/88, evaluation-2.md:34 and skeptic-final-1.md:87 agree.
  - The numbers in Decision 10 are accurate.
- **The per-theme projection is backed by measurement, not by arithmetic alone.** The first editor reading in each run
  (light test only, which already includes the beforeAll `auth/me`) is 39-41. In the 4x runs it is
  41/41/39/41/41. One editor principal per theme test therefore projects to about 41, which is under 60 at both 1x
  and 4x. The per-(theme, width) fallback is specified in case that projection is wrong (Decision 10, bullet 2, and
  C20). That mirrors C19, which already worked for owners: owner max-60s measured 29-31.
- **The shape fits the live code.**
  - At e2e/hel1791-compact-counter-stack-height.spec.ts:187-197, the beforeAll creates `boardOwner`, `editor` and
    `measurer`, and `seedBoard(..., [editor, measurer])` grants both at :142-146.
  - The editor tests at :322-334 use the shared `editor.context`.
  - `boardOwner.context` stays open until afterAll (:194-197), so granting a test-registered editor from
    `boardOwner.context.request` during the test is valid.
  - The grant uses the existing `POST /api/dashboards/:id/permissions` body.
  - `newActor` (:41-47) already attaches the counter before the first request.
- **Ordering and worker model.** playwright.config.ts:191 sets `fullyParallel: false`, so the file runs serially in
  one worker and the beforeAll runs once per worker. A worker restart after a failure re-runs the beforeAll, and the
  in-test grant then targets the new board. I found no ordering dependency that breaks.
- **The board-owner count cannot exceed 60.** The board owner pays seeding (about 17), the run-wait polls and three
  grants, and makes no page loads. Today it is never logged (no `board-owner` line in any t4 file), so Decision 10 is
  right to add it.
- **Isolation control is feasible.** In the precedent `t1-isolation-control.txt`, the light owner principal was
  burned after its test, and `STRESS-ACTIVE burn still live ... -> 429` was recorded after the dark test. The same
  mechanism applies to editors.
- **Red first (C12).** The committed 72-80 shared measurement is the red for the count. The 6.1 burn red on the
  pre-fold-in spec mirrors `t1-red-burn-unfixed.txt`, where the burn left `429 Retry-After=51s` and the run failed at
  `openStack`. Both are committed before the change.
- **Mutation.** The caption check is editor-only (spec :245), so a caption-hiding app mutation reds an editor test at
  a named assertion. C17 governs reverting it.
- **Scope.** The new AC maps to tasks 6.1-6.5 with no gaps. Decision 11 (do not address the hel1582 `:527` timeout)
  matches the owner's sub-2 answer. hel1582 is untouched by the fold-in, and its 20x evidence (`t4-1582-20x.txt`)
  stands. Task 6.4 adds one full run to show it is unchanged.
- **Assertions.** Decision 10 says every editor assertion and message is unchanged. That is consistent with Decision 5.

### Verdict: CONFIRM

### Non-blocking notes

1. **Say where the board-owner REQUEST-COUNT is logged.** Decision 10 says the beforeAll owner's count "is logged
   too", but not when. It should be logged after its last grant, for example in afterAll before `deleteBoard`.
   `test.info().annotations` inside a hook may not show in the report, so the `console.log` line is the evidence that
   counts. If a reading ever exceeds 60, report it with the numbers. No fallback shape exists for the board owner, and
   none is needed at about 25.
2. **Burn the light editor before its context closes.** Decision 10 closes each editor's context in the test's
   `finally`. The isolation-control burn must therefore spend the light editor's budget before that close, or through
   a retained session, as the owner control did. Its `STRESS-ACTIVE ... still live` line should prove the burn was
   still active when the dark editor test ran.
3. **Update stale text in design.md.**
   - The Goals/Non-Goals line "the editor tests' principal (measured and reported, changed only under Decision 2's
     rule)" is now overridden by Decision 10.
   - The Risks bullet "The editor principal may be the next shared-window risk" is resolved.
   - Update both, or mark them superseded, so the archived design does not contradict itself.
4. **Use the right baseline for "fresh" counts.** 6.4 should record the highest editor reading per principal
   (light/dark separately). It should not compare against the old cumulative second reading.
