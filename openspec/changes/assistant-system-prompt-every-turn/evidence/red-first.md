# Red-first evidence (task 3.5)

Tests 3.1/3.2 written and run against UNFIXED main code (no main-code change yet; they compile because they assert on the serialized request JSON). Command: sbt testOnly AssistantServiceSpec AssistantConversationRoutesSpec. Output (truncated to 240 cols), exit shows 5 failures:

```
[info] - should never leak AssistantSystemPrompt.text into fullHistory's first turn for an empty-history call, while the outbound request to Claude is unaffected *** FAILED ***
[info]   "[You are Helio's dashboard/pipeline assistant. A user describes a goal in natural language; you help them get there by searching the workspace and proposing a change. You NEVER apply a change yourself — applying a proposal is a se
[info] - should send the system prompt in the system field on turn 2, identical to turn 1, never in any message (HEL-1718) *** FAILED ***
[info]   None was not equal to Some([{"cache_control":{"type":"ephemeral"},"text":"You are Helio's dashboard/pipeline assistant. A user describes a goal in natural language; you help them get there by searching the workspace and proposing a
[info] - should send the system prompt on every hop of a multi-hop turn (HEL-1718) *** FAILED ***
[info]   None was not equal to Some([{"cache_control":{"type":"ephemeral"},"text":"You are Helio's dashboard/pipeline assistant. A user describes a goal in natural language; you help them get there by searching the workspace and proposing a
[info] - should send the system prompt for a legacy conversation whose turn 1 is the plain user message (HEL-1718) *** FAILED ***
[info]   None was not equal to Some([{"cache_control":{"type":"ephemeral"},"text":"You are Helio's dashboard/pipeline assistant. A user describes a goal in natural language; you help them get there by searching the workspace and proposing a
[info] - should send the system prompt in the wire system field on the second POST and never persist it (HEL-1718) *** FAILED ***
[info]   "" did not include substring ""You are Helio's dashboard/pipeline assistant. A user describes a goal in natural language; you help them get there by searching the workspace and proposing a change. You NEVER apply a change yourself 
[info] Tests: succeeded 36, failed 5, canceled 0, ignored 0, pending 0
[info] *** 5 TESTS FAILED ***
```

The 'None was not equal to Some([...system...])' lines are the turn-2/legacy/multi-hop requests having no system field on main; the first failure is the pre-existing fold assertion, updated to the new contract (first message is the plain text).

## Cycle 2: the "no message contains the prompt" assertions are now able to fail

Fix: assertions compare against the JSON-escaped prompt (`JsString(text).compactPrint.drop(1).dropRight(1)`).
Mutation probe: with the corrected tests, I temporarily folded the prompt back into the user message in `seedHistory`
(`Text(AssistantSystemPrompt.text + "\n\n" + message)`) while leaving `system` being sent, so every `systemOf` assertion
still passed and execution reached the message checks. Result: `Tests: succeeded 19, failed 4` -- the turn-2 test
("... never in any message") and the legacy test FAILED (plus the two fold-regression tests). The mutation was reverted.
