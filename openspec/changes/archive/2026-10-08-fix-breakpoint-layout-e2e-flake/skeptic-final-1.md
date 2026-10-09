## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `1d53ea7b73a6b7a6e9e53c9936195fac61e9121a`. The diff base was resolved live as `7e1df62a67ada4de6dd2499cbb5d84cec69e7dbb` (`resolve-review-base.sh`, exit 0). The spawn-cwd guard printed `READY`.

### What I verified (with evidence)

**1. Root cause: a test-side race. The product is correct.** I checked this against the CI trace myself rather than relying on evidence.md.

- I decoded every `readRects` result in `trace-x/1-trace.trace` (untrusted data, parsed with `python3 -I`):
  - `setViewportSize(1500)` ran at 32747.
  - At 32832, 32892 and 33204 the container read `x=264 w=1212`.
  - All **8** items read pixel-identical to the pre-resize lg read at 32231. For example, P8 was 1079/797 (right edge 1876), P2 was 807/1069 (1876), and P1 was 264/525.
- If RGL had received width 1212 with any cols, every item width would have rescaled. Identical widths mean RGL's `width` prop was still 1612 when the test read the rects. The product had not yet received the width, so this was not stale geometry after a re-layout.
- Screencast frames were still being produced (32930 to 33856, about every 45 ms), so the page was not hung.
- evidence.md says "bad=4/8 stale". In fact all 8 are at lg geometry, and only 4 fall outside the md bounds. This is a wording issue only (see notes).
- RGL v2.2.4 source (`frontend/node_modules/react-grid-layout/dist/chunk-7ZM5LVH2.mjs:1402-1452`): the width effect sets breakpoint, cols and layout and calls `onWidthChange(width, …)` in the same effect. A `setState` in that callback therefore commits in the same batch as the new breakpoint and cols. `onWidthChange` fires only when width, breakpoints or cols change, and it reports the current `width` prop.
- `PanelGrid.tsx:69` switches between stack and grid on the same `width` prop. That prop comes from `useContainerWidth`, which observes `.panel-list__zoom-container` (`PanelList.tsx:76`). So the stack branch's own race has the same cause.

**2. The fix waits on the cause, not on a tuned timer.**

- `--panel-grid-processed-width` is set only from RGL's `onWidthChange`. It can equal the expected width only after RGL's width effect has run for that width.
- The remaining wait has two parts:
  - **`settleTransitions(page, 5_000)`**: a rAF plus a wait for running CSS transitions. The 5 s is an upper bound, not a sleep.
  - **The existing stability loop**: unchanged.
- After the property commits, RGL's inner layout sync is an ordinary React effect or task and needs no rendering opportunity. So the residual race the old poll had (the rendering-gated RO→rAF chain) is gone.
- The new wait also cannot hide the product-bug alternative. The geometry assertions still run after it, so an RGL that processed the width but left an item at lg geometry would still fail the test.

**3. Can the waits pass vacuously? No.**

- **Desktop poll:**
  - The value starts at `useState(width)`, which is the same width RGL initialises its breakpoint from.
  - It changes only through `onWidthChange`.
  - Every consecutive width the spec visits is distinct: 1612, 1212, about 912 and about 768.
  - Before the resize the property holds the previous width, so the poll cannot pass early.
  - After a reload, the mount width is the width RGL itself mounted with.
- **Stack branch:**
  - `.panel-grid` exists at the moment of the resize and is removed only by the same synchronous `isPhone` switch that mounts `MobilePanelStack`.
  - Its 8 items are then checked by the existing reading-order and geometry assertions, so a missing stack would fail.
- **Style merge:** RGL merges `style` as `{height: containerHeight, ...style}` (l.1221-1223). Passing only a custom property keeps RGL's height. `grep` finds no CSS that consumes the variable.

**4. The unit test is a real guard.**

- I ran `DesktopPanelGrid.processedWidth.test.tsx` myself: 2/2 pass.
- I ran a mutation on a `git archive` copy in the scratchpad (the worktree was not touched). I changed the style to use the `width` prop instead of `processedWidth`, which is the naive implementation the race lives in. Result: **1 failed, 1 passed**. The "does not advance on a new width prop alone" case catches it.
- If the wiring were removed, `lastProps().onWidthChange` / `style[PROP]` would be undefined, so both cases fail by construction. The evaluator measured this as 2/2 red; I did not re-run it.

**5. Red→green with injected delay. I reproduced it myself; I did not rely on evidence.md.**

- **Setup:** scratch copies of the spec with only one line added, a `beforeEach` init script that delays every ResizeObserver callback by 900 ms. Run with `nice -n 19`, `DEV_PORT=6845`.
- **Pre-fix spec** (base `7e1df62a`), `--grep C_lg_coords_everywhere --repeat-each=4 --workers=2`: **4/4 failed** with `C_lg_coords_everywhere light @1500 (md) P8 Divider right`, Expected `<= 1478`, Received `1876`. This is byte-for-byte the CI signature.
- **Post-fix spec, whole file** (5 tests), `--repeat-each=2 --workers=3`: **10/10 passed**.
- **Real spec, no injection**, `--repeat-each=3 --workers=3`: **15/15 passed** (52.5 s).
- **Dev server check:** I confirmed the reused dev server on 6845 serves this worktree's code (`curl` of the served `DesktopPanelGrid.tsx` contains `panel-grid-processed-width`).

**6. Is the AC1/AC5 substitute evidence technically sound?** Yes, as a mechanism reproduction. The owner escalation is **not decided here**.

- The injection targets exactly the link the CI trace shows was late: width delivery to RGL.
- It reproduces the CI failure signature deterministically.
- The fix waits on RGL's own report and does not depend on what delayed the delivery: RO, rAF or frame production.
- The limits are stated honestly in evidence.md:
  - 0/182 natural local failures, so p_low = 0 and Decision 3's sample size cannot be computed.
  - Natural occurrence is known only from CI history (≥8 failing attempts).
  - The injected RO delay is a proxy for CI's late rendering opportunity, not the same thing.
- Whether that satisfies AC1/AC5 is the owner's call (`PENDING_ESCALATION`).

**7. ACs and constraints.**

- **AC2** (root cause probe-confirmed): met. Each alternative cause is refuted in evidence.md, and the trace decode above independently supports the conclusion.
- **AC3** (fix at the root cause): met. The cause is test-side and the product is correct. The product change is observability only, with no layout change.
- **AC4 / C1** (no loosening, retries or sleeps): met.
  - The diff only adds lines to `settledRects`.
  - The ±2 px tolerance, the assertions, `retries: 0` and the pre-existing 150 ms stability loop are unchanged.
  - No new `waitForTimeout` was added.
- **AC6** (regression guard for a product fix): not applicable as a product fix, but a guard exists anyway (the unit test above).
- **C4:** `ci.yml` is not in the diff.
- **C2:** I followed it myself: at most 3 workers, `nice -n 19`, and no pkill/pgrep/killall.

**8. Gates I ran on the changed files:** eslint (`--max-warnings=0`), `npm run typecheck`, `check:e2e-types` and prettier `--check`, all exit 0. The evaluator's full-suite gates are pasted in evaluation-2.md and consistent with this.

**9. UI and design judgment.**

- The only frontend change is a CSS custom property on the RGL root's inline `style`. It carries no styling, no CSS consumes it, and it does not override `height`.
- Nothing changes visually, so there is no token, spacing or light/dark divergence to judge.
- The hel1023 spec, which I ran 15/15 green, asserts exact item geometry, containment and no-overlap at every width in **both** themes. That is a stronger layout check than a visual inspection.
- I did not use the Playwright MCP browser, because it wrote into the main checkout during evaluation 1.

**10. My dev-DB residue.** I created 29 throwaway users and deleted nothing.

- Every dashboard was removed by the spec's `afterEach`. A read-only query confirms 0 dashboards are owned by these users.
- Exact ids:

```
c612d33b-71e3-4ab6-8ed2-5bb4f733554a 2b78d2b0-8e85-4582-ada5-f3205317815d 9deebef2-0401-4ff6-8b7f-c2e452fd1493
9d0e37e0-516e-4f33-ada2-0d9ee0092224 a57c47ea-cf64-42bf-b459-396045e8f536 34669bc5-9ede-4156-ac90-b8dbed91950e
0ea70b1d-641a-4403-8726-2d029138064d 962fcad5-051d-4e04-9625-02828dbea099 9de99dc5-95f6-433d-a20b-50d67ac65a7f
dbaf5663-af01-40a0-80e1-e38664ffac8e 3b9d054f-363c-4b5d-bb77-c551b74c5f2a dc97a122-ab25-409b-b7a3-3bb6cb8d4621
1cf1b1a4-63f4-47db-8a1c-c78867e7b95b 446264b0-6421-418b-8433-652a66cf486e 7d6af8bf-5f3d-4086-889d-885ca264f7d2
4cce115d-c5fe-4e5b-8135-ef53011e8742 5297072e-bc26-4280-966c-1edfe2a692cc a643923f-c50c-4334-8f32-ab1357ec5afd
9bad1252-f1b4-45da-b1b3-e3b3f9ed8340 af643cd6-f4a4-42bc-bebe-4981bdaeeb5b 6d0bbd0b-3b52-41ed-8ff9-abcc626982c8
0974d4ad-6dd3-47a3-94bf-cf3f5460c69f 789b80c0-e343-4558-b80e-6df95a8faede eab46b4a-33f7-4684-9178-d7376706efbe
4fef640c-9027-4828-9028-482204762528 74c75944-b99f-48c5-a15a-eec63d101430 c6282b82-c2ab-4f5e-8ca0-4cb60606869d
cc483cad-a933-4315-92e0-5deb1a5f015f ca10305b-b3e9-4d64-851e-17360d30153e
```

All of these have the email pattern `hel1023-17915025xxxxx-*@example.test` and were created 2026-10-08 16:35:50 to 16:38:16 (-07).

**Gate-defect check:** none of the conclusions above rest on mtime or positional ordering. The trace timings are content timestamps inside the trace file.

### Verdict: CONFIRM

On everything within this gate's authority, the change ships. The open owner escalation about whether the injected-delay plus CI-history evidence satisfies AC1/AC5 is not decided here. That evidence is technically sound as a mechanism reproduction.

### Non-blocking notes

- evidence.md says items were "stale … bad=4/8". The CI trace shows all 8 items at exact lg geometry, and 4 of them out of md bounds. Suggest rewording to "all 8 at lg geometry, 4 out of bounds".
- The evaluator's notes still stand:
  - The residue window bound in evidence.md is the query bound, not the newest row.
  - `DesktopPanelGrid.tsx` is now 428 lines, over the ~400-line guidance; mention a split in the PR.
- Residual theoretical window: after the property commits, RGL's inner layout sync happens one React task later. The pre-existing 150 ms stability comparison covers it. That sync is scheduler work and is not gated on a rendering opportunity, so it is not the race this ticket closed.
