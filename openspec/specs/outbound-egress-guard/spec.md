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
