# HEL-1818: Compact counter: a rejected step shows and announces the same error twice (field error + form alert)

## Description

origin_kind: followup
origin_ticket: HEL-1804 (PR matto00/helio#1220, merged as 787a283e9). The owner chose to file this.

When a compact counter form's step is rejected (for example a 400 from `POST /api/panels/:id/submit`), the same message shows twice: once as the field's error and once in the form's `.form-panel-view__alert` region. Screen readers announce it twice. This predates HEL-1804, which did not touch that markup.

## Do

* Decide which single place should carry the message for a compact counter. The field error is the likely choice, since the counter has one field. Make the other place show nothing for that error, and keep the live regions mounted (HEL-1804's rule).
* Check that the multi-field form's behaviour is unchanged, or state why it should change too.

## Acceptance criteria

- [ ] A test that fails on the current code: a rejected compact counter step renders the message once and announces it once.
- [ ] The message still renders and is announced, light and dark, at 390 and 1440 px.
