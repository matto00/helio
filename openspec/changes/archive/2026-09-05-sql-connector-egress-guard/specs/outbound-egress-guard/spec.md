## ADDED Requirements

### Requirement: The shared egress policy governs JDBC destinations
A caller-configured JDBC destination SHALL be validated against the same single egress policy that governs outbound
HTTP fetches, by resolving the configured host and refusing it when any resolved address is in the blocked set. The
policy SHALL NOT be reimplemented or re-expressed for the JDBC path; the JDBC path SHALL call the same shared
address-class check.

#### Scenario: A JDBC host resolving to blocked space is refused
- **WHEN** a SQL data source is connected with a host that resolves to a loopback, link-local, private, unique-local,
  any-local, or multicast address
- **THEN** no JDBC connection is opened
- **AND** the operation fails with an egress refusal

#### Scenario: A DNS name is judged by its resolved address
- **WHEN** the configured host is a DNS name that resolves to a blocked address
- **THEN** it is refused on the basis of the resolved address, not on the spelling of the hostname

#### Scenario: The JDBC path shares the HTTP path's denylist
- **WHEN** the blocked address set is reviewed
- **THEN** the JDBC path and the outbound-HTTP path consult one and the same definition

### Requirement: The JDBC path is exempt from connection pinning, with the residual risk recorded
The JDBC path SHALL be a recorded exemption from the pinning requirement. The exemption SHALL state why the
`ClientTransport` pin used for outbound HTTP has no JDBC equivalent, SHALL record what was checked in the drivers in
use, and SHALL state the residual DNS-rebinding risk that is being accepted.

#### Scenario: The exemption is accounted for
- **WHEN** the enumeration of egress-governed sites is reviewed
- **THEN** the JDBC path is listed as governed by the policy but exempt from pinning
- **AND** the exemption names why pinning does not transfer and what residual risk remains
