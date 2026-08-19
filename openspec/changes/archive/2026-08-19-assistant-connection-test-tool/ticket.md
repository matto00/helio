# HEL-756: Assistant proposes REST data sources with zero connection verification before finalizing

## Description

Confirmed via code (`backend/src/main/scala/com/helio/services/AssistantToolExecutor.scala:80-85`): the top-level assistant's full tool list is `find`, `get_resource`, `propose_dashboard`, `propose_pipeline`, `propose_combined`, `propose_patch_set` — no connection-test tool among them. When the assistant proposes a REST data source (`propose_pipeline`/`propose_combined`), the URL/params it picks are pure LLM output with zero verification of any kind before being shown to the user as a ready-to-apply proposal.

Live example (2026-08-19): the assistant proposed a pipeline with a REST source at `lm-api-reads.espn.com`, a hostname that doesn't resolve in DNS at all (confirmed from multiple vantage points — not transient, not a Helio-side network issue). The user only found out the endpoint was bogus after accepting and applying the proposal (see the sibling ticket for the raw-502 failure mode that also needs fixing).

## Fix

A complete, already-built connection-test capability already exists server-side and is unused by the assistant: `Connector[Config].testConnection` → `ConnectionTest.run` (`Connector.scala:96`, `ConnectionTest.scala:22-26`), currently wired only to the pre-creation `POST /api/data-sources/*/test` routes (`SourceService.scala:115-126`).

Add a `test_connection` (or similar) tool to the assistant's tool list, and have the system prompt/tool-loop logic require calling it on any REST/SQL source before finalizing a `propose_pipeline`/`propose_combined` call that includes one — so a nonexistent or unreachable endpoint gets caught and either self-corrected or clearly flagged to the user *before* they're asked to accept a proposal that can't actually work, rather than after.

This closes the "verify what I'm about to propose" gap. It does not address the separate "the assistant doesn't know what a genuinely correct API endpoint even is" gap — see the sibling ticket for that (real external research capability).

## Acceptance Criteria

- The assistant's tool list includes a `test_connection` (or equivalently named) tool that invokes the existing `Connector[Config].testConnection` / `ConnectionTest.run` capability for REST/SQL sources.
- The assistant's tool-loop logic (system prompt and/or orchestration code) requires calling this tool on any REST/SQL data source before finalizing a `propose_pipeline` or `propose_combined` call that includes one.
- A nonexistent/unreachable endpoint (e.g. DNS failure, connection refused, timeout) is caught before the proposal is finalized — the assistant either self-corrects (tries a different endpoint/params) or clearly flags the failure to the user in its response, rather than silently finalizing a proposal that can't work.
- Existing `propose_dashboard`, `propose_patch_set`, `find`, `get_resource` tool behavior is unaffected.
- Sources that are not REST/SQL (or pipelines with no new data source) are unaffected — no spurious connection-test requirement.
