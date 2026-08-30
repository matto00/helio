## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- **Round-2 CR (route count) is FIXED.** `grep -rn "\b7\b|\b9\b"` across the change dir plus direct reads:
  `spec.md:63` now reads "The nine listed routes …" and lines 64-66 enumerate exactly nine names;
  `proposal.md:44` "the 9 listed surviving routes (5 with headers, 4 review routes)";
  `design.md:3` "Nine top-level routes are in scope; five of them hand-roll …";
  `design.md:136-137` "(9 routes — 5 with headers, 4 review-route full-content states) … each of the 9 routes";
  `tasks.md:5.3` "each of the 9 migrated routes". The only surviving "7"s are `ticket.md:7`/`:19` (original
  ticket text, not editable) and `design.md:10` / `proposal.md:20`, both correctly framed as the ticket's
  filing-time CSS-recipe estimate. Count fix confirmed.
- **CSS inventory re-verified independently.** `grep -rn "page__loading\|page__error" --include=*.css frontend/src`
  → exactly 4 files: `SettingsPage.css:17-24`, `ChatPage.css:9-16`, `MetricsPage.css:20-27`,
  `MetricDetailPage.css:17-23`. Matches proposal.md's stated ground truth; in-scope deletions = 2
  (`ChatPage.css`, `SettingsPage.css`), consistent with Decision 5 and tasks 3.2/3.3/5.1.
- **All nine route files exist** at the paths the artifacts name (verified by `find` for each `.tsx`).
- **Decision 0 (exclude TypeRegistry/TypeDetail/Metrics/MetricDetail)** is recorded with the human ruling,
  the remodel-spec citation, the corrected AC, and a tracked handoff (tasks 5.4). Sound.
- **Header inventory — checked against source, and it does not match the artifacts** (see CR 1):
  `grep -n "page-title\|<h1\|__header"` across all nine routes returns headings in only
  `SourcesPage.tsx:84`, `PipelinesPage.tsx:41-42`, and `SettingsPage.tsx:45` (`.settings-page__title`).
  `ChatPage.tsx` (read in full, 44 lines) renders `<div className="chat-page">` with **no header, no title,
  no `<h1>` at all**. `PipelineDetailPage.tsx:653-654` renders `<div className="pipeline-detail-page">`
  followed by `<PipelineDetailHeader …>`, which (`PipelineDetailHeader.tsx`, grepped for `<h1|<h2|page-title`)
  contains **no heading element and no title** — it is a bespoke source/type/schedule chip row. There is also
  no back link anywhere in `PipelineDetailPage.tsx` today (`grep -n "backTo\|Back"` → nothing).

### Verdict: REFUTE

### Change Requests

1. **The "5 routes with headers" premise is factually wrong for 2 of the 5, and it is load-bearing.**
   `design.md:3-5` states nine routes are in scope and "five of them hand-roll a container div, a header
   (`<h1 className="page-title">` inside a `__header` element … except `SettingsPage`)"; `design.md:110-112`
   (Decision 4) states `SourcesPage`/`PipelinesPage`/`SettingsPage`/`ChatPage`/`PipelineDetailPage` "all
   render a `PageHeader`" and frames the rule as "rendered by every route that has a title today, omitted by
   every route that doesn't". Ground truth (evidence above): only **three** routes have a title today
   (Sources, Pipelines, Settings). `ChatPage` has no header/title of any kind, and `PipelineDetailPage` has
   no title/heading and no back affordance — only the bespoke `PipelineDetailHeader` chip row. Correct the
   Context and Decision 4 inventory to the verified 3/2/4 split (3 with a title, 2 without a title but
   non-review, 4 review routes), and restate Decision 4's rule so it is decidable from that inventory.

2. **Adding a `PageHeader` to `ChatPage` and `PipelineDetailPage` is a new visual/product change with no
   specified content.** Decision 4 commits both routes to a `PageHeader` (and `PipelineDetailPage` "with a
   `backTo` affordance") while `tasks.md:3.2` gives `ChatPage` only a `PageStatus` swap and never mentions a
   header, and `tasks.md:3.1` says "`PageHeader` with `backTo`" without saying what the title string or back
   target is. No artifact specifies: the `ChatPage` title text, the `PipelineDetailPage` title text (pipeline
   name? "Pipeline"?), or the back-link destination. Either (a) decide and record these explicitly (title
   strings, back target, and a note that both are new UI, not a like-for-like migration), or (b) decide these
   two routes keep no `PageHeader` in this ticket. As written, `design.md` and `tasks.md` contradict each
   other and an implementer could reasonably do either.

3. **`PipelineDetailPage`'s interaction between `PageHeader` and the existing `PipelineDetailHeader` is
   unspecified.** If a `PageHeader` is added (CR 2 option a), the design must say whether it sits above
   `PipelineDetailHeader`, wraps it via the `actions` slot, or replaces part of it — this is exactly the kind
   of "two headers stacked" outcome the UI gate would reject, and it is not a call the executor should make
   unilaterally at implementation time.

4. **`spec.md:69-70`'s scoping clause inherits the same false premise and must be corrected with it.**
   "Every one of these routes that renders a title today (all except the four review routes, none of which
   has one) SHALL render that title through `PageHeader`" is false: `ChatPage` and `PipelineDetailPage` also
   render no title today. As written the requirement is unverifiable for those two. Restate against the
   corrected inventory and against whatever CR 2 decides, and align the `spec.md:86-89` scenario ("any two of
   the five non-review listed routes") with it.

### Non-blocking notes

- `design.md:10`'s parenthetical "verified by grep, exactly these 2 files, not 7" reads as a claim about the
  whole grep result; the grep actually returns 4 files (2 of them out of scope). `proposal.md:17-21` states
  this correctly. Consider "exactly 2 of these in scope (4 repo-wide, 2 excluded by Decision 0)".
- `ConnectorsPage` (`app/AppRoutes.tsx:96`) is another top-level route with its own container CSS and is not
  in the nine. That matches the ticket's enumeration, so it is not scope drift — but a one-line "deliberately
  not enumerated by the ticket" note in Non-goals would stop a future reader re-litigating it.
