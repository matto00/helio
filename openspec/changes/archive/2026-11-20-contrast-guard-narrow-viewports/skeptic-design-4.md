## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed against the live tree at HEAD 4f101209bd50fed23f5534a8f4be3cc310051d63. The change dir is untracked and no
code exists yet. This was a static review; I did not run the app or the spec.

### What I verified (with evidence)

**The owner rulings exist and match C1/C2.** In `/home/matt/Development/helio/.concertino/runs/HEL-1649/events.jsonl`:
- Two `escalation.answered` events, both `answer_source: "human"` and `resolution_channel: "chat"`.
- The first is the "mix" ruling (C1).
- The second answers `general-rule` (C2) to a question that states the rule in full.
- The C1 and C2 text in tasks.md and workflow-state.md matches the rulings.

As instructed, I did not re-litigate either ruling.

**Round-3 CR1 (active chip and link, second dashboard): addressed.**
- D2a gives the active ink-filled chip and the active section link a hover in the same family as their resting
  state. The token is measured to clear 1.10 in both themes and recorded. A control that fits no recipe is an
  ESCALATION.
- Task 1.2a seeds a second dashboard in the narrow cells only, and verifies two chips.
- `DashboardChipRow.tsx` renders each chip as a `<button aria-label={name}>`. So `newCell`'s existing
  `getByRole("button", {name: DASH_NAME})` gate (`state-surface-contrast-guard.ts:648`) still resolves in the phone
  layout.
- With two dashboards, `getMostRecentDashboardId` makes the newer one active. The DASH_NAME chip is therefore the
  non-active chip, and its Secondary hover really gets measured.
- The 1440 populations cannot change, because the seeding is narrow-only by construction.

**Round-3 CR2 (`.tl-disc__head`): addressed.** C2's empirical inventory covers it, and D2a names it under the Ghost
recipe.

**Round-3 CR3 (red-first ordering): addressed.**
- tasks.md now runs 1.4 (partition passes), then 1.4a (red run on main, log committed, inventory written), then 1.4b
  ("ONLY after 1.4a's red log is committed").
- The old section 0 is gone.
- `finishCell` throws with every failing line in a cell (`:723-735`), so a single red run lists the whole inventory
  per cell.

**Round-3 CR4 (policy text): addressed.**
- The design Risks section now says "no exemption beyond C1's bottom-nav entry ... otherwise ESCALATION".
- The proposal's Non-goals section says "larger findings are escalated, never exempted".
- The garbled 2.2 line and the stale "phone-header" wording in the Why section are fixed. The Why section now says
  "since-deleted".

**M1 can go red.**
- `PipelineSpine.css:441-451` holds the two gated rules (soft, and strong in dark).
- With them deleted, the shared ghost hover applies (`IconButton.css:62-66`, `--app-surface-soft`), which is
  HEL-1628's 1.03 in dark. Light is unchanged.
- The phone layout renders `PipelineSpine variant="phone"` on the default `steps` tab
  (`PipelineMobileLayout.tsx:56,191-202`).
- `SpineSourceCard` renders `SourceSampleLabelView`, with the button aria-label `Refresh sample of ${sourceName}`
  (`SourceSampleLabel.tsx:60`).
- D3's visible+enabled wait and its split-view-if-sampled-out rule close the sampling gap.

**M2 can go red.** This was verified in round 3 (`App.css:127-141`, backdrop `--app-surface`). D2 probes the phone
chrome as its own view in each narrow cell. The current 1440 route cells only collect chrome for the partition check
and probe it in the separate chrome cell, so this is a real addition the M2 red will prove.

**CI cost handling is executable.**
- D5 does not hand-edit `shard-weights.tsv`, per the README.
- It measures per-cell and per-file time and the `e2e-shard.mjs plan` placement (task 2.4).
- It splits by width if the file exceeds the heaviest part (117 s).
- It states any under-weighting.

### Verdict: CONFIRM

### Non-blocking notes

1. **Phone `/home` readiness needs a width-specific signal. The plan's general D4 clause covers it, but it is not
   named.**
   - The `/home` gate `getByRole("group", { name: "Pipeline runs, last 24 hours" })` (guard `:808-810`) will never
     match at 768 or 390.
   - At those widths `PipelineRunsCard.tsx:61-62` renders `RunDisclosureList`.
   - Its element is `<ul className="tl-disc" aria-label="Pipeline runs, last 24 hours">`
     (`RunDisclosureList.tsx:27`), which has implicit role `list`, not `group`. `RunTimeline.tsx:79` is the `group`.
   - Fix: gate narrow `/home` on the `list` role with that name. Do not drop the gate.
2. **Under-sampling limits the inventory.**
   - `collectCandidates` samples 24 per view (`:336-347`), and a sampled-out element still satisfies the partition
     check.
   - A narrow-only control in a view with more than 24 visible elements can therefore miss the red run, and so miss
     the C2 inventory.
   - Record each narrow view's "visible / sampled" line in `hover-inventory.md`.
   - Split any narrow view where sampled < visible, as D3 already does for the refresh button. Otherwise the spec's
     "any control that renders only at 768 or 390" claim is stronger than what was measured.
3. **proposal.md Impact still lists only C1's two controls.** It should say "every control in the C2 inventory (see
   hover-inventory.md)", so the PR scope matches C2.
4. **Minor typo in tasks.md 2.2:** "naming it ;".
5. **The 1100 `/connectors` Test-connection menu is still conditional.** It reads "seeds one ... if the API allows,
   otherwise records why". The evaluator should check that the recorded reason is real, not assumed.
