# Protocols — Home

`HomeSummaryProtocol`: the write-only response shape of `GET /api/home-summary` (HEL-1578). Contract:
`schemas/home/home-summary-response.schema.json`.

**Belongs here:** Home-page response case classes and their spray-json formats.
**Does not belong here:** the summary's domain types (`services/home/`) or its SQL (`infrastructure/persistence/home/`).
