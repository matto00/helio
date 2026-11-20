# HEL-1788: Counter field for editors: label the local tally so the reset on reload isn't surprising

## Description

origin_kind: followup
origin_ticket: HEL-1784

**Owner ruling (2026-11-20):** keep the editor's local counter tally (no dataset read, per the HEL-1784 ruling), but
label it so it's clear it counts only this person's clicks in this session.

Today a dashboard editor's counter field shows a tally of their own clicks, and it resets to zero when they reload the
page. Nothing tells them that.

## Acceptance Criteria

- For a non-owner, the counter's tally carries a caption such as "Your clicks this session" (final wording per
  DESIGN.md), on desktop and phone, in light and dark.
- The owner's counter, which shows the real total, is unchanged.
- Still no `/api/data-sources/*` request from a non-owner's page.
- A test that fails first.

## Agent notes

- HEL-1784 archived change: `openspec/changes/archive/2026-11-19-editors-submit-form-panels/`. Files:
  `FormRenderer.tsx`, `FormPanelView.tsx`.
