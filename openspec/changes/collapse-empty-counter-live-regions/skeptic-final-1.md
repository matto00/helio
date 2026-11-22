## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `2e12cfc0fd33b2deee2f11a43cc8a81ba6fc1b4c`. The base is `79288722ac0e0c73bb0a6dc2984588aead783767`, resolved live with `resolve-review-base.sh` (exit 0). The tree was clean apart from the evaluator's untracked `evaluation-1.md`.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/collapse-empty-counter-live-regions/HEL-1804`.

**The diff.** The only product change is in `frontend/src/features/panels/ui/form/CounterControl.css`:
- It adds `position: relative` on `.form-panel-view__compact-counter`.
- It adds `.form-panel-view__compact-counter > :is(.form-panel-view__alert, .form-panel-view__status):empty { position: absolute; }`.

`FormPanelView.tsx` is unchanged. Both `<p role="alert">` and `<p role="status">` are still always mounted (lines 397-402). The base `FormPanel.css` rules (`margin: 0`, colour under `:not(:empty)`) are untouched. The multi-field form layout is not affected, because the selector is scoped to the compact layout's direct children.

**Red first.** `git diff --stat 79288722a ce18230ca -- frontend/` is empty, so the red commit added the tests with no CSS change. The committed `red-run.txt` shows the 4 geometry tests failing with "blank space below the last content (48px) is only the layout padding (16px)". The mutation transcripts are consistent with the selector:
- M1 neutralises the selector and the 4 geometry tests go red.
- M2 drops `:empty` and the message test goes red on "in flow".

**AC1: blank space gone at 390/768/1100, light and dark.**
- I re-ran `e2e/hel1791-compact-counter-stack-height.spec.ts` myself: DEV_PORT=7236, lane DB, 1 worker. All 6 passed. Transcript: `.concertino/scratch/HEL-1804/skeptic-final-e2e.txt`.
- I also ran my own isolated Playwright script with a separate browser context, not the shared MCP browser, because the session cookie is shared across ports. It covered owner and editor, light and dark, and 390/768/1100/1440.
- For each case I measured the gap above and below the content, then re-measured with a "before" override (`position: static !important` on the empty regions).
- After the fix, at every stack width in both themes and both roles:
  - The space above and below the content is 16/16 px, which equals the layout padding.
  - The card is 95 px for the owner and 110 px for the editor.
  - Both regions are `position: absolute` while empty.
  - There is no horizontal overflow.
- With the before override, the space below is 48 px and the card is 127 px (owner) or 142 px (editor). The -32 px difference is the two phantom gap slots.
- Durable copy of the measurements: `/home/matt/Development/helio/.concertino/runs/HEL-1804/evidence/.concertino/scratch/HEL-1804/skeptic-ui/measures.json`.

**AC2: messages still show and are announced.**
- **Status message (owner, 390).** The status region is `static` and in flow. The card grows by 31 px and the text sits below the counter.
- **Alert message (submit mocked as a 400).** The alert region is `static` with the text "Skeptic rejected step".
- **Accessibility tree.** `ariaSnapshot` of the empty card lists both `alert` and `status` nodes. After the rejection it shows `alert: Skeptic rejected step`.
- **Same-element check.** The committed e2e test checks that the message lands on the same element handle that was captured before the step, which covers the live-region requirement.

**AC3: other kinds keep their height.**
- My run of the per-kind recorder gave these deltas against the committed `heights-before.json.txt`:
  - Output, Text, Markdown, Image, divider and Multi-field form: +0.0 px at 390, 768 and 1100.
  - The counter card: -32.0 px.
- This reproduces the executor's and the evaluator's diffs.

**Gates I re-ran**
- The `CounterControl.css.test.ts` guard passes 3/3.
- `prettier --check` is clean on the three changed source and test files.

I relied on the evaluator's pasted results for the full lint, typecheck, jest and build runs and for the 24-test Playwright regression batch. They are unambiguous, and the only product change is one CSS rule.

**Design judgment (DESIGN.md)**
- No new values are introduced; the gap stays `--space-4`.
- I looked at screenshots at 390 (editor, dark, before and after), 1100 (dark), 1440 (light grid), and the status and alert states.
- After the fix the content is optically centred, with equal top and bottom padding. It matches the Text card above it in the stack, with no dead band, in both themes.
- In the desktop grid (1440) the counter row is now truly centred (59/59 px, against 43/75 px before) instead of riding 16 px high. Design D2 intended this, and it is an improvement.
- A message pushes the card taller in the stack. That is reasonable for transient feedback.

Durable screenshots:
- `/home/matt/Development/helio/.concertino/runs/HEL-1804/evidence/.concertino/scratch/HEL-1804/skeptic-ui/shots/editor-dark-390-before.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1804/evidence/.concertino/scratch/HEL-1804/skeptic-ui/shots/editor-dark-390-after.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1804/evidence/.concertino/scratch/HEL-1804/skeptic-ui/shots/owner-light-390-status.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1804/evidence/.concertino/scratch/HEL-1804/skeptic-ui/shots/owner-dark-390-alert.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1804/evidence/.concertino/scratch/HEL-1804/skeptic-ui/shots/owner-light-1440-page.png`

**Servers.** Backend PID 1898546 has its listener (PID 1902504) on port 10143. Frontend PID 1902959 has its child (PID 1902985) on port 7236. All of them have `/proc/<pid>/cwd` inside this worktree. `/health` returns 200, and Vite serves the HEL-1804 rule. I reused the servers and did not restart them.

None of these claims rest on mtime ordering. They rest on `getBoundingClientRect`/`getComputedStyle` readings and on git content diffs.

### Verdict: CONFIRM

### Non-blocking notes
- **Pre-existing, not caused by this change: a duplicated rejection message.** On a rejected compact step, the same text appears twice and is announced twice: once in the field's `ui-form-field__error` (`role="alert"`, left-aligned) and once in `.form-panel-view__alert` (centred). See `owner-dark-390-alert.png`. The markup that does this is unchanged by this diff. It may be worth a follow-up ticket.
- **Same phantom gaps in the multi-field form.** The multi-field form (`.form-panel-view__fields`, gap `--space-3`) has the same pattern. The design defers it as out of scope, and I agree it belongs in a follow-up.
- **Test residue on lane DB `helio_hel1804`.** My throwaway dashboards and sources were deleted through the API. These users remain, for exact-id cleanup:
  - 77f75b59-bbb3-4a0a-b7ea-4caf46801a59 and 4398acc6-9fe6-4cc1-9780-9d3e4ec60cdb, from the successful run.
  - 6a098d4c-7cd8-4040-8c28-21743764a2a3, and its editor, from my first script attempt (listed in `skeptic-ui/measures-attempt1.json`). That attempt's dashboard and source were deleted by its `finally` block.
  - The second attempt's ids are in `skeptic-ui/measures-attempt2.json`.
