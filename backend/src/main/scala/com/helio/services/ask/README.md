# Services — Ask

Ask-your-data (HEL-1745): a read-only tool loop over one dashboard's or one Output's data, with cited, validated answers.

Holds: `AskDataService` (loop, validation, retry), `AskAccess` (explicit-SQL access and scope), `AskToolExecutor` + `AskTools` (the four read tools), `AskReads`, `AskCitationLedger`, `AskPinBuilder`, `AskPrompts`.

Does NOT hold: persistence (nothing is stored), billing (the route charges through `ChatAccessService`), or any write tool.
