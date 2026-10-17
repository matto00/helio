# Services — Home

The Home page's summary (HEL-1578). `HomeSummaryBuilder` is a pure ranking / attention / upcoming / up-next derivation
over the rows one owner-scoped read returns; `HomeSummaryService` reads and builds; `HomeSummaryModel` holds the
domain types and the bounds (`HomeSummaryLimits`).
