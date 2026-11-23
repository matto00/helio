# HEL-1713: helio-mcp connector: discovery advertises refresh tokens it never issues, and GET /mcp answers 401 instead of 405

## Description

Found by smoke-testing the first prod deploy of `helio-mcp` (revision `helio-mcp-00001-gzk`, image `helio-mcp:152b27fdd`) on 2026-11-11, against its run.app URL.

### What happened

1. **Refresh tokens advertised but not issued.** `GET /.well-known/oauth-authorization-server` returns `"grant_types_supported":["authorization_code","refresh_token"]`. The HEL-1709 design and `helio-mcp/README.md` say there are no refresh tokens: after 90 days or revocation the client re-authorizes. A client that trusts the metadata may try a refresh grant, get an error, and only then fall back to signing in again.
2. `GET /mcp` **answers 401, not 405.** HEL-1709's PR states `GET /mcp` answers `405`, which the MCP spec allows for a server without a server-initiated stream. Unauthenticated, it answers `401`, so the bearer check runs before the method check. That ordering is defensible, but the PR text and README describe something different.

### Repro

```bash
U=https://mcp.helioapp.dev   # or the run.app URL
curl -s $U/.well-known/oauth-authorization-server | grep -o '"grant_types_supported":[^]]*]'
curl -s -o /dev/null -w '%{http_code}\n' $U/mcp
```

(Prod is out of bounds for this run: the ticket's prod observation above is the prod evidence; reproduction is against a local helio-mcp process only.)

## Acceptance Criteria

- The discovery metadata lists only `authorization_code`, or the server really issues and honors refresh tokens. Pick one, and make the README match.
- Decide whether an unauthenticated `GET /mcp` should be `401` or `405`, then make the code, the README and a test agree. An authenticated `GET /mcp` should still be `405`.

## Notes

Not blocking: the claude.ai connector check (HEL-1710) can go ahead. Check it during HEL-1710 for whether claude.ai attempts a refresh grant.

Labels: Follow-up, Bug. Related: HEL-1709, HEL-1710.
