## Context

audit-ci supports module, advisory (`GHSA-...`), and path (`GHSA-...|a>b>c`, with `*` wildcards) allowlist records, plus object records with `expiry`/`notes`. The advisory appears on ~22 root paths, all ending `micromatch>braces` (via jest packages). See proposal.md.

## Goals / Non-Goals

**Goals:** green root audit with the narrowest record; reviewable, dated justification in-file.
**Non-Goals:** dependency bumps/overrides (none can fix it), touching frontend/ or helio-mcp audit configs, severity changes.

## Decisions

- **Record form:** prefer the path-scoped wildcard `GHSA-vfj7-8cjw-p6xm|*micromatch>braces*` over the bare advisory id, so the same advisory arriving via any non-micromatch path still fails. Executor verifies empirically that it makes audit-ci pass; if wildcard matching does not cover every reported path, fall back to the bare GHSA id (still advisory-specific) and say why. Rejected: module record `braces` (suppresses future braces advisories), severity downgrade, per-path enumeration of 22 records (brittle against lockfile churn).
- **Review date:** comment only (owner's ruling). audit-ci's `expiry` field would make CI go red on 2026-11-02 for every PR, a surprise outage rather than a review prompt; rejected.
- **Stale header:** the file's "Empty today" sentence becomes false; reword it.

## Risks / Trade-offs

[Allowlist forgotten] -> dated in-comment review-by plus ticket reference. [Dev-only claim drifts] -> `npm ls braces --omit=dev` empty is re-verified in this change's evidence.
