## Context

See proposal.md. `RunHistoryModal.tsx` emits `run-history-modal__trigger run-history-modal__trigger--${triggerSource}`.
The base `.run-history-modal__trigger` rule is the manual look: transparent fill, `--app-border-subtle` border,
`--app-text-muted` text, `--text-micro` semibold. `--scheduled` uses the accent tint and `--external` the warning tint.
The row (`.run-history-modal__row`) has an opaque `--app-surface-soft` fill, so the badge composites over that,
not over the modal's `--app-surface-strong`. The same row also holds the run-status `StatusChip`
(success/error/accent/neutral-dashed). Because of that, the only unused hue, green, was ruled out.

## Goals / Non-Goals

**Goals:** a `--auto-run` modifier that is visibly distinct from manual and meets the floors in both themes, measured
on the rendered page. **Non-Goals:** new tokens, icons, hue, any other trigger-source surface (proposal Non-goals).

## Decisions

**D1 — Neutral-filled pairing (owner ruling).** Use `background: var(--app-surface-raised)`,
`border-color: var(--app-border-strong)` and `color: var(--app-text)`. Keep the base padding, radius, size and weight.
Alternatives were the success tint (rejected: it reads as "Succeeded" beside the status chip), an accent intensity
variant (rejected: same hue as scheduled, and the accent is user-customisable), and a dashed border (rejected: the
Dry run chip already uses dashed). Hex-computed estimates, still to be confirmed on the rendered page: text-on-fill
16.7:1 (light) / 14.2:1 (dark); fill-vs-row 1.18 (light) / 1.12 (dark).

**D2 — Proof is a rendered Playwright spec, red first.** jsdom applies no stylesheet, so a jest test cannot show
"differs visibly". New spec `e2e/hel1822-auto-run-trigger-badge.spec.ts`:
- Sign in with `registerAndLogin` and create a pipeline.
- Use `page.route` to fulfil `GET /api/pipelines/:id/run-history` with the real wire fixture
  `shared-test-fixtures/pipeline-run/run-history-response.json`. It holds one run per trigger source, and the backend
  `PipelineRunHistorySchemaSpec` holds it to the route, so the body is route-true. Before serving it, replace its
  `{{TIMESTAMP}}`/`{{RUN_*}}`/`{{PIPELINE_1}}` placeholders with real ISO instants, distinct ids and the created
  pipeline's id; keep the record shapes unchanged.
- Open Run History.
- For each theme (light, dark), read the computed `background-color`, `border-color` and `color` of the `Auto-run`
  and `Manual` badges, and composite them over the row's computed background with `e2e/support/stateContrast.mjs`
  (`compositeStack`/`contrastRatio`/`parseColor`).
- Assert:
  (a) the auto-run badge has class `run-history-modal__trigger--auto-run`;
  (b) the composited auto-run fill differs from manual's and is at least 1.10:1 against the row, and the auto-run text
  colour differs from manual's;
  (c) the text on the composited fill is at least 4.5:1.
- Write the measured numbers to an evidence file via `evidencePath`.
- Before the CSS lands, (b) must fail in both themes (identical transparent fills). Commit that red run.
- Mutation probes to run and record:
  - drop the new rule (red);
  - set the fill to `transparent` (red on (b));
  - set the text to `--app-text-muted` on the raised fill. The 4.5 check alone stays green (6.41 light / 6.58 dark,
    measured), so for (c) it is a sensitivity probe; it is red via (b)'s "text colour differs" assertion.

Switch the theme the way existing specs do (e.g. the `hel1572-appearance-preferences` /
state-surface-contrast-guard pattern). Do not invent a new mechanism.

**D3 — Leftovers.** Contract test line 32: replace the five-label list with the literal four known labels, and assert
`records.map((r) => triggerSourceLabel(r.triggerSource)).sort()` equals `["Auto-run", "External", "Manual",
"Scheduled"]` (each exactly once). Use a literal, not a list derived from `TRIGGER_SOURCES`, because a derived list is a
tautology of the line above it. Red first: the mutation `KNOWN_LABELS["auto-run"] = "Unknown"` in
`triggerSourceLabel.ts` passes the old five-label `toContain` and fails the tightened equality. Record that pair, then
revert. A fixture mutation is not usable: an unknown source already fails the earlier `TRIGGER_SOURCES` assertions,
and a missing source normalises to `manual`. Migration spec doc comment: state that V63 introduced the three-value
CHECK and V110 widened it to include `auto-run`. Comment only, no test-behaviour change.

## Risks / Trade-offs

- [Dark fill-vs-row is 1.12, close to 1.10] → measured on the rendered page and asserted, not assumed. If the rendered
  value falls below 1.10, stop and escalate (no token invention).
- [The shared Playwright environment] → run only the new spec plus the existing run-history e2e specs, with 2 workers,
  serialised with other lanes.

## Planner Notes

- Self-approved: route-mocking run-history from the shared wire fixture rather than seeding a real auto-run. The
  ticket is presentational, and the fixture is already seam-tested against the real route by HEL-1815.
- Self-approved: no jest CSS-source guard is required. The rendered spec is the proof, though the executor may add one
  if it is cheap.
