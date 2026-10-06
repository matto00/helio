## Evaluation Report — docs re-check (evaluation-7.md)

**Reviewed head:** local `2fcf1773a269c229ed83eef3e726510f2c58c125`. It is docs-only and has not been pushed. The previous evaluated head was `0f1e0047d` (evaluation-6.md). This was a docs check: nothing was pushed or re-run, and no servers were started.

### Scope of the change

`git diff --stat 0f1e0047d HEAD` covers exactly two files:
- `openspec/changes/halve-e2e-ci-job-time/evaluation-6.md` (new). It is byte-identical to the durable copy under `.concertino/runs/HEL-1288/evidence/` (checked with `cmp`).
- `openspec/changes/halve-e2e-ci-job-time/profile.md` (+5/−2). The edits are the L150 sentence and the Notes section.

No code, config or CI file changed. All code-level findings in evaluation-6.md therefore stand, including Phase 2 PASS, the ci.yml scope, the helper swap and the streak 37519143326 with 46/46 per-view lines equal in every attempt.

### Phase 1: Spec Review — PASS

1. **L150 (the outlier).** The text now names the cause: "Install Playwright browsers" ran 313 s (19:29:06–19:34:19Z) because of apt `Get:` stalls of 31–91 s on azure.archive.ubuntu.com, while the suite took 228 s.
   - This matches what I measured from the jobs API and the retained job log in evaluation-6.
   - "3.8 min" and "228 s" in the same sentence agree.
   - The false "log was not retained" claim is gone.
2. **Notes, C12.** The backend-hang item now cites "owner ruling C12 `accept-detection-without-root-cause`, the root cause is tracked in HEL-1339". This matches C14 in tasks.md.
3. **Notes, C9.** The new line "Owner ruling C9 `keep-header`: the hel519 parallel-mode header stays as is" also matches C14.
4. **Target statement.** The new sentence on the ≤ 7 min target is accurate on every point:
   - The final streak's slowest legs were 10.6 min (the apt outlier), 6.7 min and 7.1 min. These are 636/401/425 s from the jobs API.
   - Even excluding the outlier, the latest attempt is above 7 min.
   - The owner accepted a slowest-leg median of about 6.9 min under C11.
   - The AC (median of 5 post-merge main runs) cannot be measured before merge and is the driver's to take.
5. **Formatting.** `npx prettier --check` passes on both changed files.

### Phase 2: Code Review — PASS

No code changed since evaluation-6.md, where Phase 2 passed. The only changes are Markdown files, and prettier passes on both.

### Phase 3: UI Review — N/A

No trigger path changed.

### Overall: PASS

### Non-blocking Suggestions

- None for this diff.
- The final skeptic still has two things to do:
  - Confirm the two D2 ledger rows (hel516/hel519-screenshots) under task 2.2.
  - Treat the post-merge 5-run median as the open AC item, which profile.md now states plainly.
