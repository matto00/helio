# HEL-1746: Insight L7: ask UI on the dashboard and the Output sheet, with pin as insight

## Description

A leaf of HEL-921 (narrative insight Outputs, ask-your-data over snapshots). It needs L5 (HEL-1744, citation chips) and
L6 (HEL-1745, the ask backend).

What it adds:

- A question box on the dashboard and on the Output sheet.
- An answer card with citation chips, reusing L5's chips.
- A "Pin as insight" action, shown only to pipeline editors.
- Quota and limit states. The free tier sees an upsell.

## Acceptance Criteria

- Playwright: ask a question, get an answer, pin it, and a new insight Output appears and renders. The e2e backend uses
  the fake model.
- A viewer sees no pin action.
- Keyboard use and focus are checked in a real browser.
- Checked against the running app in light and dark, on desktop and phone.

## Migration

None.

## Driver rulings and corrections (2026-11-18, binding for this run)

- HEL-1743 (L4 render triggers) is parked and not merged. "A new insight Output appears and renders" is met as "appears,
  placed, in the not-yet-rendered state"; the render half is owed by L4. Do not build a render path or a production
  seed. State this in the PR.
- "The e2e backend uses the fake model" does not hold: no fake model can be injected into a running lane backend
  (premise-validation.md). Accepted correction: the Playwright spec fakes only the /ask response at the browser network
  seam (page.route), with a fixture validated against schemas/ask/ask-response.schema.json; the pin POST and everything
  after it run against the real backend. Condition: a backend spec validates the REAL /ask responses (200, 422
  ASK_UNGROUNDED, 403 TIER_FORBIDDEN) against the same schemas the fixture is validated against, red first. State the
  seam in the PR.
- HEL-1761 merged (ecefad62a) and is in this branch. It adds `422 {message, code: "ASK_ANSWER_TRUNCATED"}` (no
  reasons) for a max_tokens stop and makes ASK_UNGROUNDED reasons value-free. The driver asked that ASK_ANSWER_TRUNCATED
  be handled in the UI and included in the schema-validated fixtures. The UI handles 422 and 5xx generically otherwise.
  Merge main again before the final gates.
- Stay neutral on the open owner questions: no model choice in ask, and no billing-weight copy.
- Frontend plus e2e plus contract tests only: no Flyway migration, no live model call.
