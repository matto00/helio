## ADDED Requirements

### Requirement: A first-time Google OAuth signup writes an auth.register event
`AuthService.completeOAuth` SHALL write an `auth.register` audit event, in addition to its existing
login-outcome event, when the underlying `upsertGoogleUser` call creates a new account. A returning
Google login (an existing account) SHALL write no `auth.register` event.

#### Scenario: First-time Google signup writes both auth.register and a login row
- **WHEN** a Google OAuth exchange completes for an email/googleId with no existing account
- **THEN** exactly one `auth.register` audit event is written, and exactly one login-outcome event
  (`auth.login` or `auth.login.challenged`) is also written

#### Scenario: Returning Google login writes no auth.register row
- **WHEN** a Google OAuth exchange completes for an email/googleId that already has an account
- **THEN** no `auth.register` audit event is written, and exactly one login-outcome event is
  written

### Requirement: DataSourceService.refresh writes exactly one audit event per call, on success only
`DataSourceService.refresh` SHALL write exactly one audit event with action `data_source.refresh`
for a successful refresh, regardless of which source kind (static, csv, text, pdf, image) it
dispatched to. A failed refresh SHALL write no audit event.

#### Scenario: A successful refresh of any source kind writes exactly one row
- **WHEN** `DataSourceService.refresh` is called for a static, csv, text, pdf, or image source and
  the underlying refresh succeeds
- **THEN** exactly one audit event is written with action `data_source.refresh`, `resource_type`
  `data_source`, and `resource_id` equal to the source id

#### Scenario: A failed refresh writes no audit event
- **WHEN** `DataSourceService.refresh` is called and the underlying refresh fails
- **THEN** no `data_source.refresh` audit event is written for that call

### Requirement: SourceService.refresh writes exactly one audit event per call, on success only
`SourceService.refresh` SHALL write exactly one audit event with action `data_source.refresh` for a
successful refresh, for both sql and rest sources. A failed refresh SHALL write no audit event.

#### Scenario: A successful sql or rest refresh writes exactly one row
- **WHEN** `SourceService.refresh` is called for a sql or rest source and the underlying refresh
  succeeds
- **THEN** exactly one audit event is written with action `data_source.refresh`, `resource_type`
  `data_source`, and `resource_id` equal to the source id

#### Scenario: A failed sql or rest refresh writes no audit event
- **WHEN** `SourceService.refresh` is called and the underlying refresh fails
- **THEN** no `data_source.refresh` audit event is written for that call
