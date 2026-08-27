## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Ticket: HEL-829 · HEAD `ef685c0f` (on `b9f3727e`). Fresh cold review. The executor's and
evaluator's reports were read as claims only; every conclusion below is from a command I ran
myself in this worktree.

### What I verified (with evidence)

**1. CR-1 (the round-1 blocker) is genuinely closed — I wrote my OWN evasion fixtures**
Baseline on the clean tree: `check-no-credential-in-agent-surface: OK (12 files scanned, 0
violations)`, rc=0. I then injected each fixture into
`frontend/src/features/assistant/ui/MessageTurn.tsx` (restoring between each) and re-ran the
script:

| # | Fixture | rc | Result |
|---|---|---|---|
| A | `React.lazy(() => import("../../connectors/ui/InlineConnectorSetup"))` | **1** | FAIL, chain printed |
| B | `await import("../../connectors/ui/ConnectorCredentialField")` | **1** | FAIL, chain printed |
| C | multi-line `import(\n  "…/InlineConnectorSetup"\n)` | **1** | FAIL |
| D | static `import { InlineConnectorSetup } from "…"` (regression) | **1** | FAIL |
| E | side-effect `import "…/InlineConnectorSetup"` (regression) | **1** | FAIL |
| F | `export type Leak = { credential: string }` (regression) | **1** | FAIL, file:line reported |
| H | 2-hop transitive dynamic (`import("./__probeHelper")` → helper dynamically imports the banned module) | **1** | FAIL, full 4-node chain printed |

A/B/C/H are exactly the class round 1 reproduced as passing (rc=0) — all now red. D/E/F confirm no
regression from the regex change. The reported chains are real and specific (e.g.
`ChatPage.tsx -> ActiveConversationPanel.tsx -> MessageTurn.tsx -> __probeHelper.ts ->
InlineConnectorSetup.tsx`), not a generic failure.

**2. No false positive from the widened regex — checked against the real tree, not just fixtures**
The widened regex now follows genuine dynamic imports. The repo has several
(`ChartRenderer.tsx:13`, `MarkdownRenderer.tsx:13`, `AppRoutes.tsx:32/40/45` — all
`lazy(() => import("…"))`). With the fixed script the full-tree run is still `OK (12 files
scanned, 0 violations)`, rc=0 — the widened matcher walks more edges and finds nothing spurious.
A false positive would additionally require a non-import string literal starting with `.`
immediately preceded by `from`/`import`/`require`; none exists in the reachable graph, and the
worst case would be one extra file walked, not a failure.

Tree restored clean after all fixtures (`git status --porcelain` → empty).

**3. Scope of the fix commit — CONFIRMED in bounds**
`git show ef685c0f --stat` = 4 files: `scripts/check-no-credential-in-agent-surface.mjs` (+21/-3)
and three evidence/report docs (`evaluation-1.md`, `files-modified.md`, `skeptic-final-1.md`). No
production code, no UI, no backend touched by the fix — so round 1's live-flow, DESIGN.md and
breakpoint findings remain applicable, and I did not need to re-derive them from scratch.

**4. Full gate suite re-run fresh by me — ALL GREEN**
- `sbt test` (backend, run by me): `Tests: succeeded 3621, failed 0` · `[success] Total time: 206 s`
- `npm test`: `Test Suites: 265 passed, 265 total` · `Tests: 2894 passed`
- `npm run lint` → rc=0 (`--max-warnings=0`)
- `npm run typecheck` → clean
- `npm run format:check` → "All matched files use Prettier code style!"
- `check-schema-drift` → "schemas in sync with JsonProtocols (67 checked across 49 protocol files)"
- `check-openspec-hygiene` → "openspec/ is clean"
- `check-scala-quality` → "clean (143 soft warning(s))"
- `check-no-credential-in-agent-surface` → OK, 0 violations

**5. Live end-to-end re-confirmation of the core security property, with MY OWN fake credential**
`start-servers.sh` + `assert-phase.sh servers … → PASS servers` (dev 6261 / backend 9168).
I handed the review page my own `newConnector` proposal via router state, and typed
`skeptic2-fake-key-do-not-use-91bd7` into the API-key field, then submitted:
- Retrieval instructions rendered verbatim, alongside the literal in-UI statement "Agents never
  see this key — it is enforced in code…". Key field is a masked textbox with "Entered once. It
  won't be displayed again after saving."
- Network: exactly one non-GET call, `[POST] /api/connectors => 201`. Everything else was
  `GET /api/auth/me|dashboards|panels|connectors`.
- Post-submit probe for my key string: **absent** from the serialized DOM, every live input value,
  `localStorage`, `sessionStorage`, and `history.state`. Router state still carries only the
  credential-free `newConnector` draft.
- `.inline-connector-setup` had unmounted — never re-displayed (satisfies that AC).
- `grep` for the key in `.concertino-backend.log` / `.concertino-frontend.log` → **0 matches**.
- `GET /api/connectors` returns the new connector with `config` = `{apiKeyName, apiKeyPlacement,
  authType, implicit}` only — **no credential-capable field**, `hasKey: false`.
- Flow completes: summary flipped `NEWCONNECTOR` → `CONNECTORID cdf6eb79-…`, "Accept & create"
  went disabled → enabled. Screenshot reviewed: correct token-consistent modal rendering.
- Console errors: **0**.

**6. AC trace** — inline form with no detour (§5), verbatim provider retrieval instructions (§5),
demonstrated absence across every surface in both directions (§5 + round-1 §3 backend enumeration
specs, which I re-read and confirmed non-vacuous), mechanical guard with demonstrated red (§1 —
now including the dynamic-import arm that failed round 1). All met.

### Verdict: CONFIRM

The single round-1 blocker is closed by my own independent evasion attempts, with no regression and
no false positive, and the ticket's core security property re-verified live end-to-end with a fresh
fake credential. Ships.

### Non-blocking notes
1. One residual shape survives: a **template-literal** dynamic import,
   `import(\`../../connectors/ui/InlineConnectorSetup\`)`, still passes (rc=0) — the character
   class is `["']` only. This is not the idiomatic form anyone writes accidentally (backtick with
   no interpolation), and this script is a defense-in-depth tripwire against accidental
   reintroduction rather than the primary control (the primary control is that the components are
   simply not imported, plus the backend types that cannot carry a secret). Not blocking. Cheapest
   fix if ever wanted: add a backtick to the class (`["'\`]`); otherwise add it to the script's
   existing "Known residual limits" header block, which currently lists the exact-word `credential`
   scan and the relative-import-only walk but not this one.
2. `scripts/concertino/emit-event.sh` does not exist inside this worktree's `scripts/concertino/`
   (only in the main checkout), so `start-servers.sh` and `assert-phase.sh` each printed a
   `No such file or directory` line before their `READY`/`PASS`. Cosmetic, environmental, and
   unrelated to this ticket — both scripts still reported correctly.
