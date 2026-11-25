# HEL-1840: Multi-denial toast polish: sort rows by name, align first row at 390px, cue when the list scrolls

## Description

HEL-1172 (PR #1250) made the multi-pipeline denial toast list every denied pipeline, each with a link and, where the writer can run it, its own "Run to update" button. The list scrolls past `min(40vh, 16rem)`. The reviews left three small polish items:

1. **Order.** Sort rows by pipeline name, with the id as the tie-break, so the order is stable across writes.
2. **Alignment at 390px.** The first row does not line up with the warning icon on phone width.
3. **Overflow cue.** When the list overflows and scrolls, nothing shows that more rows are below. Add a visual cue (for example a fade at the bottom edge) that stays legible in both themes.

## Acceptance criteria

- [ ] Rows are ordered by name, then id, with a test.
- [ ] The first row aligns with the icon at 390px, shown in screenshots in both themes.
- [ ] An overflowing list shows a cue; a list that fits shows none.

## Folded-in duplicate: HEL-1844 acceptance criteria

HEL-1844 ("Multi-denial toast: order the listed pipelines by name, not by id") covers item 1. Its AC are covered here:

- [ ] Rows render in pipeline-name order; equal names keep a stable order.
- [ ] The coalescing message stays byte-identical.
- [ ] Keyboard Tab order follows the rendered order (`e2e/hel1172-multi-denial-toast.spec.ts` updated to expect name order).
- [ ] A unit test fails if the sort goes back to id order.

## Origin

origin_kind: followup, origin_ticket: HEL-1172. Driver notes: frontend only, no backend, no migration; compare against the running app in both themes per DESIGN.md.
