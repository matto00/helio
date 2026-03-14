## 1. Contracts and request models

- [x] 1.1 Add create-request JSON schema files for dashboard and panel POST payloads
- [x] 1.2 Add backend request DTOs and JSON unmarshalling for dashboard and panel creation
- [x] 1.3 Add request normalization helpers for defaulting blank or missing names and titles

## 2. Backend write behavior

- [x] 2.1 Extend dashboard creation flow to support POST route handling with `201 Created`
- [x] 2.2 Extend panel creation flow to validate dashboard existence and return `404 Not Found` when missing
- [x] 2.3 Add `POST /api/dashboards` and `POST /api/panels` routes with correct status codes and error handling

## 3. Verification

- [x] 3.1 Add ScalaTest route coverage for dashboard and panel POST success cases
- [x] 3.2 Add ScalaTest coverage for invalid panel requests and missing dashboard behavior
- [x] 3.3 Run backend verification with `sbt test` and confirm existing read routes remain non-breaking
