import type { ClaudeContentBlockDto, ClaudeToolMessageDto } from "./types";

/** HEL-1755: which visible assistant text block closes each ANSWER GROUP, and the model that answered it.
 *
 *  An answer group is everything the assistant produced for one user message: its text turns, its `tool_use` turns
 *  and the synthetic user turns carrying only `tool_result` blocks, up to the next user turn that carries a real
 *  (non-`tool_result`) block. The muted model label renders once per group, under its LAST visible text block, using
 *  the `model` the server stamped on the last assistant turn that has one (turns saved before the picker existed carry
 *  none, so such a group gets no label). Keys are `${turnIndex}-${blockIndex}`, the transcript renderer's own. */
export function answerGroupModels(
  transcript: ClaudeToolMessageDto[],
  isVisibleText: (block: ClaudeContentBlockDto) => boolean,
): Map<string, string> {
  const labelled = new Map<string, string>();
  let lastTextKey: string | null = null;
  let model: string | undefined;

  const flush = () => {
    if (lastTextKey !== null && model !== undefined) labelled.set(lastTextKey, model);
    lastTextKey = null;
    model = undefined;
  };

  transcript.forEach((turn, turnIndex) => {
    const startsNewGroup =
      turn.role === "user" && turn.content.some((block) => block.blockType !== "tool_result");
    if (startsNewGroup) flush();
    if (turn.role === "user") return;
    if (turn.model !== undefined) model = turn.model;
    turn.content.forEach((block, blockIndex) => {
      if (block.blockType === "text" && isVisibleText(block))
        lastTextKey = `${turnIndex}-${blockIndex}`;
    });
  });
  flush();
  return labelled;
}
