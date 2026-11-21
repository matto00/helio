## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
- Spawn guard: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/hover-probe-wait-hang/HEL-1813`. HEAD is `afc2a687286a73b22660e613adef2dbb85d0d517`. The change dir is untracked (planning only).
- I re-read ticket.md, proposal.md, design.md, tasks.md and skeptic-design-1.md. There are no TODO/TBD placeholders. All three ticket ACs are covered: root cause (1.2-1.4), 20 passes with a bounded worst case (3.2, 2.2), and the mutation going red (3.1).
- Ground truth re-checked:
  - `e2e/hel1790-hover-probe.spec.ts:37-46` is the unbounded rAF `waitForFunction`. `:19-21` is the unbounded `noAnimations`. `:31` is `setTimeout(240_000)`. `:51` is the `top <= 250` stall.
  - `frontend/src/shared/motion/BottomSheet.css:24` has `.ui-modal.bottom-sheet[open] { animation: bottom-sheet-in ... backwards }`, and `:65` has the subtle-motion fade.
  - `playwright.config.ts:54` has `testDir: "./e2e"`.
  - `grep -rln hel1790Rest e2e/` returns hel1675, hel1735 and hel1790.
- Round-1 change requests:
  1. **CR1 (missing hel1735 consumer): addressed** in proposal Impact, proposal Non-goals, design Non-Goals and task 3.4. Task 3.4 now requires both hel1675 and hel1735 to pass in full. Design Decision 5's last sentence still names only hel1675 (see notes). The task wording is a strict superset, so this is not a contradiction an implementer could act on wrongly.
  2. **CR2 (race-free capture): addressed in substance.** Decision 3 now requires the capture to be installed in the page before the click, e.g. a capturing `animationstart` listener filtered to `bottom-sheet-in` that pauses synchronously. It explains why a post-click `getAnimations()` lookup races. It requires a fail-fast message if the animation is never captured or has already finished. Task 2.1 carries that acceptance signal. Animation events bubble from the `[open]` dialog to `document`, so a document-level capture listener is viable.
  3. **CR3 (red-rate bar): addressed** in task 3.1. Each mutation must be red in every run, in each theme, with N >= 5 per theme. Otherwise the rate must be at least the HEL-1790 baseline (7/10, 3/6), with the shortfall explained. Task 3.1 also adds a confirmation that the `top <= 250` stall fires, which picks up my round-1 scope note.
- Round-1 non-blocking notes:
  - The band width is now stated correctly (about trigger height - 6 px) and is to be measured.
  - The probe's location relative to `testDir` must be stated (Decision 2, task 1.5).
  - The theme discriminator (dark runs first, cold load) is named in Decision 1.
  - The subtle-motion fade has a risk entry with a fail-fast assertion.

### Verdict: CONFIRM

### Non-blocking notes
- **Doc sync.** Design Decision 5 still reads "then `hel1675-shared-hover.spec.ts` must still pass" and "report the measured red rate", with no threshold. Tasks 3.1 and 3.4 are the binding, stricter versions. Bring Decision 5 into line when the design is next touched.
- **Residual race in the `animationstart` option.** `animationstart` is dispatched during a later frame's animation update, not at the instant the animation is created. A long main-thread stall between those two moments (the CI jank condition itself) could let a 280 ms slide finish before the handler runs. A finished animation with `backwards` fill is then absent from `getAnimations()`. The design turns that case into a fast failure, not a hang, so it meets the ticket. Still, there is a strictly race-free mechanism, which Decision 3's "equally argued mechanism" already allows: before the click, inject a style rule that pauses the animation, e.g. `.ui-modal.bottom-sheet[open] { animation-play-state: paused !important }`. That creates the animation paused at currentTime 0 whatever the frame timing. The test can then seek and `play()` it. Prefer this approach, or state why the listener cannot be outrun.
- The design says the click ended at 612025. My own parse of the trace in round 1 put the click's end at 612014.8 and the wait's start at 612026.8. This does not matter to the cause, but root-cause.md should cite measured values.
- workflow-state.md `TICKET_TYPE: feature` is still cosmetic.
