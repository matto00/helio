import type { ClaudeToolMessageDto, ClaudeToolResultBlockDto } from "./types";

export type AssistantProposalKind = "dashboard" | "pipeline" | "combined" | "patch";

const KIND_BY_TOOL_NAME: Record<string, AssistantProposalKind> = {
  propose_dashboard: "dashboard",
  propose_pipeline: "pipeline",
  propose_combined: "combined",
  propose_patch_set: "patch",
};

export interface AssistantProposalExtraction {
  kind: AssistantProposalKind;
  /** The originating `tool_use` block's `input` — the exact arguments Claude sent for the
   *  `propose_*` call, already a parsed value (not a JSON string; `AssistantConversationRepository`
   *  puts `ToolUse.input` on the wire as an embedded JSON value, never a string).
   *
   *  Deliberately sourced from `tool_use.input`, NOT the paired `tool_result.content` design.md D4
   *  originally described: `AssistantToolExecutor.executeProposePatchSet` (backend) returns the
   *  *preview* (`PatchSetPreviewResponse`, shape `{edits: EditPreview[]}`) as the tool result body,
   *  not the original `PatchSet` (`{summary?, edits: Edit[]}`) — confirmed by reading
   *  `AssistantToolExecutor.scala` and `PatchSetPreviewProtocol.scala` directly. Parsing the
   *  `tool_result` as a `PatchSet` for `kind === "patch"` would silently produce an object whose
   *  `edits` entries lack `target`/`op`/`patch`, breaking `PatchSetReviewPage`. `tool_use.input` is
   *  what the executor actually decodes AS the propose_* tool's declared shape before validating —
   *  reliable for every kind (the other three tools' results happen to mirror their input via
   *  `.toJson`, so behavior for `dashboard`/`pipeline`/`combined` is unchanged; sourcing uniformly
   *  from `input` avoids the `patch`-only asymmetry rather than special-casing it). */
  input: unknown;
}

/** Pure function: scans a transcript (in order) for the LATEST successful `propose_*` tool call —
 *  no I/O (design.md D4). "Latest" rather than "first": a multi-turn conversation may propose, be
 *  asked to revise, and propose again, and the most recent successful attempt is the one that
 *  reflects the user's current intent. Returns `null` when no successful `propose_*` call exists
 *  yet, or when the paired `tool_result` is missing or `isError: true`. */
export function extractProposal(
  transcript: ClaudeToolMessageDto[],
): AssistantProposalExtraction | null {
  const resultsByToolUseId = new Map<string, ClaudeToolResultBlockDto>();
  for (const turn of transcript) {
    for (const block of turn.content) {
      if (block.blockType === "tool_result") {
        resultsByToolUseId.set(block.toolUseId, block);
      }
    }
  }

  let latest: AssistantProposalExtraction | null = null;
  for (const turn of transcript) {
    for (const block of turn.content) {
      if (block.blockType !== "tool_use") continue;
      const kind = KIND_BY_TOOL_NAME[block.name];
      if (kind === undefined) continue;
      const result = resultsByToolUseId.get(block.id);
      if (result === undefined || result.isError) continue;
      latest = { kind, input: block.input };
    }
  }
  return latest;
}
