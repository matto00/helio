# Services

Cross-feature HTTP/error-handling infrastructure: `httpClient.ts` (the
shared axios instance), `classifyRequestError.ts`,
`extractErrorMessage.ts`.

**Belongs here:** infrastructure every feature's API client builds on.
**Does not belong here:** a feature's own API calls — those live in that
feature's own `services/` (e.g. `features/dashboards/services`,
`features/sources/services`) and import from here.
