# outbound-egress-guard Specification

## Purpose
Defines the single shared egress policy for backend-issued outbound HTTP requests whose destination is influenced by a
caller: which destinations are refused, that the connection is pinned to the address that was actually checked, and the
standing requirement that every such fetch site routes through this one policy rather than reimplementing it.

## Requirements

### Requirement: A single shared egress policy governs caller-influenced outbound fetches
The backend SHALL expose exactly one egress policy — the existing `ContentSourceSupport` denylist and its
validate-then-pin behavior — and every outbound HTTP fetch whose destination is influenced by caller-supplied input
SHALL be governed by it. A caller that cannot use the shared fetch helper (because it must issue a request the helper
does not build, such as one carrying a method, headers, body, or credential) SHALL still obtain its destination
decision and its pinned connection from the shared policy, and SHALL NOT reimplement any part of the address check.

The policy SHALL refuse: any scheme other than `http` or `https`; a URL with no host; a host that cannot be resolved;
and a host resolving to a loopback, link-local (including the `169.254.0.0/16` cloud-metadata range), RFC1918 private,
IPv6 site-local, IPv6 unique-local, any-local, or multicast address.

Refusal SHALL happen before any network connection to the destination is opened.

#### Scenario: A second address check is not introduced
- **WHEN** a caller-influenced outbound fetch site needs a destination decision
- **THEN** it obtains that decision from the shared policy
- **AND** no address-class, scheme, or host check is duplicated at the call site

#### Scenario: Every blocked address class is refused
- **WHEN** a caller-influenced outbound fetch targets a host resolving to a loopback, link-local, RFC1918 private,
  IPv6 site-local, IPv6 unique-local, any-local, or multicast address
- **THEN** the fetch is refused for each of those classes independently
- **AND** the error states that the host resolves to a disallowed address

#### Scenario: A disallowed scheme is refused before any connection
- **WHEN** a caller-influenced outbound fetch targets a `file://`, `ftp://`, or `gopher://` URL
- **THEN** the fetch is refused and the error names the offending scheme
- **AND** no outbound connection is opened

### Requirement: The connection is pinned to the validated address
The shared policy SHALL resolve the destination host once, and the resulting connection SHALL be made to exactly the
address that was checked. The HTTP client SHALL NOT perform a second, independent resolution of the hostname when it
opens the connection, so a DNS answer that changes between the check and the connect cannot redirect the request. The
original hostname SHALL still be used for the `Host` header and, for `https`, for TLS hostname verification.

#### Scenario: A rebinding answer cannot redirect the fetch
- **WHEN** a host resolves to an allowed public address at validation time and to an internal address on a subsequent
  resolution
- **THEN** the connection is made to the address that was validated, not the later one

#### Scenario: A host resolving to an internal address is refused
- **WHEN** a DNS name resolves to an address in a blocked class
- **THEN** the fetch is refused before any connection is opened

### Requirement: Redirect responses are not followed
A caller-influenced outbound fetch SHALL NOT follow a redirect response. A 3xx status SHALL be treated as a failed
fetch and SHALL NOT be treated as success, and its body SHALL NOT be parsed or returned as content. A redirect to an
internal address therefore cannot be reached even though its first hop targeted an allowed destination.

#### Scenario: A redirect to an internal address is not followed
- **WHEN** an allowed external destination responds with a 3xx redirect pointing at an internal address
- **THEN** no request is made to the redirect target
- **AND** the fetch fails rather than returning the redirect response as content

#### Scenario: A redirect is not mistaken for success
- **WHEN** a caller-influenced outbound fetch receives a 3xx response
- **THEN** the result is an error, not a successful fetch

### Requirement: Outbound-fetch sites are enumerated and each is accounted for
The change SHALL record an enumeration of every backend site that issues an outbound HTTP request, and each entry SHALL
be shown either to be governed by the shared egress policy, or to be exempt with a stated justification. An exemption
SHALL rest on the destination not being caller-influenced, and SHALL name what fixes it.

#### Scenario: Each enumerated site is accounted for
- **WHEN** the enumeration is reviewed
- **THEN** every listed site is marked governed or exempt
- **AND** each exemption states why its destination is not caller-influenced

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

### Requirement: The JDBC path re-validates the destination address at TCP connect
The JDBC path SHALL re-validate the destination address at the moment the driver opens its TCP connection, using a driver socket-factory hook for each supported dialect (`postgresql`, `mysql`). The hook SHALL validate the address actually being connected to (never a re-resolved hostname) against the same shared egress policy that governs outbound HTTP, and SHALL refuse to connect when that address is blocked or unresolved. The application's own database connection SHALL NOT use this hook. Connections SHALL NOT use URL rewriting, so TLS hostname verification is unaffected. Because no hook can be assumed for other dialects, a dialect other than `postgresql` or `mysql` SHALL be refused with a clear client error at source creation and at connect time.

#### Scenario: A rebinding resolver does not reach the internal address
- **WHEN** the egress guard's lookup sees a public address and the driver's own lookup of the same host yields an internal address
- **THEN** the connect-time hook refuses the connection
- **AND** no TCP connection to the internal address is accepted

#### Scenario: Both supported dialects are covered
- **WHEN** a SQL connection to a user-supplied host is opened for `postgresql` or `mysql`
- **THEN** the connection is made through the connect-time re-validating socket factory

#### Scenario: An unknown dialect is refused
- **WHEN** a SQL data source names a dialect other than `postgresql` or `mysql`
- **THEN** creation is refused with a 4xx and a message naming the supported dialects
- **AND** an already-persisted source with such a dialect fails at connect with the same message and opens no connection

#### Scenario: The application's own database is unaffected
- **WHEN** the application opens its own database connection pool or notify connection
- **THEN** no connect-time egress socket factory is attached

### Requirement: JDBC URL components cannot override the connect-time hook
The database name of a SQL source SHALL be restricted to a safe identifier character set so no user-controlled value can introduce a JDBC URL query parameter (such as `socketFactory`) that would override or disable the connect-time hook. A violating source SHALL be refused with a 4xx at creation and at connect time.

#### Scenario: A database name carrying a URL parameter is refused
- **WHEN** a SQL source's database is `x?socketFactory=javax.net.DefaultSocketFactory`
- **THEN** it is refused and no connection is opened
