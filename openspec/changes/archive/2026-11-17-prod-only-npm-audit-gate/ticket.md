# HEL-1753: CI security job: add a production-only npm audit so a dev-only allowlist can never hide a production advisory

## Description

origin_kind: followup
origin_ticket: HEL-1751 (PR matto00/helio#1148, merged as 54892e9fc)

HEL-1751 added allowlist entries for picomatch GHSA-fc5q-39xc-vjpf, one per package, in the root and `frontend/` `.audit-ci.jsonc`. audit-ci paths don't say whether a dependency is dev or prod. So if one of the listed packages became a direct **production** dependency, the advisory would still pass the gate. For example, a production `micromatch@4.0.8` passes at the root today. Any allowlist that accepts the real paths has this gap.

The owner asked for this to be filed on 2026-11-17.

**Fix:** add a step to the `security` job in `.github/workflows/ci.yml` that runs a production-only audit for the root, `frontend/` and `helio-mcp/`, with no allowlist (`npm audit --omit=dev` at the moderate threshold, or audit-ci with an equivalent prod-only option). Because a production advisory can never be allowlisted there, a dev-only allowlist can't hide one.

## Acceptance Criteria

- The new step runs in the `security` job for all three trees. It is green on main today; record the output showing 0 production advisories.
- It fails first: a scratch lockfile that adds an allowlisted package as a production dependency is green under the current gate and red under the new step. Record both runs.
- Design decision: if a production advisory has no patch, this step allows no exceptions. State that, and how an exception would be handled (owner call, separate ticket).
- The workflow comment names this ticket, HEL-1751 and HEL-1246.

## Related

- HEL-1751 (origin), HEL-1246 (braces dev-only allowlist precedent).
