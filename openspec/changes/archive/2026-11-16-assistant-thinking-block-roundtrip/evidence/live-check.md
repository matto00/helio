# Live check (task 4.3, design D12): COMPLETED on merged head (after merging origin/main)

Setup: local backend on the lane ports via scripts/concertino/start-servers.sh, CLAUDE_MODEL=claude-haiku-5-5,
LOG_FORMAT=json (to read AssistantTelemetry usage). Key loaded by the app's own .env handling (not read by the
agent). Dev account. The earlier 401 (cycle 1) is superseded: the owner fixed the key; all calls returned 200.

Conversations (all created via the API as the dev account):
- A (first run, plain logs, usage not captured): e340e79b-8f95-46e0-a179-6586c86157d6, 2 messages, both 200.
  Requests req_011Ch72qmz... (cycle-1 401, no cost) and, this cycle, req_011Ch7q92jLU2LnZisG2WMVy,
  req_011Ch7q9AJFC7qCzagjjUED3, req_011Ch7q9KkmW1ydS8pVdgCaA (all 200).
- A2 (re-run with usage logging): 2504f3a2-9ca4-4175-824e-87ff184eb4fe. Message 1 asked about the workspace
  (2 `find` tool calls, 2 hops). Message 2 (follow-up) succeeded: the original prod failure scenario. Requests:
  req_011Ch7qBbgGzuws6STnrx7Xd, req_011Ch7qBifyDREEFsgPZMWfa (turn 1); req_011Ch7qBteFLJTcpJsxtj8BQ,
  req_011Ch7qC1i9jgzpzMjuEPzgZ (turn 2); all 200.
- B (web search): 3d8ddcb5-f8b7-4294-974f-4b59e7f4ed69, one message. Persisted transcript shows
  server_tool_use web_search, web_search_tool_result, then two more `find` hops and a final text in the same turn
  (3 loop hops after the search began). Search EXERCISED (1 search block). Requests req_011Ch7qC56nYHGg3J6fHjNGm,
  req_011Ch7qCBegXcQKpeXaNsiwy, req_011Ch7qCUZRzGwLhCjicpg2Z; all 200.

Results:
- (i) No 400 on HEL-1639's strict nested-oneOf tool schemas: PASS. Every request (7 calls this cycle, incl. the
  full tool list) returned 200; zero 4xx/5xx in the backend log.
- (ii) System prompt present on turn 2 (HEL-1718): PASS on behavior, indirect on wire. Turn 2 of A2 succeeded with
  the same cache-read prefix size as turn 1 (50186 tokens both turns), which only holds if tools+system are an
  identical prefix; the unit/seam tests prove the `system` field is sent every hop. The wire body was not captured.
- (iii) Thinking round-trip, no `Invalid signature`: PASS for the absence of any error across multi-hop turns
  (A2 turn 1: 2 hops; B: 3 hops incl. a server tool) and the cross-turn replay (A2 turn 2, persisted history
  with thinking dropped). Caveat: persisted transcripts drop thinking by design, so this check cannot
  independently show that Haiku 5.5 emitted thinking blocks on these prompts; "no Invalid signature" is
  grep-confirmed (0 matches) in the backend log.
- (iv) HEL-1638 in-turn is_error repair: NOT EXERCISED. No propose_* tool was called, so the repair loop never
  ran. The merged code paths for it are covered by the merged unit specs only.

Usage and cost (AssistantTelemetry, per converse turn summed over hops; Haiku 5.5 prices from
evidence/api-contract.md: in $0.10, cache write $0.125, cache read $0.01, out $0.50 per MTok; search $0.01):
| turn | input | cache write | cache read | output | cost |
| A2 turn 1 | 2073 | 0 | 50186 | 718 | $0.00107 |
| A2 turn 2 | 5199 | 0 | 50186 | 286 | $0.00116 |
| B turn 1 | 8155 | 7611 | 75206 | 1917 | $0.00348 + search $0.01 |
Total this cycle about $0.016 (A's first run, usage not captured, est. under $0.005). Far below the $2 cap.

Residue deleted by exact id (assistant_conversations): e340e79b-8f95-46e0-a179-6586c86157d6,
2504f3a2-9ca4-4175-824e-87ff184eb4fe, 3d8ddcb5-f8b7-4294-974f-4b59e7f4ed69 (3 rows). The cycle-1 id
4ea7df26-c9e1-46fd-91d0-4ed82451c684 was already absent. No blobs were created under ~/.helio by this check.
Servers stopped with stop-servers.sh.
