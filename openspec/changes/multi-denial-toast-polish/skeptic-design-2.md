## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `b2da43a3d02ba1b84eb8296b9bd9ed742623a353`. The change dir is untracked, so I reviewed the artifacts as they are on disk. No servers were started.

### What I verified (with evidence)
- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/multi-denial-toast-polish/HEL-1840`. I read the constraints in `.concertino/scratch/HEL-1840/constraints.txt` and followed them: no `.env` reads, no servers.
- **Tickets:** I read HEL-1840 and HEL-1844 live from Linear. The ACs in `ticket.md` match both word for word.
- **Live code, read in full:** `deniedPipelinesToast.ts`, `ToastRowList.tsx`, `Toast.tsx`, `useScrollEdges.ts`, `toast.css`, `theme.css` and DESIGN.md (§6 primitives, the scroll-fade inset note at about line 433, and the hardcoded-value rules).
  - `deniedPipelinesToast.ts:31` sorts once by id with `localeCompare`, and the message (`:33`) and the items (`:40`) both use that order. This matches design.md's Context section.
  - `Toast.tsx` hides `.toast__message` when items exist, so the list is the first box in `.toast__body`.
  - In `toast.css`, the list has `padding: var(--space-1)` on desktop and `padding-block: var(--space-4)` in the `(max-width: 768px), (pointer: coarse)` block, and `.toast__icon` has `margin-top: 1px`. These match D2's figures.
  - `--app-surface-strong` is `#262320` in dark and `#ffffff` in light (`theme.css:351` and `:441`). This matches D3.
- **Round-1 CRs, each checked against the current text:**
  - CR1 (hand-rolled primitive) is resolved. D3 and task 2.3 now use the shared `useScrollEdges<HTMLUListElement>()`. I checked the re-measure argument against the hook source. It observes the container and the children that exist at mount (`useScrollEdges.ts`, effect). A run action's removal shrinks an observed `li`. A different denial set produces a new toast id, and `ToastViewport` keys `ToastItem` by toast id, so the list remounts. No fork of the hook is needed.
  - CR2 (message order) is resolved. One sorted array drives both the message and the items. Name-then-id is a total order because ids are unique, so the byte-identical coalescing invariant holds whatever order the input arrives in. A new scenario and a new test cover input-order independence. The only consumers are `FormPanelView.tsx` and the tests (grep).
  - CR3 (D2 arithmetic) is resolved. The negative-margin technique is rejected, with the 13px vs 13.6px arithmetic recorded. The icon now moves instead of the list. That never puts list content into the toast's border band.
    - I checked the alignment analytically. In the single-message toast, the text top equals the body top and the icon top is body top + 1. In the multi-row toast after the change, the link top is body top + P and the icon top is body top + P + 1, where P is the list padding. The offsets are identical, so the 1px criterion is achievable by construction.
    - The order of precedence is stated: expander extent, then no paint outside the border, then alignment.
    - A mid-scroll check at 390px in both themes was added to D4, task 1.3 and task 3.2.
  - CR4 (empty heading) is resolved. `tasks.md` now restates the binding run constraints.
- **Collation claim:** I ran Node with `Intl.Collator("en",{numeric:true})`, which gives `alpha|Beta|Gamma|Gamma|Pipeline 2|Pipeline 10|Zeta`. That matches the spec scenario and D1.
- **Spec delta:** `openspec validate multi-denial-toast-polish --strict` printed "valid". The MODIFIED requirement carries the full base requirement text from `openspec/specs/run-to-update-affordance/spec.md:10`. The only differences are the added sentences, plus 5 new scenarios.
- **Fade stacking:** I checked the fade against the touch expanders on paper. The frame's `::after` is positioned and comes after the `ul` in tree order, so it paints over the link and action text. The expanders' `::after` have `z-index: 1`, so they stay above it and are transparent. With `pointer-events: none` on the fade, hits still reach the controls. The existing `bisectHitExtent` 390px test (`e2e/hel1172-multi-denial-toast.spec.ts:210`) guards this.
- **DESIGN.md:**
  - The fade is a `background-image` gradient on a token, not a `box-shadow`, so the elevation-token guard is not involved.
  - D3 records the deliberate departure from the HEL-1449 inset-shadow scroll fade, so the final gate can judge cohesion.
  - No raw px is added beyond the existing 1px icon nudge.
- **AC coverage:**
  - HEL-1840 AC1 maps to D1 and D4 unit tests. AC2 maps to the D2 e2e criterion plus screenshots in both themes (tasks 1.3 and 3.2). AC3 maps to the D3 unit tests and the e2e present/absent checks.
  - HEL-1844's four ACs map to the D1 sort, the coalescing test, the e2e Tab order and the D4 mutation (comparator reverted to id goes red).
- **Placeholders:** none found (no TODO or TBD markers).

### Verdict: CONFIRM

### Non-blocking notes
1. **Small internal inconsistency on desktop.** design.md's Non-Goals say "changing desktop toast layout beyond what the cue needs", but D2 also moves the desktop multi-row icon (`calc(var(--space-1) + 1px)`, about 4px). The proposal and the spec only mention phone width. The desktop shift is coherent: it removes a 3px misalignment of the same kind. The executor should state it in the proposal's What Changes, or drop it. Either way, the final gate should see a desktop before/after.
2. **Existing unit tests assert id order.** `deniedPipelinesToast.test.ts:58-74` has "(sorted by id)" in its title, and `:81-88` expects `["p1","p2"]`. With the names "Sentiment pipe" and "Big pipe", name order reverses that. Rewriting these tests is the requirement change, not fixture drift. Say so in the commit or report, so the final gate does not read it as a fixture edited to make the suite pass.
3. **The e2e Tab-order check cannot always tell name order from id order.** With seeds "HEL-1172 Alpha" and "HEL-1172 Beta" and server UUIDs, name order equals id order in about half of runs. The unit-test mutation is what guards against a revert to id order. That is acceptable. A third seeded pipeline would raise the chance of a run that discriminates, if the executor wants that.
4. **At phone width, the icon moves about 17px down while the 44px close button stays at the top.** D2 already lists this as a risk. The final gate should judge it in the before/after screenshots.
