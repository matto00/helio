## ADDED Requirements

### Requirement: Public dashboard reads may be authorized by a share token

The public dashboard read routes SHALL accept a share token supplied as the URL query parameter named `token`
and SHALL serve the dashboard's panels and rows when that token is valid for the dashboard. The parameter name
`token` is part of the published contract, because the share URL must itself carry the credential — a link or
an embedding frame cannot attach a request header — and a downstream embed view consumes this exact interface. Serving under a token SHALL return the
same representation the public-viewer grant path returns; a token SHALL NOT widen what is exposed.

#### Scenario: Panels are readable with a valid token
- **WHEN** an unauthenticated caller requests a dashboard's panels with `?token=<valid token>`
- **THEN** the panels are returned, identically to the public-viewer grant path

#### Scenario: Rows are readable with a valid token
- **WHEN** an unauthenticated caller requests a panel's rows presenting a valid share token for the dashboard
- **THEN** the rows are returned, identically to the public-viewer grant path

#### Scenario: A token does not expose more than a public grant
- **WHEN** a dashboard is read under a valid share token
- **THEN** no field, panel, or row is exposed that the public-viewer grant path would not expose

#### Scenario: Invalid token yields the private-resource response
- **WHEN** an unauthenticated caller requests a dashboard's panels presenting an expired, revoked, or unknown
  token, and no public viewer grant applies
- **THEN** the response is the same `404 Not Found` returned for a private dashboard

### Requirement: Tenant isolation holds on the token-authorized read path

Row-level tenant isolation SHALL apply to reads authorized by a share token exactly as it applies to reads
authorized by a public-viewer grant. A share token SHALL NOT cause data belonging to another tenant to be
returned.

#### Scenario: Token read is confined to the owning tenant's data
- **WHEN** a dashboard is read under a valid share token
- **THEN** only rows belonging to the dashboard owner's tenant are returned
