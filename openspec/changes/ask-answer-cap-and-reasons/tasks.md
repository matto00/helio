## Standing Constraints

- [C1] Never read, cat, grep, source or print any .env file; never run env-dumping commands. scripts/concertino/.concertino.env may be read by scripts but never printed.
- [C2] Quoted heredocs only (<<'EOF') or Write/Edit; no backticks or $(...) inside echo strings.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with stop-servers.sh; DB residue deleted only by exact id via buildUserDeleteSql.
- [C4] jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19.
- [C5] timeout 600000 on long calls; use sbt testFull and read the test summary, not the exit code alone.
- [C12] RED FIRST: tests written and run red before the code, red runs recorded; every guard has a recorded mutation; evaluator and skeptic run the full ask spec files (AskDataServiceSpec, AskRoutesSpec, AskCitationLedgerSpec, plus any new ask spec).
- [C13] Scratch only in .concertino/scratch/HEL-1761/.
- [C15] No live model calls. Fakes only (ScriptedTransport).

## 1. Red tests

- [x] 1.0 Extend `ScriptedTransport` (testsupport) with an optional per-step `stop_reason` override (it derives one from the blocks today) and a way to script a thinking block. Do not duplicate the transport.

- [x] 1.1 AskDataServiceSpec: a hop returning only a thinking block with `stop_reason: max_tokens` yields `AskError.Truncated` (red today: `Failed(BadGateway)`).
- [x] 1.2 AskDataServiceSpec: a hop returning text with `stop_reason: max_tokens` yields `Truncated` and never a `Right` (red today). Same on the corrective hop.
- [x] 1.3 AskDataServiceSpec / wire test: every request's `max_tokens` is 4096 (red today: 1024; assert on the sent value AND on the service constant so a cap above 4096, invisible under the harness clamp, is also caught), and the HEL-1755 wire test still finds no `thinking`/`budget_tokens`/sampling/`tool_choice`.
- [x] 1.4 AskRoutesSpec: thinking-only max_tokens hop -> `422` `{code: "ASK_ANSWER_TRUNCATED"}`, no answer text, not `502` (red today).
- [x] 1.4b AskRoutesSpec: partial-text max_tokens hop -> `422 ASK_ANSWER_TRUNCATED`, and the wire body does not contain that text (red today).
- [x] 1.5 AskRoutesSpec: two ungrounded answers containing "99" and "2026-11-30" -> `422 ASK_UNGROUNDED` whose `reasons` contain no digit (red today).
- [x] 1.6 Pin tests per design D6 (distinct root id; no step and no root id; create round trip). Record the mutations that turn each red.
- [x] 1.7 Record each red run (command + failing assertion) in `.concertino/scratch/HEL-1761/` and summarise in `red-evidence.md` in the change dir.

## 2. Implementation

- [x] 2.1 `FinalResponse` second parameter list gains `stopReason`; `ClaudeClient` sets it. No other consumer changes.
- [x] 2.2 `AskDataService`: cap 4096; `AskError.Truncated`; map `NoAnswer(Some("max_tokens"))` and a `max_tokens` `FinalResponse` (both hops) to it before validation; one WARN without answer text.
- [x] 2.3 Public reason categories (D5) and the route's 422 mapping; `AskRoutes` maps `Truncated` to `422 ASK_ANSWER_TRUNCATED`.
- [x] 2.4 CLAUDE.md ask endpoint line: the `422 ASK_ANSWER_TRUNCATED` outcome and value-free `reasons`.

## 3. Verification

- [x] 3.1 All tests from 1.x green; full ask spec files green via `sbt testFull` filtered to the ask specs (and ClaudeClient specs touching FinalResponse).
- [x] 3.2 Mutation record for each guard (truncation mapping x2, digit-free reasons, cap value, pin fallback x2) in `red-evidence.md`.
- [x] 3.3 Pre-commit gates pass.
