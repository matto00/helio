## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 032321ada8880dbfce4a1197c28e34d55b964388 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Owner ruling is recorded.** `.concertino/runs/HEL-1822/events.jsonl` line 5: `escalation.answered`, answer
  `neutral-filled`, `answer_source: human`. I did not reopen the token choice.
- **Baseline CSS claims are correct.** `frontend/src/features/pipelines/ui/RunHistoryModal.css`: the base
  `.run-history-modal__trigger` has no background, uses `--app-border-subtle` and `--app-text-muted`; `--scheduled`
  and `--external` exist; there is no `--auto-run` rule. `.run-history-modal__row` sets `background: var(--app-surface-soft)`.
- **The row fill is opaque.** `theme.css`: `--app-surface-soft` is `#efece6` in light and `#161514` in dark.
- **The modifier class is already emitted.** `RunHistoryModal.tsx:62` emits `run-history-modal__trigger--${triggerSource}`.
  So D2(a) passes before the CSS change and D2(b) is the real red. The design says so.
- **The hex estimates reproduce.** I recomputed them from `theme.css` with WCAG relative luminance:
  - text on fill: 16.74 (light), 14.16 (dark);
  - fill against row: 1.179 (light), 1.122 (dark).

  These match D1. The plan treats them as estimates to confirm on the rendered page, and stops on a dark value
  below 1.10.
- **The test tooling exists.**
  - `e2e/support/stateContrast.mjs` exports `parseColor`, `compositeStack` and `contrastRatio`.
  - `e2e/support/evidencePath.ts` and `registerAndLogin` (`e2e/support/auth.ts:82`) exist.
  - The theme-switch pattern exists in the contrast guard and in `hel1572`.
  - `e2e/support/modalScrollExtent.ts:214` already opens Run History through the pipeline menu.
- **The route path and the fixture's route-truth are correct.**
  - `fetchRunHistory` calls `GET /api/pipelines/:id/run-history`.
  - `PipelineRunHistorySchemaSpec.scala:179` holds `shared-test-fixtures/pipeline-run/run-history-response.json` to
    the route.
  - The fixture has one run per trigger source.
- **The spec delta is complete.** The MODIFIED requirement keeps all three existing scenarios word for word (compared
  with `openspec/specs/pipeline-run-provenance/spec.md`) and adds one.
- **The migration comment leftover is real.** `TriggerSourceMigrationSpec.scala:17-19` lists only
  `manual`/`scheduled`/`external`.
- **The D3 red-first claim is not achievable.** I traced `runHistory.contract.test.ts` together with
  `normalizeRunRecord` (`pipelineService.ts:291`) and `triggerSourceLabel.ts`. See Change Request 1.

### Verdict: REFUTE

### Change Requests

1. **D3 / task 1.2: the contract-test tightening is specified in a way that is tautological, and its red-first
   mutation cannot happen.** Revise both parts.

   **(a) Deriving the label list from `TRIGGER_SOURCES` proves nothing.** If the list is
   `TRIGGER_SOURCES.map(triggerSourceLabel)`, the label assertion follows from the existing
   `expect(TRIGGER_SOURCES).toContain(r.triggerSource)` on the line above. It calls the same function on the same
   input. It cannot fail on a wrong label: for example, if `KNOWN_LABELS["auto-run"]` were changed to `"Unknown"` or
   `"Manual"`, it would still pass.

   Fix: assert against a literal list, `["Auto-run", "External", "Manual", "Scheduled"]`. Preferably compare the
   sorted mapped labels for equality, so each of the four appears exactly once.

   **(b) The planned mutation cannot pass the old test.** D3 says that mapping a fixture record to an unknown source
   "must fail the tightened assertion and pass the old one". It cannot pass the old one. An unknown or empty source
   already fails two earlier assertions:
   - `expect(records.map(r => r.triggerSource).sort()).toEqual([...TRIGGER_SOURCES].sort())`;
   - `expect(TRIGGER_SOURCES).toContain(r.triggerSource)`.

   A missing or null source becomes `"manual"` in `normalizeRunRecord`. So `"Unknown"` is unreachable in this test,
   and a fixture mutation cannot produce a red attributable to the tightening.

   Fix: specify a label mutation instead, for example `KNOWN_LABELS["auto-run"] = "Unknown"` in
   `triggerSourceLabel.ts`. That mutation passes the old five-label list and fails the new literal list. Record that
   red/green pair, then revert. Change the "verify" clause in task 1.2 to match.

### Non-blocking notes

- **D2: substitute the fixture's placeholders before fulfilling `page.route`.** The fixture's `startedAt` and
  `completedAt` are `"{{TIMESTAMP}}"`, and its ids are `{{RUN_*}}` and `{{PIPELINE_1}}`. If the fixture is served
  verbatim, the rows show "Invalid Date" and "NaNm NaNs". That does not crash and does not affect the badge
  measurement. But any screenshot evidence would show broken rows, and an experienced reviewer would question it.
  Replace the placeholders with real ISO instants and the created pipeline's id, and keep the record shapes
  unchanged.
- **D2(b): also assert distinctness in the border or text.** The design asserts the fill. Consider also asserting
  that the auto-run text colour differs from manual's: `--app-text` against `--app-text-muted`. That makes "differs
  visibly" robust if a later token change brings the fills close together. This is optional.
- **Mutation 3 (muted text on the raised fill) is a sensitivity probe, not a red.** By hex it gives about 6.4:1 in
  light, which is still above 4.5. The design already says "record the ratio". Keep it labelled that way in the
  evidence, not as a red.
- **Visual-judgment watch item for the final gate.** The chosen pairing (`--app-surface-raised` fill, `--app-border-strong`
  border, `--app-text` text) is exactly the hover state of the adjacent `.run-history-modal__row-toggle`
  (`RunHistoryModal.css`, the `@media (hover: hover)` rule). The pill radius and lack of a cursor change should keep
  the badge from reading as interactive. I will judge that on the rendered page at the final gate; it is not a reason
  to reopen the ruling.
