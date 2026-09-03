## ADDED Requirements

### Requirement: Schema-inference and connection-test endpoints refuse disallowed destinations
`POST /api/sources/infer` and `POST /api/sources/test` SHALL apply the shared egress policy
(`outbound-egress-guard`) to the destination they are asked to contact, whether that destination comes from a bare
caller-supplied URL or from a referenced Connector. A disallowed destination SHALL produce an error whose message names the
disallowed address rather than an unexplained failure. `infer` reports it on its existing 502-class fetch-failure
channel; `test` reports it, as it already does for any failed connection test, as a 200 response carrying
`ok = false` and the reason in `error`.

#### Scenario: infer refuses each blocked address class
- **WHEN** `POST /api/sources/infer` is called with a URL whose host resolves to a loopback, link-local, or private
  address
- **THEN** the response is a 502-class error whose message states the host resolves to a disallowed address, for each
  class independently
- **AND** no outbound request is issued

#### Scenario: test refuses each blocked address class
- **WHEN** `POST /api/sources/test` is called with a URL whose host resolves to a loopback, link-local, or private
  address
- **THEN** the response is 200 with `ok = false` and `error` naming the disallowed address, for each class
  independently
- **AND** no outbound request is issued

#### Scenario: A legitimate external URL still infers and tests successfully
- **WHEN** either endpoint is called with a reachable public HTTPS URL
- **THEN** it behaves exactly as before this change
