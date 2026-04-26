# Backend Scaffold

Scala + Pekko backend scaffold.

No service implementation is included yet.

Planned structure:

- `src/main/scala/com/helio/app` runtime bootstrap
- `src/main/scala/com/helio/api` HTTP/API adapters
- `src/main/scala/com/helio/domain` domain models and logic
- `src/main/scala/com/helio/security` authn/authz and validation boundaries
- `src/main/scala/com/helio/infrastructure` persistence/external integrations
- `src/test/scala/com/helio` ScalaTest suites
