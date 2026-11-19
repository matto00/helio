## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD `afd583ef87e751836394df5416aeba0de1fd0de7`. This round was scoped by the orchestrator to two things: skeptic-final-2's CR1, and a regression look at the round-1 UI fixes. As instructed, I did not re-open the backend, cost safety, R3/R3b or the tick pass.

### What I verified (with evidence)

**Setup.** The cwd guard returned READY. I ran the lane servers with `start-servers.sh` (7175/10082), then `assert-phase.sh servers`, which returned PASS.
- Environment: `DATABASE_URL` pointed at `helio_hel1743`, `DB_USER` set, `ANTHROPIC_API_KEY` empty.
- The backend logged `insight renders disabled`, so no model call was possible.
- I read no `.env` file.

**1. CR1 fix (commit afd583ef8).** I read the diff of `InsightPanelBody.tsx`, `InsightPanel.css` and the test.

- **Structure.** The `notRendered`, `failed` and `rendering && !render` branches now each return a single `panel-content panel-content--state` wrapper with no role. Inside it are a `role="status"` block (`.insight-panel__state`: a centred grid of label and detail), followed by the action. The action's fragment holds the inline alert and the button. `.panel-content--state` is `flex-direction: column`.
- **Live DOM check.** I seeded a throwaway beta owner on the lane DB with two cards: one never rendered, and one with a real keyless run that recorded a failed attempt. Measured on both cards:
  - `status.contains(button) = false`
  - the status block and the button share a parent: `panel-content panel-content--state`, with no role and computed `flex-direction: column`
  - the button's top is below the status block's bottom (220 vs 212, and 412 vs 404)
  - the button and the status block share a horizontal centre (597 = 597)
- **Visual check: the action sits under the message in both themes.**
  - Light, both no-render states: `/home/matt/Development/helio/.concertino/runs/HEL-1743/evidence/.concertino/scratch/HEL-1743/skeptic3-board-A.png`
  - Dark, both no-render states: `.../skeptic3-board-dark.png`
  - In both: one centred column with the label, then the detail, then "Update insight" directly beneath. This matches the sibling `PanelContent` "Not run yet" pattern.
- **Inline failed-start alert.** I made six API refreshes of the failed Output (all 202), then clicked the UI button. The 429 rendered "Couldn't start an update. Try again shortly." It sits inside the column, under the message and above the button, centred, and fits in the default card.
  - Dark: `.../skeptic3-429-dark.png`
  - Light: `.../skeptic3-429-light.png`
- **"Updating…" appears once.** In the `rendering && !render` branch the button is called with `renderAction(false)`, so it keeps the "Update insight" label (disabled, `aria-busy`) while the status reads "Updating…". This is covered by the new jest test `says Updating… once` (`getAllByText("Updating…")` has length 1).
- **Does the new jest test catch a regression?** The test `puts the status and the action in ONE centred column container` asserts `status.parentElement === action.parentElement`, that this parent has the `panel-content--state` class, and that it has no role.
  - Under the pre-fix sibling-fragment layout, the status's parent is the render container and the action's parent is `.insight-panel--action`, so the test fails.
  - `evidence/red-runs.md` cycle 5 records RED against the unchanged panel: `3 failed, 24 passed`.
  - I did not re-run that red myself, because I am not allowed to modify code. The failing condition is direct from the DOM shape, not inferred.
- **Jest.** I ran `npm --prefix frontend test -- --testPathPatterns=panels/insight`: 5 suites, **61 passed**, 0 failed.

**2. Regression look at the round-1 fixes.**
- **The note sits before the action and is visible in the rendered state.** I seeded an `ok` render and a newer `skipped_quota` attempt. The text, then "Not updated: the daily AI limit was reached.", then the action, render in that order. The note is fully visible at the default size (`.../skeptic3-rendered-light.png`). The action is partly below the fold and reachable by scrolling, the same accepted non-blocking note as round 2.
- **Naming.** The card's buttons are "Refresh Fresh insight" (the header's free re-read) and "Update insight" (the costed action). They are distinct.
- **A 429 shows an inline message.** Confirmed above, in both themes.
- **Pending stays on the button.** The rendered branch hides the separate "Updating…" note while `refreshing` (`state.kind === "rendering" && !refreshing`), and the button label carries the pending state. Unchanged from the round-2 check.

**Console.** The only errors were resource-load lines for the expected responses: a 404 on `runs/latest` for the never-run pipeline, and the deliberately provoked 429. There were no application errors.

**Residue and hygiene.**
- I deleted the throwaway user `678643b6-162b-4361-bf7f-523eb04e9e82` by exact id and email, using `buildUserDeleteSql` on `helio_hel1743`. Counts afterwards for the user, its 2 pipelines, its insight rows and its dashboard are all 0.
- Servers were stopped with `stop-servers.sh`.
- No pkill/pgrep/killall, no model call, and no `.env` read.

### Verdict: CONFIRM

### Non-blocking notes
- The rendered-state action is still partly hidden below the fold at the default size when the render is two lines plus the note. It is reachable by scrolling, and this was already accepted in round 2.
- `start-servers.sh` needs `DB_USER` alongside a credential-less `DATABASE_URL`. Without it, Flyway fails with "no PostgreSQL user name specified", so a brief that says only "set `DATABASE_URL`" is incomplete.
