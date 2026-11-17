## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: HEAD d60b1f799d78291e165bcc1226b4a3c625c66fa0. No code has changed. The change dir and `e2e/hel1692-table-header-touch-scroll.spec.ts` (WIP) are untracked. I took the owner ruling `ship-pan-y-as-guard` and the D4 narrowing as settled, and judged D4 on soundness only.

### What I verified (with evidence)

**CR1 (name the real nested scroller): addressed.**
- D3 and task 4.1 now assert, immediately before the drag:
  - on `.ui-data-grid`: `scrollHeight > clientHeight` and `scrollTop === 0`
  - on `.panel-content`: `scrollTop === 0`
- `.ui-data-grid` is located inside the live cap `.mobile-panel-stack__item--output .panel-content`.
- C1 in tasks.md and workflow-state.md says the same thing.
- proposal.md "What Changes" now says the cap never overflows and that `.ui-data-grid` is the vertical scroller.
- The spec's second paragraph now says explicitly that a header drag starts inside that scroller, and that the "cannot scroll further" clause covers this case.
- The geometry fits the CSS. `.panel-content--table` is also a `.panel-content` (TableRenderer.tsx:201/274). So the live cap at MobilePanelStack.css:121-124 and `PanelContent.css:78-80` (`overflow-y: auto`) land on the same element, and round 2 measured that element at 487/487 and 559/559.

**CR2 (D4 and task 2.3 unambiguous and correct): addressed, and sound.**
- Only the `:102` rule is deleted. The `:54` list and its `intrinsicKinds` `"table"` entry are explicitly left out of scope.
- The false test-entry claim is replaced by the correct one: `findRuleBody` matches the first occurrence, so that entry tests `:54`.
- Repointing `mobilePanelHeights.ts:39-41` is now in task 2.3. I confirmed the citation exists at `:40`.
- The scope is safe:
  - A grep over frontend/, e2e/ and openspec/specs finds no producer of `mobile-panel-stack__item--table`.
  - The only other hits are the `:54` list, the `:102` rule itself, and a comment in `MobilePanelStack.css.test.ts:19`.
  - The HEL-1022 comment at MobilePanelStack.css:73-86 already documents `--table` in the `:54` list as dead, so leaving that list alone is a reasoned narrowing, not an oversight.

**CR3 (G2 failability loophole): addressed.**
- D2, task 2.1 and new standing constraint C3 require G2's mutation to climb from the hit `th` up to `.mobile-panel-stack__item--output`.
- They explicitly say a Notes-card control does not count.
- They require STOP-and-report if nothing on that path blocks the pan.
- C3 is in tasks.md "Standing Constraints" and in workflow-state.md `CONSTRAINTS`, with `retired: false`.

**CR4 (do not state the unreproduced symptom as fact): addressed.**
- proposal.md "Why", sentence 1, now reads "was reported not to scroll the page ... which by spec should stop ...", followed by the 8/8 non-reproduction and the untested status on iOS WebKit.
- Task 2.1's comment brief now says "could only block panning, never enable a touch resize", plus a non-reproduction note and "no untested pen claim".

**New defects introduced by the revisions:** none that block. Cross-checks:
- Tasks against design: 1.1/2.1 = D2, 2.3 = D4, 3.1 = G3, 4.1 = D3.
- Spec scenarios match the revised AC.
- The owner ruling's "capped body triaged using `.mobile-panel-stack__item--output .panel-content`" is honoured: the scroller is located through that selector.
- Task 1.1 still covers the WIP spec's `red-first` label and its "used to be dead" header.
- The WIP spec's body locator at line 232, `.mobile-panel-stack__item--output .panel-content--table`, is superseded by the 4.1/C1 wording. The implementer must retarget it to `.ui-data-grid`. Task 4.1 states that target unambiguously.

### Verdict: CONFIRM

### Non-blocking notes

- **Spec wording.** The spec says the grid scroller "is the stack's only nested vertical scroller". Read literally, that is broader than true:
  - The `--output .panel-content` cap is `overflow-y: auto` for every Output kind.
  - So an Output rendering something taller than 60dvh that is not a Table can also be a nested scroller.
  - Suggest "the Table panel's only overflowing vertical scroller". The `:102` comment being deleted ("the only stack kind with a nested scroll container") carries the same stale claim, and it goes away with the deletion.
- **proposal.md "Why" now says the non-reproduction twice** (sentence 2 and the "Reported as the root cause of the HEL-1682 flake ..." sentence). Trim one. The PR body will likely draw from it.
- **No task explicitly lists the PR body's required disclosures**, which the ruling requires:
  - not reproduced (8/8, including throttled runs)
  - iOS WebKit untested
  - fails-first AC dropped by the owner
  - dead rule deleted in this PR
  - body scrolls before the page (C2)

  Only task 1.2 and C2 cover these partly. The final gate will check them.
- **After the `:102` deletion, the HEL-1022 comment at MobilePanelStack.css:115-117** ("the same capped, internally-scrolling treatment table had") refers to a rule that no longer exists. Consider a one-word "(formerly)" touch, in the same edit as task 2.3.
- I created no new dev-DB residue. Round 2's `hel1692-skeptic-1794881018359@example.com` remains.
