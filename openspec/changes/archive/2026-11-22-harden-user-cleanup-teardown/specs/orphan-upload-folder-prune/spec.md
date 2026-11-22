## ADDED Requirements

### Requirement: Prune database credentials may come from DB_USER and DB_PASSWORD

When `DB_USER` or `DB_PASSWORD` is set in the process environment, the prune script SHALL pass them to every database
it queries as the database user and password, exactly as the e2e database helpers do, so a database URL without
embedded credentials connects. It SHALL NOT print either value, and any error output SHALL have them removed.

#### Scenario: A credential-less URL with credentials in the environment

- **WHEN** the script runs with a database URL that carries no user or password and `DB_USER`/`DB_PASSWORD` set
- **THEN** the database query receives that user and password, and neither value appears in the script's output

#### Scenario: A failing query never prints the environment credentials

- **WHEN** the query fails and the database client's error text contains the user or password
- **THEN** the script exits non-zero and its output has those values redacted
