## ADDED Requirements

### Requirement: Malformed, duplicate, or misplaced controls are rejected with a 400
Every write path that stores an output panel's `config.controls` SHALL reject a malformed controls payload (a non-array `controls`, a non-object element, or an element missing or mistyping a required attribute), a controls list containing two entries with the same `id`, and any `config.controls` key supplied for a non-output panel (including an empty array), with an HTTP 4xx (400) and a message naming the problem. It SHALL NOT return 500 and SHALL NOT silently ignore or drop the supplied controls.

#### Scenario: Malformed controls on PATCH
- **WHEN** `PATCH /api/panels/:id` is sent with `config.controls` that is not an array, contains a non-object element, or an element missing `id`
- **THEN** the response is 400 with the decoder's message and nothing is persisted

#### Scenario: Duplicate control ids
- **WHEN** a write supplies two controls with the same `id`
- **THEN** the response is 400 naming the duplicate id and nothing is persisted

#### Scenario: Controls on a non-output panel
- **WHEN** `PATCH /api/panels/:id` targets a non-output panel and carries a `config.controls` key (including an empty array)
- **THEN** the response is 400 stating controls are only supported on an output panel

#### Scenario: Non-array or malformed controls on create, batch create, import, contents replace and proposal apply
- **WHEN** `POST /api/panels`, `POST /api/panels/batch`, `POST /api/dashboards/import`, `PUT /api/dashboards/:id/contents` or `POST /api/dashboards/apply-proposal` carries an output panel whose `config.controls` is not an array
- **THEN** the response is 400 stating `controls must be an array` and no panel is created or replaced

#### Scenario: Batch PATCH rejects the same inputs
- **WHEN** `POST /api/panels/updateBatch` carries an item whose `config.controls` is malformed, contains a duplicate id, or targets a non-output panel
- **THEN** the response is 400 naming the offending panel id and nothing is persisted for any item

#### Scenario: Duplicate ids and misplaced controls on every create-side path
- **WHEN** create, batch create, import, contents replace or proposal apply supplies a duplicate control id, or a `config.controls` key on a non-output panel
- **THEN** the response is 400 naming the duplicate id, or stating controls are only supported on an output panel
