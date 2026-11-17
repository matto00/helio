## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `ab6cc9416c9451eded398b5787a7d0de707d8d1f`. The change dir is untracked, and no code has changed yet.

### What I verified (with evidence)

I checked the root-cause claims against the CI trace myself. I parsed `.concertino/scratch/HEL-1711/trace3/` with `python3 -I` scripts kept in the session scratchpad.

- **Action timing (`1-trace.trace`).** The click on `Step 3:` (call@9228) starts at 748224.9 ms. Its input point is (426, 415). The click on `Remove step` (call@9230) starts at 748349.9 ms, about 125 ms later. Its input point is (875.5, 168).
- **The URL moved, but the focused card had not.** Snapshot `after@call@9228` (t=748346.8) already has the URL `?step=ce6da272…`, which is the compute step id (from the POST `/steps` response). Snapshot `input@call@9230` (t=748471.9) shows the only focused section still labelled `Step 1 Filter rows`, with `Remove step` as the click target. So the selection had changed in the URL, but the render of the focused card had not caught up. React Router 7 (`react-router-dom ^7.18.3`) applies `setSearchParams` updates as a transition, which fits this pattern. This is direct evidence for Decision 3's rejection of a URL-param wait: the URL had already moved when the click hit the wrong card.
- **The wrong step was removed (`1-trace.network`).** The first `POST /draft/save` returned 422 `CASCADE_CONFIRMATION_REQUIRED`, with `impact.stepIds=[a01caaef…]` (filter) and `outputIds=[70ce139d…]` (the "Run duration" chart). The save request's steps are sort `37cfa1c0` and compute `ce6da272`. Filter is missing, so it was removed. The second save returned 200, and the preview `POST /preview?outputId=b581d5f4…` (metric "Avg minutes", `outputIds[2]`) returned 200 on the saved definition. The watched Output was never removed. The orchestrator's claims in `ticket.md` and `design.md` match this.
- **The product reading is sound.** `ui/StepCardFocused.tsx:53-55` renders `<section aria-label="Step N <label>">`. A `section` with an accessible name exposes role `region`, so Decision 3's locator is valid, and the design still asks the executor to verify it. Remove step (`:109`) acts on the step the card displays, so the stale render does not remove an off-screen step.
- **Decision 4 can work.** `ui/PipelineDraftDialogs.tsx:52-53` lists `Output: {name}` from the server's cascade impact. Asserting "Avg minutes" in the dialog therefore checks what the server would actually remove, so a wrong-step removal fails with a clear message.
- **Scope.** `grep '"Remove step"' e2e/` finds 3 sites. One is `hel908:357`, which is already scoped to a card. The other two are hel1685:272 and hel1631:252. The plan covers exactly those two. hel1631:513 (`Step 3:` then Discard) has no Remove-step click, so leaving it out is correct.
- **Acceptance criteria coverage.** AC1 (root cause plus local reproduction) is covered by tasks 1.1 and 1.2. Decision 1 adds an honest fallback that forbids claiming a local red that did not happen. AC2 (a deterministic wait, no widened timeout) is covered by 2.1-2.3. Decision 3 adds no `waitForTimeout`. Decision 2's escalate-on-product-cause branch is present.
- No placeholders, contradictions or contract gaps. This is a test-only change, and `skip_specs` is justified.

### Verdict: CONFIRM

### Non-blocking notes

- The CI trace already settles part of Decision 2: the URL moved before the click and the render lagged. Record this in 1.2 as the CI-side evidence, then use the local reproduction to confirm it.
- For the 2.3 forced-race mutation, the most useful red is the new dialog assertion ("Avg minutes" missing) firing on the unscoped click. This shows the self-check fails with the right message, and not only that the spec fails.
- The "Standing Constraints" heading in `tasks.md` is empty. That is cosmetic.
