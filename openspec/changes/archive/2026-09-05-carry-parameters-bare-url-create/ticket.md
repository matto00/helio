# HEL-983: SourceService's bare-url create path silently drops request.config.parameters (HEL-823 templating values)

## Description

`SourceService`'s bare-`url` REST create branch synthesizes an implicit Connector and then builds a `RestApiConfig` by hand. That constructor does not carry `request.config.parameters` across, so the source-level `{{name}}` template values a caller supplied are silently discarded at creation time.

The result is a source persisted with template placeholders in its `endpoint`/`queryParams`/`headers`/`body` but no `parameters` map to resolve them against. At fetch time `TemplateInterpolator` fails on the first unresolved variable, so the source never fetches — the request is refused rather than issued wrong.

Unlike its sibling defects at the same call site, this one fails loud at fetch time, not silently — HEL-823's unresolved-variable guard catches it before any request is built. So it is a broken-authoring-path bug, not a silent-corruption bug: the caller's input is accepted, discarded, and the resulting source is dead on arrival with an error that names a template variable rather than the real cause (the parameters were dropped at create).

## What Changes

Pass `request.config.parameters` through in the bare-`url` branch's `RestApiConfig` construction, alongside the fields it already carries.

## Acceptance Criteria

- [ ] A REST source created via the bare-`url` path with both `{{name}}` placeholders and a `parameters` map persists that map, and fetches with the placeholders resolved — proven against a real HTTP server, asserting the query string/headers the server received
- [ ] A red test demonstrates the current drop before the fix, so the guard is not vacuous

## Constraints

- No production database or deploy access.
- The dev Postgres is shared across worktrees; two other runs (HEL-987, HEL-985) are live and neither adds a migration. This change must not add a Flyway migration — the fix is a constructor-argument pass-through with no schema impact. If a migration were ever thought necessary, escalate rather than write one.

## Provenance

Found during HEL-844's planning, at the same call site as that ticket's fourth collapse point (the bare-`url` path also discarded the URL's entire query string, which HEL-844 fixed). Recorded as task 4b.3 in HEL-844's plan and deliberately left unfixed there.
