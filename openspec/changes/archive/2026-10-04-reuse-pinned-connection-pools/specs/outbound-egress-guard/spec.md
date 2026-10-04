## ADDED Requirements

### Requirement: Pinned connections are reused only for the same validated address
Caller-influenced outbound fetches SHALL reuse pooled connections across requests instead of opening a new connection
pool for every request. Reuse SHALL be keyed on the address that the shared egress policy validated for that request,
never on the hostname alone: a pooled connection pinned to one validated address SHALL NOT serve a request whose host
was validated to a different address. The egress policy check (resolution and address-class refusal) SHALL still run
for every request; reuse SHALL NOT skip or cache the destination decision. Concurrent requests to a single destination
SHALL NOT be refused merely because they share a reused pool, up to at least 256 concurrent requests per destination.

#### Scenario: Sequential requests to one validated address reuse connections
- **WHEN** several sequential caller-influenced fetches target the same host and each validates to the same address
- **THEN** they are served over fewer connections than requests (keep-alive reuse), not one new connection per request

#### Scenario: A host re-validated to a different address does not reuse the old connection
- **WHEN** a host validates to address A for one request and to a different allowed address B for the next request
- **THEN** the second request is connected to B, not served over a pooled connection to A

#### Scenario: Reuse does not bypass the egress check
- **WHEN** a host that previously validated to an allowed address now resolves to a blocked address
- **THEN** the fetch is refused before any connection is opened, even though a pooled connection for that host exists

#### Scenario: Concurrent requests to one destination are not refused by pooling
- **WHEN** more concurrent fetches than the per-pool default queue (32) target the same host and validated address
- **THEN** they all complete rather than being rejected for exceeding the pool's open-request limit
