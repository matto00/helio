## ADDED Requirements

### Requirement: REST fetches refuse disallowed destinations
Every outbound request issued on behalf of a REST source SHALL be governed by the shared egress policy
(`outbound-egress-guard`), regardless of which entry point issued it — a source refresh, a preview, a pipeline run, a
connection test, or a schema inference. This SHALL hold for a destination assembled from a Connector's stored base URL
and a source's endpoint as well as for a bare caller-supplied URL.

The refusal SHALL be reported on whichever error channel the entry point already uses for a failed fetch, and its
message SHALL name the disallowed address so a caller can distinguish a destination that is not permitted from one
that is merely unreachable. For a refresh, a preview, a pipeline run, or a schema inference that is a 502-class
upstream error. A connection test is the one exception: it already reports any failure as a 200 response carrying
`ok = false` and the reason in `error`, and an egress refusal is reported the same way (see
`connection-test-endpoint`).

The status code is NOT specialised for this case: the REST driver reports every failure as an untyped message, and
introducing a typed error channel would change the shared connector-driver contract and every consumer of it — out of
scope here, carried as a follow-up. The refusal at Connector create/update time is unaffected and remains a 400-class
client error.

#### Scenario: A REST source refresh targeting an internal address is refused
- **WHEN** a REST source whose resolved destination is a loopback, link-local, or private address is refreshed
- **THEN** the fetch is refused with a 502-class error whose message states the host resolves to a disallowed address
- **AND** no outbound request is issued

#### Scenario: The cloud metadata endpoint is refused
- **WHEN** a REST fetch resolves to `169.254.169.254`
- **THEN** the fetch is refused before any connection is opened

#### Scenario: A legitimate external destination still succeeds
- **WHEN** a REST source targets a reachable public HTTPS endpoint
- **THEN** the fetch succeeds and returns rows exactly as before this change
- **AND** the request still carries its configured method, headers, body, and injected credential

### Requirement: A REST redirect response is not treated as success
A 3xx response to a REST fetch SHALL be treated as a failure and its body SHALL NOT be parsed as the response payload.

#### Scenario: A 302 is reported as a failure
- **WHEN** a REST fetch receives a 302 response
- **THEN** the result is an error, not a successfully parsed body
