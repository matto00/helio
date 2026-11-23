# HEL-1618: Minimum-height form panel clips its fields and Submit button

## Description

A form panel at the grid's minimum height (4 rows) cannot show its own content. With two fields and a Submit button,
`.panel-content--form` (`overflow-y: auto`) holds 210px of content in a box about 160px tall, so Submit is scrolled
out of view and the user has to scroll inside a small card to submit. Found during HEL-1576's content-fit check; it
existed before HEL-1576.

Measurements at 1280px (one 4-row form panel, two fields plus Submit): 18px gutter — panel 262px, visible box 159px,
51px hidden; 12px gutter (HEL-1576 without its short-card rhythm) — panel 244px, box 141px, 69px hidden. HEL-1576's
tighter rhythm for `h <= 4` cards gives back 24px, leaving an estimated (not measured) ~45px hidden. Re-measure first.
Since filing, HEL-1804/HEL-1819 collapsed empty live regions and HEL-1791 changed mobile stack sizing for forms.

Options to weigh (a product/UX call — escalate with a recommendation before building):
- A form-specific minimum height (e.g. 5 rows) enforced on placement and resize.
- A compact form layout at small container heights (container query on `panel-card`).
- A sticky Submit row inside the scroller.

## Owner scope additions (2026-11-23, from HEL-1819's review)

1. Split `FormPanelView.tsx` first, without changing behaviour. It is about 481 lines, over CONTRIBUTING's roughly
   400-line threshold. Record the jest and e2e counts for the form specs before and after the split; they must be equal.
2. Stale invalid state for a non-owner's compact counter. A compact counter used by an editor (non-owner) never
   reconciles (`FormPanelView.tsx` around lines 220-223). So after a rejected step, a later click that gets no response
   leaves the control `aria-invalid="true"` and red, with no message. HEL-1819 fixed the owner case: a successful
   reconcile clears the stale field error. Extend the same clearing to the non-owner path, using whatever signal that
   path has, or a reconcile the editor is allowed to make. Follow the owner rulings from HEL-1818 and HEL-1819: the form
   alert carries the rejection, and the live regions stay mounted. AC: a test that fails first.

## Acceptance Criteria

- [ ] At the minimum height a form panel with two fields shows its Submit button without scrolling, or the grid stops
      the panel from being made that small
- [ ] Measured live at 1280 in both themes, before and after
- [ ] `FormPanelView.tsx` split with no behaviour change; form-spec jest and e2e counts recorded before and after, equal
- [ ] A non-owner's compact counter no longer keeps a stale earlier-burst rejection error after a later no-response
      step; proven by a test that fails first
