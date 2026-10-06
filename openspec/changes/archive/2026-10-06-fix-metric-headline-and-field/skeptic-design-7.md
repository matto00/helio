## Skeptic Report — design gate (round 7, skeptic-design-7.md)

Reviewed at HEAD cdb9e43d669a1e3045ed6c3c15cf025a2547fe75. The change dir is untracked on top of it.
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/metric-headline-field-correctness/HEL-1326`.
- `npx --no-install openspec validate fix-metric-headline-and-field --strict`, run inside the worktree, printed
  "Change 'fix-metric-headline-and-field' is valid".

### What I verified (with evidence)

**Round-6 Change Requests**

All four are resolved. I read each artifact in full.
1. CR1 is resolved. proposal.md "What Changes" now says the client-side cross-filter keeps the loaded-rows value,
   "labelled by the existing HEL-588 'N of M loaded rows match.' disclosure (owner ruling D5 `existing-disclosure`;
   no new copy)" (:17-19). I grepped the change for "pending an owner": 0 hits.
2. CR2 is resolved. proposal.md Impact names `PublicPanelRowsResolver.resolveRows` (public rows, split out by
   HEL-1291) and the new `PublicPanelRowsResponse` under `api/protocols/**`. The resolver's live signature agrees:
   `def resolveRows` (:48) returns `Future[Either[ServiceError, PagedResult[JsValue]]]` (:54).
3. CR3 is resolved. proposal.md Non-goals now says the owner ruled `no-backfill` (no V117) and that the residual on
   raw API/MCP values is stated in the PR. I grepped for "owner ruling required": 0 hits.
4. CR4 is resolved. design.md Risks now says `PublicPanelRowsResolver.resolveRows` (HEL-1291 split) gains one service
   call. I grepped for "506 lines": 0 hits.

The optional notes from round 6 were also applied:
- The base reads "re-verified at cdb9e43d6".
- The line ranges are corrected. `OutputSummaryReducer.scala:87-103` still holds the `mapping.size == 1` branch, and
  `metricHistoryView.ts:21-34` still holds `strings.length === 1`. So the bug is still live on HEAD and D1 is needed.

**Owner rulings against ground truth (events.jsonl, not the narrative)**
- HEL-1326 escalation `HEL-1326-1791278673387-6bc3ea`:
  - The question offered D5 options `existing-disclosure | metric-copy-replaces-disclosure | metric-copy-beside-disclosure`
    and D4 options `no-backfill | v117-null-out`.
  - The answer was `["existing-disclosure","no-backfill"]`, with `answer_source: human` (line 23).
- The artifacts record both rulings consistently:
  - D5: ticket.md, proposal.md, design D5, the delta-ui spec (:12) and tasks C3/2.6. Task 2.6 is a guard only and adds
    no new copy.
  - D4: ticket.md, proposal.md Non-goals, design D4, tasks C2 (no V117) and the risks/planner notes.
- The D4 bundle that was ruled on (additive `{field, agg}` identity on `current`/`baseline` plus a client delta guard,
  with the raw API/MCP residual) is exactly what design D4, tasks 1.6/2.5 and the output-history-api delta specify.
  Nothing beyond the ruling is decided.
- HEL-1327 fold-in:
  - HEL-1327's own run log records escalation `HEL-1327-1791295552636-017bc4`, answered `proceed-with-restated-scope`
    (human).
  - Its context defines that option as "deliver items 2-4 now and add item 1's route test to HEL-1326 D4".
  - HEL-1326 matches it: ticket.md "Added scope", design D4's final sentence, task 3.3 (an out-of-window baseline
    carries `baseline.metric`, red; selection unchanged, GUARD) and the output-history-api scenario "Baseline older
    than the returned points carries its identity".
  - The server baseline selection is untouched, which preserves HEL-918 D6.
  - In Linear, HEL-1327 is In Progress, consistent with items 2-4 being delivered there.

**Whole-change consistency**
- Every AC is covered by at least one task:
  - Filtered headline: D2/D3/D6, tasks 1.2-1.5 and 2.2-2.4, reds 3.2/3.5.
  - The "else label + escalate" branch: D5, ruled.
  - Metric field null on both ports: D1, tasks 1.1/2.1, shared fixture 3.1, reds 3.1/3.4/3.5.
  - Server unit, route and client RTL tests: tasks 3.1-3.5.
  - Backfill or note: D4, ruled no-backfill, with a PR note.
- Proposal, design, tasks and specs agree on:
  - the field rule (`fieldMapping.value` → `aggregation.value` → none);
  - when the rows-response `metric` is present (metric kind + filter + offset 0, else absent; present `null` when no
    field);
  - additive history identity with selection unchanged;
  - the page-0-clears-stale client rule.
- I found no placeholders or TBDs. Every red/guard is labelled per C1.
- Driver constraints are respected:
  - no `ci.yml`/`playwright.config.ts`/`.gitignore` edits;
  - route specs extend `HelioRouteTest`;
  - the measurement spec is opt-in only and never touches the shared dev DB.
- The base still holds on HEAD: the HEL-1291 split is accounted for, and the round-6 citation checks (`OutputService.rows`,
  `OutputRowsResponse`, `ResolvedHistoryPoint`, the schema-drift pairing) do not depend on any file that changed since.

### Verdict: CONFIRM

### Non-blocking notes
- `specs/output-routes-api/spec.md` contains the sentence "The public route's behaviour here is the public-dashboards
  panel rows route, specified in this capability." It is awkward but harmless. The executor may tighten it during
  archive.
- The delta-ui requirement embeds the owner-ruling sentence inside the normative text. That is acceptable and traceable,
  but at archive time it could move to a note.
