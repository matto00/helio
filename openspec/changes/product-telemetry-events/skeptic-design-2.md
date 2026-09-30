## Skeptic Report - design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
Read ticket.md, skeptic-design-1.md, proposal.md, design.md, tasks.md, specs/product-telemetry/spec.md in full; checked each round-1 change request against the text.

1. CR1 (Decision 3 incoherent): ADDRESSED. design.md Decision 3 now lists one final table set with columns, PKs and derivations: product_event_daily, product_active_users_daily (DAU + WAU columns, trailing 7 UTC days, all events, from raw rows), product_ttfd_daily (percentile_cont 0.5/0.9, fixed histogram bounds, non-cumulative, seconds), product_event_property_daily, product_rollup_state. The stream-of-consciousness is gone. The WAU-after-purge rule is stated (upsert only while day-6 is inside retention).
2. CR2 (property rollup): ADDRESSED. Only firstrun_template_chosen.template; PK given; cardinality bounded by RolledUpTemplateSlugs allow-list else "other"; spec has "Template counts survive purge" scenario and Daily-rollups text covers WAU and template counts; tasks 3.1 tests `other` bucketing.
3. CR3 (grants): ADDRESSED. Explicit idempotent GRANT to helio_privileged (Decision 2, task 1.1); app-pool-owns-tables claim corrected with consequence and HEL-1211 read path; scratch DB uses a non-BYPASSRLS LOGIN role that SET ROLEs helio_privileged for rollup+purge.
4. CR4 (purge safety): ADDRESSED in substance. 4a: rollupDay in one txn under pg_advisory_xact_lock with ON CONFLICT DO UPDATE, purge throttle under same lock, task 3.1 tests idempotence. 4b: invariant written; partially-purged days skipped. 4c: exemption decided (see below).
5. CR5 (public variant): ADDRESSED. provenance_opened is `{}`, authenticated opens only; client skips unauthenticated public view; spec scenario "Public view not tracked"; task 4.1 covers it.
6. CR6 (task gaps): ADDRESSED. 1.1 privileged-role run + harness-list check; 2.2 dedupe test (two posts, one row, both 2xx); 2.3 after-commit withUserContext + recover; 3.1 pre-ship and negative-diff exclusion fixtures.
7. CR7 (minor): ADDRESSED. "LOGIN" role; last_purge_at column in product_rollup_state.

### Judgment on the deliberate deviation (purge exemption for signup_completed / first_dashboard_rendered)
Sound. These are at most one row per user each, timestamp only (first_dashboard_rendered carries one bounded int, panelCount), so the privacy/storage cost is negligible and strictly less than data already in users. Without the exemption, TTFD silently excludes anyone whose first dashboard lands after day 90 (their signup row is gone) and once-per-user dedupe breaks after window (cleared-localStorage re-emit passes the unique index, double counting). The ticket AC "per-user rows purged" is about bounding the growing event log; the exemption leaves the log bounded, is removed by account-deletion cascade, and is disclosed in design and spec. It is a deviation from the literal AC text, so it must be surfaced to the driver/owner in the PR body (the retention window is itself a driver default), but it does not block.

### Verdict: CONFIRM

### Non-blocking notes
- Decision 3 invariant gap: the tick recomputes "today and yesterday", but a day D enters rolled_through at D+2, when D is no longer recomputed; a late row for D (clamp allows up to ~24h lag plus flush) could land after D's last recompute. Add "rollupDay(D) is run once more immediately before advancing rolled_through past D" to Decision 3 / task 3.1 so the stated invariant is actually true.
- proposal.md is stale: lists only two rollup tables and says plain "retention purge of per-user rows"; update to the five tables and the exemption so proposal matches design.
- Task 3.2 should explicitly assert that a 91-day-old signup_completed/first_dashboard_rendered row SURVIVES purge (the exemption is otherwise untested) and that the rolled-up WAU for an old day is not overwritten from partial data.
- Migration Plan says "no FK from other tables" - fine; rollback note should mention dropping all five rollup tables too.
