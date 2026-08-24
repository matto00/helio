# E2E

Playwright end-to-end specs, one file per scenario. Most are named after the
ticket that added them (e.g. `hel716-panel-creation-focus-trap.spec.ts`),
but not all — `auth-cookie-migration.spec.ts` is named for the scenario
instead. Consistent naming is not enforced.

**Belongs here:** browser-driven, full-stack test scenarios.
**Does not belong here:** unit/component tests. Frontend unit/component
tests are `*.test.ts(x)` files co-located with the source they test (e.g.
`frontend/src/app/App.test.tsx`). Backend unit tests are ScalaTest suites in
a separate, mirrored tree at `backend/src/test/scala/` (e.g.
`backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala`) — not
co-located, and not `.test.ts(x)` files.
