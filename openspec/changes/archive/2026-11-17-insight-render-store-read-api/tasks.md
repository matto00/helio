## Standing Constraints

- [C1] Migration is V145 (driver decision 2026-11-18 after HEL-1739 merged V144; ledger V146 HEL-1734). Before merge, if origin/main's highest V is >= 145, renumber to max+1, update references, re-run gates.
- [C2] Never read, cat, grep, source or print any .env file; never run env-dumping commands. Quoted heredocs only (<<'EOF'), no backticks or $(...) in echo strings.
- [C3] No pkill/pgrep/killall; kill by exact PID only; stop servers with stop-servers.sh; DB residue deleted by exact id only.
- [C4] Resource caps: jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19; timeout 600000 on long calls; use sbt testFull and read ScalaTest's own totals.
- [C5] No model calls anywhere in this ticket; the read service has no model client by construction.
- [C6] Every new test and guard is shown red first (fail-first.md / mutations.md record command + output).
- [C7] RLS live check runs as helio_app (non-BYPASSRLS), local only, never prod.
- [C8] Scratch in .concertino/scratch/HEL-1742/ only.

## 0. Fail-first

- [x] 0.1 Write the route specs for the three endpoints first; run them red (404/no route) and record in fail-first.md
- [x] 0.2 Confirm the shared dev DB's applied max migration is below 142 (else switch to a lane-private DB, design D10)

### Backend

## 1. Backend

- [x] 1.1 V145__output_insights.sql per design D1 (CHECKs, indexes, RLS + four policies, grant to helio_privileged)
- [x] 1.2 Domain types: InsightTrigger, InsightStatus (closed sets), OutputInsightRecord, StoredInsightCitation + format
- [x] 1.3 OutputInsightRepository: insertAction, latestOk, latestAttempt, listRecent(limit, since), purge (design D2, D7)
- [x] 1.4 OutputInsightReadService (D3, D4): only OutputRepository + insight repo; read/history ACL'd, latestOkFor no-ACL
- [x] 1.5 Protocols: authenticated insight, history and public responses with explicit nulls (design D5, D6)
- [x] 1.6 OutputRoutes: path("insight") and path("insight" / "history"), reusing OutputHistoryQueryParsing
- [x] 1.7 PublicPanelInsightResolver + insightReadServiceOpt on PublicDashboardRoutes, mounted next to history (D6)
- [x] 1.8 Retention: third part in OutputHistoryRetentionService (no-default param), Main + ApiRoutes wiring
- [x] 1.9 JSON schemas: output-insight-response, output-insight-history-response, public-output-insight-response
- [x] 1.10 CLAUDE.md: three endpoints, retention note, and correct the stale ANTHROPIC_API_KEY consumer row

### Tests

## 2. Tests

- [x] 2.1 Route specs via ApiRoutes wiring: owner/grantee 200, stranger 404 == unknown, non-insight 404, failed-after-ok
- [x] 2.2 History spec: newest first, limit/since bounds 400 never clamped, every status listed
- [x] 2.3 Public: anon/stranger on private dashboard 404 == unknown, share token 200, foreign panel 404; schema allow-list test
- [x] 2.4 Cascade spec: deleting the Output removes its insight rows
- [x] 2.5 Guard spec: constructor param types EQUAL the D3 allow-list; red mutation = adding an OutputService param
- [x] 2.6 Retention spec: tier ages, newest ok + newest attempt kept, insight-part failure = Failed; update existing specs
- [x] 2.7 RlsPolicyGuardSpec.rlsTables gains output_insights; OutputInsightRlsSpec as helio_app_test (D9)
- [x] 2.8 Manual live RLS check per D9 (one rolled-back transaction, pg_roles proof); transcript in rls-live-check.md
- [x] 2.9 mutations.md: one recorded red run per new guard (ACL, public dashboard directive removed, allow-list, keep-latest, cascade)
