## Context

- `e2e/hel1510-output-editor-table-overflow.spec.ts` opens the Output editor (a `role="dialog"` `Modal`) at 1100px,
  then, right after `expect(name).toBeVisible()`, reads `limit = contentRight(card) + 0.5` ONCE and only afterwards
  reads each control's `getBoundingClientRect().right` in a loop of ~13+ separate `evaluate` round trips.
- `frontend/src/shared/ui/Modal.css`: `.ui-modal[open] { animation: ui-modal-in var(--transition-slow) backwards }`,
  `--transition-slow: 0.28s cubic-bezier(0.3, 0.9, 0.4, 1)` (theme.css:149), keyframes from
  `translateY(var(--motion-rise-distance)) scale(0.985)` (6px rise, theme.css:177) to `none`. Subtle/Off motion and
  `.ui-modal--expanding` swap in `ui-modal-fade-in`; `Modal.tsx` can additionally run a Web Animation (`expandFrom`)
  on the dialog's transform when given an origin rect.
- HEL-1613 (`openspec/changes/archive/2026-10-15-adopt-webfonts-wait-layout-specs/evidence/probes.md`): card
  content-right sampled per rAF after the name is visible moves 871.53-871.87 -> exactly 872.000 over ~100ms with or
  without fonts; the widest control rests at exactly 872.000. Not reproduced as a failure.
- Mechanism: under the entrance `scale()`, the card edge and a control flush to it move TOGETHER, so a measurement
  frozen entirely mid-animation reads them equal and cannot go red. The false overflow needs the spec's real ordering:
  `limit` read earlier in the entrance (edge further left), controls read later or at rest (edge further right) and
  the difference exceeding the existing 0.5px margin.
- `e2e/support/settleTransitions.ts` awaits `CSSTransition`s only (not `CSSAnimation`), so it does not cover this.

## Goals / Non-Goals

**Goals:** a committed, honest red that is the spec's own assertion failing because of the entrance animation; a
narrow wait that removes it; a mutation showing the wait is load-bearing; 20/20 normal runs.

**Non-goals:** Modal.css/Modal.tsx changes; any tolerance change (the `+ 0.5` stays); retries; timeout changes;
font waits (HEL-1622 owns those; this spec has none today); other specs.

## Decisions

**D1 — the force (red reproduction) is a slowed entrance, applied identically to every run of the probe.** A probe
copy of the spec (`zzprobe1621-*.spec.ts`, run then removed; committed as `.txt` evidence alongside its logs) that is
byte-identical to the spec under test except for ONE added `page.addInitScript` that stretches the dialog's entrance
animation so it is guaranteed to be in flight when the unwaited spec reads `limit` — e.g. on `animationstart` for
`ui-modal-in`, set that `CSSAnimation`'s `playbackRate` to a small value (or `effect.updateTiming({duration})` to a
few seconds) so the edge is still travelling while the loop reads controls. It must NOT pause the animation forever
(the fixed wait would then hang, which is not a red of the assertion) and must not move the card any differently from
the real animation — only slower. The executor may pick the exact mechanism and stretch factor, but must show (in the
logs) the measured `limit` and offending control `right` in the red run. Alternative considered: hold
(`animation-play-state: paused`) through the whole measurement — rejected: card and controls stay scaled together and
the assertion stays green, which would falsely look like "premise refuted".
A `diff` of the probe against the spec under test (showing only the init-script hunk, and, for the green/mutation
runs, the wait line) is committed with the evidence so the probe provably exercises the real spec body.

**D2 — the wait: the dialog element's own finite animations finish, before any geometry read.** Immediately after
`await expect(name).toBeVisible()` and before `contentRight(card)`:
`await dialog.evaluate((el) => Promise.all(el.getAnimations().filter(finite).map((a) => a.finished)))`, where `finite`
excludes animations whose effect timing has `iterations: Infinity`. `el.getAnimations()` (not `{subtree: true}`)
covers both the CSS `ui-modal-in`/`ui-modal-fade-in` and a WAAPI `expandFrom` on the dialog itself, and never an
infinite descendant spinner. `getAnimations()` forces a style recalc so a just-started entrance is visible; an
already-finished one is absent and the wait resolves immediately. `finished` rejects on cancel -> `.catch(() => {})`
so a cancelled animation does not fail the test. No cap/timeout is added: the test's existing 90s timeout bounds it
(no timeout change). Inline in the spec (one call site); a shared helper only if the executor finds an identical
need elsewhere — it should not go looking (non-goal: other specs).
The wait must target the element the `.ui-modal[open]` rule animates; the executor confirms
`page.getByRole("dialog")` resolves to that `<dialog class="ui-modal">` element (not an inner wrapper) and, if not,
targets `.ui-modal[open]` instead.

**D3 — evidence:** red (force, no wait), green (force + wait), mutation (force, wait removed -> red again), then the
real spec 20/20 with `--repeat-each=20 --workers=2` under `nice -n 19` against the lane DB. Red is committed before the
fix commit (C12). Logs as `.txt` under the change's `evidence/`.

**D4 — if the forced run does not go red**, the premise is wrong: stop, record the measured numbers, and escalate;
do not add the wait anyway.

## Risks / Trade-offs

- [Stretching the animation changes the timing the real run sees] -> it only widens the window HEL-1613 already
  measured; the assertion and margin are unchanged, and the green/mutation pair under the same force shows the wait is
  what removes it.
- [The flake had another cause too] -> 20/20 normal runs is the ticket's bar; a residual failure in that sweep is
  reported, not retried away.

## Planner Notes

- Self-approved: inline wait in the spec rather than extending `settleTransitions` (that helper is transition-only by
  design, used by 18 specs, and capped; widening it is out of scope).
- Self-approved: `skip_specs: true` — e2e test-only, no requirement changes.
- HEL-1622 (font waits) does not touch this spec: it has no `document.fonts.ready` today.
