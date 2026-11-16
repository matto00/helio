# HEL-1718: Assistant drops its system prompt on every message after the first

## Description

Every assistant conversation sends the system prompt only on its first message. Messages 2 onward reach Claude
with no system prompt at all.

How it happens:

* `AssistantService.seedHistory` puts `AssistantSystemPrompt.text` into the first user turn only when `history`
  is empty.
* `desanitizeFirstTurn` then rewrites that first turn back to the plain user message before it is returned and
  persisted.
* On the next `converse`, `history` is not empty, so the prompt is not added again. The persisted turn 1 no
  longer contains it either.

The frontend creates the conversation with no `firstMessage` (`MessageComposer.tsx`), so turn 1 is the only turn
that ever gets the prompt.

Effects:

* From the second message on, the assistant loses its tool-use guidance, its worked examples and its rules.
* On models that bind thinking signatures to an append-only prefix (`claude-haiku-5-5`), the request prefix
  changes between turn 1 and turn 2. HEL-1636 works around this by dropping thinking blocks from persisted
  history. If they are ever kept, this mismatch causes a 400 (`Invalid signature in thinking block`).

## Acceptance criteria

- [ ] Every `converse` request carries the system prompt, on every turn, in a position that does not change
  between turns. The best option is the API's own `system` field, which also keeps the prompt-cache prefix stable.
- [ ] The persisted transcript and what the UI renders still never show the system prompt.
- [ ] A test proves a turn-2 request contains the system prompt. It must fail on current main.

## Origin

origin_kind: followup, origin_ticket: HEL-1636. Labels: Follow-up, Bug. Related: HEL-1636, HEL-1639.

## Driver constraints for this run

- The local ANTHROPIC_API_KEY is expired: no live Anthropic calls. Prove the AC with wire-level and seam tests.
- HEL-1636 (parked, local branch `bug/assistant-thinking-block-roundtrip/HEL-1636`, unpushed) will re-merge main
  after this lands; shape the diff to minimise its conflict (see design.md "Merge recipe for HEL-1636"). Never
  check out, modify or push that branch.
