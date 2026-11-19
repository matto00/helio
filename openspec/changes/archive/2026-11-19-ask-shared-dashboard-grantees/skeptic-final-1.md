## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `2a946c6c538908418c97d3cb1a6cf5dd4ff26fcf`. The base was resolved live with `resolve-review-base.sh` to `b2603ab79` (exit 0). The spawn-cwd guard returned READY.

### What I verified (with evidence)

**Scope of the diff.** `git diff --stat b2603ab79...HEAD` lists 23 files. They are 3 frontend sources (`DashboardMetaRow.tsx`, `CommandBar.tsx`, `AskAnswerCard.tsx`), their tests, 2 backend test specs, 2 e2e specs and the openspec artifacts. The diff touches no main-source Scala and no migration. It touches no HEL-1784 file: not FormRenderer, FormPanelView, the PanelService submit path, the per-panel schema route or V146.

**AC1: a dashboard-only beta viewer can open Ask and ask.**
- `DashboardMetaRow.tsx:123-129` and `:236`, and `CommandBar.tsx:94`, now gate the Ask entry on "a dashboard is selected" instead of `isOwner`. Share is still inside `if (isOwner)`.
- `AskDrawer` mounts only in `App.tsx`, which is the authenticated shell. The public viewer does not render this row or the command bar.
- The server admits grantees, shown by the green seam and RLS specs below.

**AC2: a cited Output never opens an Output route the grantee cannot read.**
- `AskAnswerCard` renders `citedOutputs` as a plain-text "Based on ..." line. There are no links.
- For a non-owner dashboard scope, chips use `CitationChip` with `source={variant:"public", dashboardId}` and a `panelId` mapped from the settled panels of that dashboard. The fetch goes to `/api/dashboards/:id/panels/:panelId/provenance`.
- A citation that no panel on the dashboard binds renders as a plain ordinal `<span>`. It is not a chip, so it never falls back to the `ask:dashboard:` id.
- In the public variant the popover suppresses `pipelineHref` (`useProvenancePopoverHost.tsx:142`) and the pipeline-terminal subscription.
- The only `<Link>` left in the card is the post-pin "Saved to pipeline". It is reachable only when `pin !== null`.

**AC3 and AC4: no pin, proven at a real server seam, with a mutation that goes red.**
- I re-ran `testOnly AskGranteeRlsSpec AskSeamSpec` in the worktree: **11 succeeded, 0 failed**.
- I reproduced mutation M1 myself in an isolated `git archive` copy, so the worktree was not modified. The mutation changes `AskPinBuilder` to `case _ => Some(...)`. Result: 3 failed.
  - The seam **viewer** case and the new **editor-without-pipeline-grant** case both fail with "fixture ask-200-no-pin.json differs from what the real route writes ... pin: {pipelineId ...}".
  - The RLS spec's no-pin case fails with `Some(AskPin(...)) was not equal to None`.
  - These are real red results, failing for the right reason.
- I did not re-run M2 (pin decided on dashboard access). The persisted transcript shows only the editor case red, which is consistent. M1 is already enough to show that the editor case reaches the pin builder.

**AC5: the scope re-check is the only data path, and no payload rows are read; the RLS proof is real.**
- The `AskGranteeRlsSpec` role probe printed `current_user = helio_app_test_output_history`. Both `(rolsuper OR rolbypassrls)` and `rolbypassrls` are asserted false.
- `OutputRepository.findById` relies only on the `outputs_select` RLS policy (`withUserContext`).
- I reproduced RLS-B myself: removing the executor's pipeline-grant check leaves the payload-refusal case **green** (4/4). The RLS-scoped lookup alone refuses, which is positive evidence that RLS is enforced in this harness.
- I reproduced RLS-D myself: also swapping in `findByIdInternal` makes the payload-refusal case **red** (`false was not equal to true`, `AskGranteeRlsSpec.scala:111`).
- The viewer's `list_board_outputs`, `get_output_rows` and `get_output_history` calls return data under the non-bypass role. `get_history_rows` is not offered to the viewer, and the owner control is offered it.

**AC6: free-tier grantees get the existing upsell.**
- Covered by a unit test (`AskAnswerCard.grantee.test.tsx`).
- Covered by e2e: "free-tier grantee: the upsell, and no ask request" passed in my run.

**Frontend gates (run fresh).**
- Jest on the touched suites (`CommandBar|DashboardMetaRow|AskAnswerCard|AskDrawer|AskPanel|CitationChip`): 10 suites, 111 tests, all passed (3 workers).
- `npm run lint` and `npm run typecheck` are clean.
- Prettier check on the touched files is clean.

**e2e (run fresh).**
- Setup: lane DB `helio_hel1781` (Flyway migrated it on boot), servers on 7213/10120 via `start-servers.sh`, `assert-phase.sh servers` PASS, `ANTHROPIC_API_KEY` exported empty, and `DATABASE_URL` set for both the servers and Playwright.
- `hel1781-ask-shared-dashboard.spec.ts` and `hel1773-viewer-grantee-dashboard.spec.ts`: **13 passed**, 2 workers. Teardown deleted the 10 throwaway users by exact id.
- The viewer flows assert, on the network, that zero requests went to `/api/outputs` or `/api/pipelines`, with no `/api` 4xx/5xx and no console errors. They also assert that the provenance request went through `/api/dashboards/:id/panels/`.

**Selector and label grep.**
- `grep -rn "Ask about this dashboard|Dashboard actions" e2e/` finds:
  - `hel1773`, updated at :330-338 and :461-467. The phone viewer test there does not assert the kebab's absence.
  - `hel1746`, which covers the owner and a self-owned free board, so its behaviour is unchanged.
  - Several "Dashboard actions" *group* selectors, which are unaffected.
- No stale assertion remains.

**Persisted transcripts.**
- Every "proven by mutation" claim has a matching transcript with the red or green outcome the report states. RLS-A and RLS-C differ in their bytes and are not duplicates.
- The transcripts keep only pass/fail lines, so the mutation diff and the failure message are not self-authenticating. For M1, RLS-B and RLS-D I closed that gap by reproducing them myself, with the failure messages quoted above.
- No mtime-ordering claim is relied on.

**UI judgment.**
- The persisted screenshots (desktop and phone, from my e2e run) show the grantee's answer card with its chips and the provenance popover. The popover has Source, Pipeline, Last run and Checks, and no "Open pipeline" link. It sits correctly over the drawer, and the phone bottom sheet is intact.
  - `/home/matt/Development/helio/.concertino/runs/HEL-1781/evidence/e2e-evidence/HEL-1781/viewer-ask-desktop.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1781/evidence/e2e-evidence/HEL-1781/viewer-ask-phone.png`
- The change adds no CSS and no new component. The meta-row Ask button and the kebab item reuse the existing owner controls, so there is no new token or parity surface to judge.
- I did not take a separate light-theme capture. With no styling change, I judged it not load-bearing.

### Verdict: CONFIRM

### Non-blocking notes
- Future mutation transcripts should keep the applied diff and the ScalaTest or Playwright failure message, as evaluation-3 also noted. Pass/fail lines alone are not self-authenticating.
- An unmatched citation renders as a bare ordinal with no visual affordance. That matches the spec ("no provenance action"). A muted chip style could make it read as a citation, but this is polish only.
- `mutation-M1.txt` and `mutation-M2.txt` were captured against an earlier `AskGranteeRlsSpec` test name ("offer the payload tool to the owner (positive control)"). The seam cases they concern are unchanged, and I re-ran M1 against HEAD.

Cleanup: servers stopped with `stop-servers.sh`, `helio_hel1781` dropped, and the isolated mutation copy removed. No code in the worktree was modified.
