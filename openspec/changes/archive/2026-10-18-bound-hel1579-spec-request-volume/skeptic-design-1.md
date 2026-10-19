## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 08e65e17e12087e42667f0771ed76d8d1d02b45e. The change dir is untracked: ticket.md, proposal.md, design.md, tasks.md, and `.openspec.yaml` with skip_specs: true.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/hel1579-accent-audit-rate-limit/HEL-1620`.
- **Target test is as described.** `e2e/hel1579-pipeline-spine-layout.spec.ts:174-212`:
  - one user, one `seedPipeline(page, true, true)`;
  - a 2x2 theme/accent loop, each pass doing `page.goto` and then clicking every `.spine-row__select`;
  - line 191 is the "Rows after step" `toBeVisible` that the ticket notes cite.
  - The seed costs 3 + 14 + 1 step POSTs, plus source, pipeline, output and run POSTs, about 22 in total (lines 31-113). This matches design.md.
- **Limiter keying claim holds.** `backend/.../api/http/RateLimitDirective.scala:17-69` keys a resolved `helio_session` cookie to `user:<id>`. A request with no credential is not keyed. So `/api/auth/register` (no cookie yet) and the `/login` POST are free, and every later page and `page.request` call is charged to the one user.
  - Neither `playwright.config.ts` nor the workflows override `RATE_LIMIT_*`, so CI runs the 120/60s default.
- **No hidden second limiter on the hot path.** The tighter source-fetch limiter (30/window) wraps only `pathPrefix("data-sources")`/`("sources")` preview, sample, refresh and infer (`DataSourcePreviewRoutes.scala:49-86`, `SourcePreviewRoutes.scala:46-106`).
  - The step preview `GET /api/pipelines/:id/steps/:stepId/preview` is `PipelineRunStatusRoutes.scala:38`, under neither that limiter nor the pipeline-run submit guard. `PipelineRunPreview.previewStep` calls `previewAtNode` with no `submit`.
  - So the plan's focus on the 120/60s general limiter is correct. The one sample per load (HEL-1628) is 1 per load, well under 30.
- **D8 is real spec text.** The archived `2026-10-15-pipeline-detail-step-spine/design.md:48` says "a settled response is never reused, so every selection ... fetches fresh". Treating per-click preview GETs as required, not a defect, is correct, and caching them would be a spec change. The plan correctly puts that out of scope.
- **Static candidates exist.** `frontend/src/app/shell/ScheduledContextList.tsx:108` dispatches `fetchScheduledItems()`. The plan lists it as a live-check candidate, not a presumed defect. That is appropriate.
- **AC coverage:**

  | AC | Covered by |
  | --- | --- |
  | Measured before and after, worst window ≤ 90 | D1, tasks 1.2 and 4.1 |
  | Zero 429s across 10 runs | Task 4.1 |
  | No limit raise or exemption | Non-Goals, C1 |
  | Red first | C2, D1, task 1.2 |

  The ticket's second paragraph (`:174`) is the same test. The notes in ticket.md establish that correctly.
- **Measurement soundness.** A max *sliding* 60 s window ≤ 90 bounds every *fixed* limiter window at ≤ 90, so the guard is conservative in the right direction.
- **Guard is failable.** D4 and task 3.3 require a mutation check, with the transcript recorded. This meets the red-vs-guard discipline.
- **Contract:** no API or schema change. `skip_specs` is justified, and there is an explicit stop-and-re-plan if a product fix would change a spec requirement.
- **Placeholders and contradictions:** none. There is no TODO/TBD, and proposal, design and tasks agree on the measure, classify, fix, guard and verify order.

### Verdict: CONFIRM

### Non-blocking notes

1. **The D1 red fallback should not weaken the AC.**
   - The AC defines red as "429s observed or a per-user 60s window over 120". D1's last fallback, "the arithmetic of the total count against the limit", is not red under that definition: a total over 120 spread over more than 60 s proves nothing.
   - The local sliding-window figure should easily exceed 120, because the test runs faster locally than on CI. If it does not, use the CI-observed 429s, which the ticket cites for runs 38954434243 and 39105908594, as the red. Do not use arithmetic.
2. **The post-login `/home` page stays live during seeding.**
   - `registerAndLogin` (`e2e/support/auth.ts:82-95`, `uiLogin` in `isolateLivePage.ts:26-35`) leaves the page on `/home`, which issues its own shell and home requests, and possibly run-timeline refreshes after the seed's `/run`. All of these are charged to the user, and the design's static map omits them.
   - The D1 counter will capture them as long as it attaches before `registerAndLogin`.
   - `isolate: true` is an existing, cheap lever (HEL-1289/1300) if the split tests need more margin. Check that the localStorage writes then happen on an app-origin page: `about:blank` has no localStorage for the app origin, so set theme and accent after a same-origin navigation, or through `addInitScript`.
3. **Other tests are likely over 90 before the change.**
   - The 820/900/1100 test (line 214) does 8 full loads plus a seed and a schedule PUT, by the design's own per-load estimate about 8 x 13 + 9 ≈ 113. It is likely over 90 and possibly near 120.
   - The evidence test (line 362) does 6 loads, about 87.
   - Task 3.2's conditional restructure covers them, but expect at least the 820 test to need splitting.
4. **Prior art exists.** `e2e/hel1392-remount-request-burst.spec.ts:38-40` already counts `/api` requests inline. Consider aligning the new `e2e/support/apiRequestCounter.ts` with it, or having that spec adopt the helper later as a follow-up. Do not refactor it in this ticket.
5. **Count requests, not only responses.** A request still in flight when the test ends, or aborted by navigation, is charged by the limiter but fires no `response` event. Hooking `request`, or `requestfinished` plus `requestfailed`, avoids an undercount. Also confirm that `page.request` and `request` fixture traffic does not surface on `page.on(...)` (D1 already plans this check).
