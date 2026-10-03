# HEL-1245: REST connector fails with "Response entity was not subscribed after 1 second" on 200 OK responses (prod, recurring since 2026-09-13)

## Description
Prod logs (logger com.helio.domain.connectors.RestApiConnectorDriver, "REST source request failed") show, roughly every other day since 2026-09-13 across revisions 00078-00086:
java.util.concurrent.TimeoutException: Response entity was not subscribed after 1 second ... GET /v1/league/<id>/users Empty -> 200 OK Chunked
at org.apache.pekko.http.impl.engine.client.pool.SlotState$WaitingForResponseEntitySubscription.onTimeout
The upstream (Sleeper-style API) answered 200 OK chunked; the driver did not subscribe within pekko response-entity-subscription-timeout (default 1s). The pipeline run fails. Not egress related (recurs pre-cutover).

Likely shape (claim, verify): something between receiving the HttpResponse and consuming entity takes >1s or never happens on some paths; blocking/sequential step; Future chain consuming several responses serially; non-200 branch that never discards. Per systematic-debugging law, probe-confirm before fixing; reproduce locally against a chunked slow-body upstream.

## Acceptance Criteria
- The root cause is identified and fixed so every response path consumes or discards its entity promptly.
- A test reproduces the timeout red before the fix, and is green after.
- Raising response-entity-subscription-timeout alone is not acceptable without the root cause; if a config change is legitimately needed too, justify it with the probe.
- Check no other connector (plain-text/markdown HEL-215, CSV URL fetch / ContentSourceSupport.fetchUrl) has the same pattern. Fix in scope if identical bug in shared code, else file a follow-up.
