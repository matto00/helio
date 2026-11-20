## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `82d4dafc4891d56859b8fffe155165aa4cc67ded`; the base is the same live-resolved `94a8ef292`. Commit
82d4dafc4 changes only the e2e spec and the change dir. There is no `frontend/**` change since cycle 1.

### Phase 1: Spec Review — PASS

All cycle-1 change requests are addressed.

- **CR1 (AC1 inventory): addressed.**
  - inventory.md now has one row per consumer for all 30 files. Rows 1-22 are live-probed by spec cases, with natural
    body and dialog numbers and the positioned descendants of each.
  - Rows 23-30 give a specific reason each, plus the actual grep and its output. I spot-checked the relative/absolute
    pairs it cites (ConnectorsPage, PipelineDraftNotices, ProposalReview) against my own cycle-1 grep, and they match.
- **CR2 (red-run attribution): addressed.**
  - The inventory names the 7 cases in the committed red run `3129212f4`.
  - It states that every later case is proven red by the rule-removed runs (`mutation-a…`, `cycle2-unfixed-css-run.txt`).
- **CR3: done.** Tasks 1.2 and 1.3 are now backed by the evidence.
- **C15 holds.** I re-classified every case in `cycle2-unfixed-css-run.txt` myself. On unfixed CSS the injected case is
  red for every modal except step-palette and command-palette. Those two are green because their flex-column body
  shrinks the spacer, and inventory.md:48-53 and design.md:118 label them GUARD only. Every natural case is green on
  unfixed CSS and is labelled a guard.

### Phase 2: Code Review — FAIL

Gates were run fresh in WORKTREE_PATH. All pass:

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | clean |
| `npm test` (3 workers) | exit 0: 617 root tests + 10304 frontend tests |
| `npm --prefix frontend run build` | exit 0 |

**Bound change to `max(contentBottom, clientHeight)`: it does not weaken any discriminator.**
- `scrollHeight >= clientHeight` always holds. So the looser bound only accepts `scrollHeight == clientHeight` when the
  content is shorter than the box, and that state has no scroll at all.
- I re-scored every logged geometry in `cycle2-unfixed-css-run.txt` under both the old bound and the new one:
  - Every injected case gets the same verdict either way.
  - The only case that changes is mobile-step-sheet natural, which goes from red under the old bound to green. That
    old red was a false red: the sheet's body fills its container, with no blank scroll.
- HEL-1763's natural regression (dialog 1490 vs clientHeight 729) is still red under the new bound.

Issues:

1. **Blocking: the spec fails under CI's rate limits.**
   - `.github/workflows/ci.yml`'s `e2e` job sets no `RATE_LIMIT_REQUESTS_PER_WINDOW` or
     `SOURCE_FETCH_RATE_LIMIT_PER_WINDOW`, so CI runs the defaults: 120 requests per 60 s per user, and 30 for source
     fetches. `e2e/support/apiRequestCounter.ts:11` records the same 120.
   - Each of the 6 scroll-extent tests opens up to 19 modals in one user session. Most of those modals do a full
     `page.goto` with the pipeline page's preview, sample, run-history and outputs fetches.
   - I stopped the executor's servers and restarted them with `start-servers.sh` and no rate-limit overrides. The spec
     then fails 6 of 6 scroll-extent tests; the 2 popover guards pass.
     - Every one of the 6 fails at `shape-picker` (`openSpineAction`, spec:124 → spec:109, `.spine-row` not found),
       after 8-9 modals.
     - The trace shows `429` on these routes:
       - `GET /api/pipelines/:id/outputs`
       - `/api/dashboards?include=shared`
       - `/steps/:id/preview`
       - `/api/data-sources/:id/sample?pipelineId=…`
       - `/run-history`
       - `/api/auth/me`
     - After those 429s the app drops to the "Welcome back" sign-in page.
     - Transcript: `.concertino/runs/HEL-1774/evidence/.concertino/scratch/HEL-1774/eval2-default-rate-limits-run.txt`.
   - The executor's green run (`cycle2-fixed-run.txt`) was made with both limits raised to 100000. Neither inventory.md
     nor design.md discloses that, so the committed green evidence is not representative of CI.
   - This spec would turn the required `e2e` check red on every PR.
2. **Blocking: the spec runtime is far above its shard weight.**
   - The spec is not in `e2e/shard-weights.tsv`, so `scripts/e2e-shard.mjs` weights it at the table median (about 49 s).
   - Its real cost is about 240 s of summed test time. That is the six tests at 30-49 s each in `cycle2-fixed-run.txt`
     plus the popover tests, and it is with raised limits on a local machine.
   - The CI comment at ci.yml:615-622 (HEL-1772) puts the slowest 7-leg legs at 1340-1433 s against a 1500 s timeout.
     It names stale weights for heavy specs as the cause and says to regenerate when a heavy spec is added.
   - An unweighted 4-minute file on an already-heavy leg risks the 25-minute `timeout-minutes`.

### Phase 3: UI Review — FAIL

- Servers were started with `start-servers.sh` on 7206/10113, against `helio_hel1774?user=matt` with
  `ANTHROPIC_API_KEY` empty and no rate-limit overrides. `assert-phase.sh servers` passed.
- Under CI-equivalent limits the spec fails: 6 failed, 2 passed, 3.5 min (Phase 2 issue 1). The fix itself is not in
  question:
  - The cycle-1 results stand: green under the fix, mutation a red, regression specs 37/37.
  - The new evidence agrees. `cycle2-abs-before-fix.txt` vs `cycle2-abs-after-fix.txt` shows no visible child whose
    containing block was the dialog. AskDrawer's `.sr-only` elements were dialog-anchored on unfixed CSS; they are
    hidden, so their placement does not matter.
- I stopped the servers with `stop-servers.sh`.

### Overall: FAIL

### Change Requests

1. Make `e2e/hel1774-modal-scroll-extent.spec.ts` pass under CI's default limits: 120 requests per 60 s per user for
   the general API, and 30 for source fetches. Either of these works:
   - Split the 19-modal loop so each test registers its own user and opens a small group of modals, for example by
     page: pipeline-page modals, dashboard modals, shell overlays. Keep every 60 s window well under 120 requests. The
     `e2e/support/apiRequestCounter.ts` guard (target 90 or fewer per window) is the existing tool to measure this; log
     its report per test.
   - Or cut requests per modal, for example by opening several modals from one `page.goto` where the page allows it.

   Then re-run the full spec green against servers started with no `RATE_LIMIT_*` overrides. Replace
   `cycle2-fixed-run.txt`, or add a run beside it, and state in inventory.md which limits the run used.
2. Bring the spec's CI cost in line with the shard partition. Follow the HEL-1778 precedent and split it into several
   spec files, for example by viewport tier or by modal group, so that no single unweighted file carries about 240 s.
   This combines naturally with CR1. Note in the PR body that `e2e/shard-weights.tsv` must be regenerated after the
   first CI runs; the file says never to hand-edit it.
3. After the split, keep the C15 evidence intact. Every injected case must still be shown red on unfixed CSS by a
   rule-removed run of the split files. step-palette and command-palette stay labelled GUARD.

### Non-blocking Suggestions

- Remove the `HEL1774_ONLY` diagnostic env hook (spec:24-25, :526), or keep it only if the split still needs it. It is
  a debugging aid, not part of the guard.
- Add one-line `// GUARD only` comments on the `step-palette` and `command-palette` case objects. That puts the label
  in the spec as well as in inventory.md, because the spec header says the injected case is red "for every modal whose
  body can scroll".
