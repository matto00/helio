# Persistence — Home

`HomeSummaryRepository` (HEL-1578): the Home summary's two set-based reads (24h real runs, enabled schedules) in one
`withUserContext` transaction, each with an explicit `pipelines.owner_id = caller` filter.
