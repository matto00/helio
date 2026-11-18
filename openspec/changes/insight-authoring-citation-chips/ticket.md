# HEL-1744: Insight L5: insight authoring in the Output editor and the insight panel with citation chips

## Description

Leaf of HEL-921. Depends on L2's read API (HEL-1742, merged).

**Output editor sheet:**

* A preset picker, with defaults filled in.
* A checklist of which Outputs it reads, pre-ticked.
* A refresh selector.
* An optional "custom prompt" disclosure.

**Panel:**

* The insight renders as markdown with citation chips. A chip opens the cited Output's provenance popover. On a public board where that Output isn't placed, it falls back to the insight panel's own popover.
* States: not yet rendered, rendering, failed (the previous render stays visible with a note), quota reached, unchanged.
* Free tier sees an upsell state (owner ruling D3).
* Sanitize the markdown: no raw HTML, and no links other than citation chips.
* Follow DESIGN.md.

## Acceptance Criteria

* Playwright on a real build: add an insight to an existing pipeline without typing a prompt. After a run, with the e2e backend on a fake model client, the panel shows two cited sentences.
* A chip opens the popover and moves focus into it. Verify with computed style and focus in a real browser, not jsdom.
* The public viewer shows no cost.
* Check against the running app in light and dark, desktop and phone.

## Migration

None.

## Driver context (claims, verified in premise-validation.md)

* L1 carry-overs owned here: the insight panel footer "UPDATED <date>" and a panel refresh that re-fetches ignored rows; `InsightNotRenderedState` lacks `role="status"`; remove the editor kind-picker drift-test exclusion when `insight` joins the picker.
* L4 HEL-1743 (in flight, not merged at Planning): render triggers, `POST /api/outputs/:id/insight/refresh` (202 + poll), per-Output `model` key (R1), role-shaped reads (R3: model/tokens/cost only for pipeline owner and editors). If L4 is not merged by Execution: no model selector, no refresh button, and the e2e seeds a render row through a test-only path instead of L4's trigger. Never duplicate L4's trigger code.
* Never display cost, model or tokens to a viewer, whatever the API returns.
* No live model calls.
