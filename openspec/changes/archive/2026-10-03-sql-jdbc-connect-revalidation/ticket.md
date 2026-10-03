# HEL-998: Pin the SQL connector's JDBC connection to the validated address (per-dialect socket factory)

## Description
HEL-952 added an SSRF egress guard to the SQL connector (resolve host, refuse if any address is blocked) at connect time and create time, but did not pin the JDBC connection to the validated address: the JDBC driver re-resolves the hostname itself, leaving a DNS-rebinding TOCTOU window (guard sees a public address, the driver sees an internal one). HEL-952 recorded this as an exemption in the `outbound-egress-guard` spec and deferred the fix to this ticket.

Scope: decide whether to pin per-dialect via socket factories or accept the residual risk; if pinning, cover postgresql and mysql and decide explicitly what happens to an unknown dialect. A socket factory that re-validates the address at the moment of TCP connect is an alternative that closes the same TOCTOU without URL rewriting or TLS impact.

## OWNER RULING (2026-10-03) - binding
Re-validate at connect, and refuse unknown dialects.
- For postgresql and mysql use a driver socket-factory hook that re-validates the resolved address against the egress policy at the moment of TCP connect (no URL rewriting; TLS hostname verification unaffected).
- Unknown dialects are refused. This deliberately accepts the regression against HEL-952's AC4.
- Update the `outbound-egress-guard` spec's JDBC exemption to match.
- Prove with a rebinding resolver test: public on first lookup, internal on second, the internal address is never reached.

## Acceptance Criteria
- [ ] The JDBC connection is connect-time re-validated for every supported dialect (postgresql, mysql).
- [ ] A test proves a rebinding resolver (public on first lookup, internal on second) does not reach the internal address; it is mutation-failable and shown red on unmodified main.
- [ ] The unknown-dialect case is explicitly decided: refused with a clear 4xx at create and at connect time.
- [ ] `outbound-egress-guard`'s JDBC pinning exemption is updated to match the outcome.
- [ ] TLS through the custom factory is proven working (or what changes is stated precisely).
- [ ] The app's own DB pool (Cloud SQL, private IP) is proven untouched by the factory.
- [ ] Every JDBC open site to a user-supplied host is enumerated; existing dev-DB SQL connectors with other dialects are inventoried read-only.
