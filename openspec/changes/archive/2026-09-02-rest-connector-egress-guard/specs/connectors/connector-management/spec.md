## ADDED Requirements

### Requirement: A Connector base URL is validated against the egress policy
Creating or updating a Connector SHALL validate its `baseUrl` against the shared egress policy
(`outbound-egress-guard`) in addition to the existing non-empty check, and SHALL refuse the request with a 400-class
error when the base URL's scheme is not permitted or its host resolves to a disallowed address. A disallowed base URL
SHALL NOT be persisted.

This create-time check SHALL NOT be the only guard: because a hostname's resolution can change after the row is
stored, the fetch-time guard remains authoritative, and a stored Connector that later resolves to a disallowed address
SHALL still be refused at fetch time.

#### Scenario: Each blocked address class is refused at create
- **WHEN** a Connector is created with a `baseUrl` whose host resolves to a loopback address
- **THEN** the response is a 400-class error naming the disallowed address, and no Connector row is created
- **AND** the same holds independently for a link-local address and for an RFC1918 private address

#### Scenario: The metadata endpoint cannot be stored
- **WHEN** a Connector is created with `baseUrl` of `http://169.254.169.254/`
- **THEN** the request is refused and nothing is persisted

#### Scenario: An update cannot introduce a disallowed base URL
- **WHEN** an existing Connector is updated with a `baseUrl` resolving to a private address
- **THEN** the update is refused and the stored row is unchanged

#### Scenario: A legitimate external base URL is still accepted
- **WHEN** a Connector is created with a public HTTPS `baseUrl`
- **THEN** it is created exactly as before this change

#### Scenario: A previously stored disallowed base URL is refused at fetch time
- **WHEN** a Connector row exists whose base URL resolves to a disallowed address
- **THEN** a fetch using it is refused, independently of whether it passed validation when it was stored
