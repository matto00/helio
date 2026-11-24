# Live verification (task 1.1) - unmodified worktree == main fe07492b6

Run on the lane servers (dev 7270, backend 10177, lane DB helio_hel1838, ANTHROPIC_API_KEY empty) with a throwaway
Playwright probe (not committed) driving real users registered through the real API (plain emails): a free-tier owner
who created a pipeline and granted one `editor` and one `viewer` (both freshly registered, free tier by default).
Each grantee opened the pipeline and clicked "Open hel1661-out output" (a saved, kind `table` Output).

| Role   | Theme | "Request Beta access" link in the History card | href                 |
| ------ | ----- | ---------------------------------------------- | -------------------- |
| viewer | light | visible                                        | /settings#beta-access |
| viewer | dark  | visible                                        | /settings#beta-access |
| editor | light | visible                                        | /settings#beta-access |
| editor | dark  | visible                                        | /settings#beta-access |

Conditions that were true when it showed:
- Pipeline owner tier: free. The real `GET /api/pipelines/:id/outputs` response carried `historyPayloadsAvailable: false`
  (and `historyPayloadLimits`) for the grantees.
- Output: saved (not create), kind `table` (not `insight`).
- Viewer's own tier: free (`/api/auth/me`); irrelevant to this link, which keys on the pipeline owner's tier flag.
- Ask disclosure ("Ask about this Output"): collapsed (`details.open === false`) in every capture, so the link in the
  screenshots is the History card's, not the Ask panel's. The locator was scoped to the card containing the h3 "History".
- Card text: "HISTORY / Keep each run's rows / Stores the full rows ... Beta keeps the last 10 runs for 7 days ...".

Result: the viewer sees the link, in both themes, on every run (4/4 captures, none intermittent). No escalation needed.

Screenshots: /home/matt/Development/helio/.concertino/runs/HEL-1838/evidence/{viewer,editor}-{light,dark}.png
The probe's three throwaway users were deleted by the e2e global teardown by recorded id ("deleted 3 recorded throwaway user(s)").
