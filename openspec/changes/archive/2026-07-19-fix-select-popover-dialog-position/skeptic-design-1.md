## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/portal-popover-hook/spec.md` in full.
- Read `frontend/src/hooks/usePortalPopover.ts` and `frontend/src/shared/ui/Select.tsx` — confirmed the
  described mechanics are accurate: `handleOpen` computes `{top: rect.bottom+4, left: rect.left, width}` from
  `getBoundingClientRect()` (viewport coordinates, oblivious to portal target), and `Select.openPanel`
  (Select.tsx:51) portals into `triggerRef.current.closest("dialog[open]") ?? document.body`.
- Read `frontend/src/features/panels/ui/PanelCreationModal.css:12-25` — confirmed
  `.panel-creation-modal[open] { animation: panel-creation-modal-in var(--transition-slow) both; }` with a
  keyframe animating `transform`.
- **Critical finding, missed by the design**: `frontend/src/shared/ui/Modal.css:13-20` contains this exact
  same animation pattern on the shared `Modal` primitive (`.ui-modal[open]`), but with `animation-fill-mode:
  backwards` instead of `both`, and an explicit code comment:
  > "`backwards` (not `both`): the entrance animates `transform`, and a lingering forwards fill would keep the
  > dialog as a transform containing block — which re-anchors `position: fixed` popovers portalled into it
  > (Select) to the dialog instead of the viewport, mispositioning them. The `to` state equals the modal's
  > resting style, so dropping the forwards fill is visually identical at rest."
  `git show d7fb3816` ("Fix popover layering and positioning", 2026-07-03) shows this was already diagnosed
  and fixed for the shared `Modal` component using exactly this mechanism, and the commit message spells out
  the identical root cause the design.md redescribes as if novel.
- Audited every raw `<dialog>` and every `usePortalPopover`/`Select` call site (`grep -rn "<dialog"`,
  `grep -rln usePortalPopover`):
  - `PanelDetailModal.tsx` — raw `<dialog>`, own CSS (`PanelDetailModal*.css`). Grepped all 5 split CSS files
    for `animation`/`transform:` — **no entrance-animation transform at all**. Not affected, and hosts many
    `Select` usages in `editors/*.tsx`.
  - `PanelCreationModal.tsx` — raw `<dialog>`, own CSS, still `animation-fill-mode: both` — **the one
    remaining afflicted site**, and the exact site the ticket reports.
  - `CreatePipelineModal`, `AddSourceModal`, `RunHistoryModal`, `PipelinePreviewModal`, etc. — no literal
    `<dialog>` in their `.tsx`; they compose the shared `Modal` component, already fixed by d7fb3816.
  - `ActionsMenu.tsx`, `UserMenu.tsx`, `DashboardAppearanceEditor.tsx` — the other three `usePortalPopover`
    consumers — all hardcode `createPortal(..., document.body)` (never conditionally target a dialog) and are
    mounted in chrome/sidebar contexts, not inside dialogs. Confirmed via grep of their mount sites
    (`App.tsx`, `SidebarItemList.tsx`, `DashboardList.tsx`, `PanelCard.tsx`) — none render inside a `<dialog>`.
    Not affected.

So the actual, ground-truth scope of this bug today is **one file**: `PanelCreationModal.css`'s
`animation-fill-mode: both` never got the same fix that `Modal.css` received in commit d7fb3816 (presumably
because `PanelCreationModal` predates or duplicates the shared `Modal` primitive instead of using it).

### Verdict: REFUTE

The design's root-cause section (design.md:9-14) and Decision (design.md:30-44) describe this as a
general "shared popover layer needs to compensate for whatever containing block the portal target
establishes" problem, and build a JS-layer coordinate-adjustment scheme (subtracting the containing block's
rect from the trigger rect, re-derived on every open/resize/scroll) as the "leading approach." This misses
that the *actual*, already-proven, minimal fix for this exact defect exists in this same codebase: flip
`PanelCreationModal.css`'s animation fill-mode from `both` to `backwards`, exactly mirroring `Modal.css`
(commit d7fb3816). That fix removes the containing block entirely at rest, so no JS compensation is needed at
all — it fixes the actual root cause (a stray `transform` left on the dialog after its entrance animation),
not the downstream symptom (fixed-position coordinates resolving against the wrong containing block).

The design's Alternatives analysis (design.md:42-44) rejects "strip the transform animation" as losing the
entrance animation and only fixing "this one dialog" — but that's a straw-man of the option actually available
and already validated in this codebase: **keep the transform animation, just drop the `forwards`/`both` fill
so it doesn't persist past the animation's end.** This is visually identical at rest (per the existing
`Modal.css` comment, already shipped) and requires zero JS changes. The design never discovered or considered
this option, which is a systematic-debugging gap: a root-cause investigation that read `Modal.css` (a file
directly implicated by the bug description — the shared modal primitive Select portals into) or ran
`git log -p` on it would have found the precedent in minutes.

This isn't a nitpick: it changes the recommended fix, the blast radius, and the audit's actual findings.
Building generic containing-block-offset math into `usePortalPopover`/`Select` (design.md's leading approach)
is materially more invasive than necessary given today's real scope is one CSS file, and it's exactly the kind
of shared-hook change most likely to introduce a real regression in the non-dialog (document.body) path that
Risk #2 in design.md already flags as a concern.

### Change Requests

1. **design.md — Context/root-cause section (lines 9-14)**: Add investigation of
   `frontend/src/shared/ui/Modal.css:12-20` and `git show d7fb3816` ("Fix popover layering and positioning").
   This is the same bug, already fixed once for the shared `Modal` primitive via `animation-fill-mode:
   backwards` instead of `both`. The design must account for this precedent before committing to an approach.

2. **design.md — Decisions section (lines 30-47)**: Revise the "leading approach." Given the audit shows the
   only currently-afflicted site is `PanelCreationModal.css`'s `animation-fill-mode: both` (not a systemic gap
   in every dialog), the minimal, root-cause-correct fix is to change
   `.panel-creation-modal[open]`'s fill mode to `backwards` (mirroring `Modal.css`), not to build generic
   containing-block compensation into the shared JS positioning hook. If the planner still wants JS-layer
   defense-in-depth for future containing-block sources (`filter`, `perspective`, future animations), that
   must be an explicit, separately-justified decision — not silently substituted for fixing the actual root
   cause. At minimum, `PanelCreationModal.css` should be fixed at the CSS level regardless of whether a JS
   safety net is also added.

3. **design.md — Alternatives (lines 42-44)**: The "strip the transform animation: rejected" alternative
   mischaracterizes the available option. Replace/add an alternative that reflects what was actually done in
   `Modal.css`: keep the animation, drop the `forwards`/`both` fill mode. Explain why that option is or isn't
   sufficient here, using the real audit findings (one afflicted file) rather than an assumption that every
   dialog needs a per-dialog CSS patch.

4. **proposal.md — "What Changes" (lines 12-14)**: Currently commits to "fix the shared portal popover" as the
   sole mechanism. Revise to reflect the corrected scope/approach once change request 2 is resolved (CSS fix
   for `PanelCreationModal.css`, with or without an explicitly-justified JS safety net).

5. **tasks.md — 1.2 (audit task)**: Should direct the executor to check each dialog's CSS for
   `animation-fill-mode` (both/forwards vs backwards) as the concrete audit method, referencing the d7fb3816
   precedent, rather than an open-ended "note affected/already correct." The audit performed during this
   review (documented above) already found: `PanelDetailModal` — no transform animation, unaffected;
   `PanelCreationModal` — `both`, affected; all shared-`Modal`-based dialogs — already `backwards`, unaffected;
   `ActionsMenu`/`UserMenu`/`DashboardAppearanceEditor` — always portal to `document.body`, never inside a
   dialog, unaffected. This should be reflected/reused rather than re-derived from scratch, and the plan
   should state the expected outcome (one file changed) so a much larger JS refactor isn't the default result.

### Non-blocking notes

- The regression-test plan (tasks.md 3.1/3.2, spec scenarios) is reasonable in isolation and should be kept
  regardless of which fix (CSS or JS) is chosen — a jsdom test asserting panel position tracks the trigger
  when portalled into a dialog vs. body is good coverage either way, though if the fix moves to CSS-only, the
  "regression coverage" would more usefully be a Playwright-level check (or a computed-style assertion on
  `animation-fill-mode`) since there'd be no new JS math to unit-test.
