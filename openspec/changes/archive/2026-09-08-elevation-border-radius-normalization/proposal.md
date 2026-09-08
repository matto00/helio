## Why

Measured, the drift this ticket was filed against has largely already been paid down: 12 of the 17 literal radii are
the correct circle idiom, and the "accent-tinted structural borders" are the documented `--app-accent-mid`
selection-border token rather than a violation. Of 47 `box-shadow` declarations, 22 use neither elevation token — but
they are focus rings and scroll-fade edge affordances, two families **no elevation token applies to** (see design D0;
an earlier draft of this proposal reported "zero literal" from a flawed measurement). What has
never existed is anything that **holds** that state — nothing in the repo fails when a new literal shadow or an
off-scale radius is added. HEL-441 found the same shape and reached the same conclusion: the durable deliverable is
the guard, not the cleanup.

## What Changes

- **An elevation guard**, alongside `motionTokenGuard.css.test.ts` and `tokenAuditSweep.css.test.ts`: no CSS module may
  declare a literal `box-shadow` or an off-scale `border-radius`, with a small pinned exception list.
- **`50%` is named an allowed radius value, not an exception.** It is the correct expression of a circle and applies
  to 12 live declarations; treating it as drift to be exempted would invite a future "cleanup" that breaks avatars,
  the spinner and the toggle knob.
- **The five sub-scale radii are decided deliberately, one at a time**, on the running app — not snapped.
- **`BottomNav.css`'s `backdrop-filter`** is resolved against the opacity invariant. `Modal.css:60`'s is NOT touched:
  it sits on `.ui-modal::backdrop`, which **HEL-1035** owns.
- **DESIGN.md** records the `50%` rule and whatever the sub-scale radii decision turns out to be.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — CSS and documentation only, no product behaviour or contract change. `skip_specs: true` is set.

## Non-goals

- **Rewriting the 46 accent-border sites.** They are correct; `DESIGN.md:93` blesses `--app-accent-mid` for selection
  borders. This is stated as a non-goal precisely because a reviewer reading only the ticket would think otherwise.
- **`Modal.css:60`'s `backdrop-filter`** — HEL-1035's surface.
- **The `var(--*)` resolution guard** — HEL-1037, filed High, its own run. `PipelineDetailPage.css` carries defects
  belonging to it; do not fix them here.
- HEL-866 (light-theme modal hover tokens), HEL-830 (spacing literals), HEL-444 (this lane's next ticket), HEL-350,
  HEL-538, HEL-443, HEL-1006, HEL-1023, HEL-1032, HEL-1033, HEL-1034.

## Expected shape of the diff — stated up front so a small diff is not read as under-delivery

**Guard + docs, and possibly ZERO other CSS change.** That is the honest projected outcome: the shadows are two
families no elevation token covers, `50%` x12 is correct, the five sub-scale radii default to LEAVE, the accent
borders are correct, and both `backdrop-filter` sites are either settled (BottomNav, HEL-774 carve-out) or owned
elsewhere (Modal, HEL-1035). If the running-app checks in tasks 4.2/4.3 surface a real elevation mismatch, that is
genuine work; if they do not, the ticket ships a guard and documentation. Padding it would mean changing correct code.

## Impact

- One new guard test, `DESIGN.md`, and at most a handful of small radius declarations.
- No backend, no migration, no API change.
