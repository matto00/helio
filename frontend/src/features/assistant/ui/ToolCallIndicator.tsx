import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faChevronRight,
  faCircleExclamation,
  faWrench,
} from "@fortawesome/free-solid-svg-icons";

import "./ToolCallIndicator.css";
import type { ClaudeToolResultBlockDto, ClaudeToolUseBlockDto } from "../types";

interface ToolCallIndicatorProps {
  toolUse: ClaudeToolUseBlockDto;
  /** The paired `tool_result` (matched by `toolUseId`), or `null` when no matching result exists
   *  anywhere in the persisted transcript (HEL-667 design.md D5) — since `POST /:id/converse` is
   *  buffered (not streamed), the transcript is never rendered mid-flight, so `null` always means
   *  this `tool_use` was CUT SHORT (the hop-cap-exhausted case: Claude requested a tool call the
   *  loop never executed), never "still in progress". Rendered with a distinct "cut short"
   *  treatment, not the same appearance a genuinely pending call would use. */
  result: ClaudeToolResultBlockDto | null;
}

const VERB_BY_TOOL_NAME: Record<string, string> = {
  find: "Searching",
  get_resource: "Looking up",
  propose_dashboard: "Proposing",
  propose_pipeline: "Proposing",
  propose_combined: "Proposing",
  propose_patch_set: "Proposing",
};

function verbFor(toolName: string): string {
  return VERB_BY_TOOL_NAME[toolName] ?? "Calling";
}

/** Renders a `tool_use` block's input as `key: value, key: value` — a compact, single-line view,
 *  never the full raw JSON (design.md D2). */
function compactInput(input: unknown): string {
  if (input === null || typeof input !== "object") {
    return input === undefined ? "" : JSON.stringify(input);
  }
  return Object.entries(input as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ");
}

/** A short, human-readable summary of a tool result — never the raw JSON dumped inline (design.md
 *  D2 / spec "never raw JSON dumped inline"). Array results (e.g. `find`'s search hits) summarize
 *  as a count; anything else falls back to a truncated snippet of the raw content. */
function summarizeResult(result: ClaudeToolResultBlockDto): string {
  if (result.isError) return "Failed";
  try {
    const parsed: unknown = JSON.parse(result.content);
    if (Array.isArray(parsed)) {
      return `Found ${parsed.length} result${parsed.length === 1 ? "" : "s"}`;
    }
  } catch {
    // Not JSON — fall through to the truncated-text summary below.
  }
  return result.content.length > 80 ? `${result.content.slice(0, 80)}…` : result.content;
}

/** One progress-indicator row per `tool_use` block, with its paired `tool_result` folded in as a
 *  collapsed disclosure (design.md D2) — replaces the old drawer's single global spinner with a
 *  distinct row per hop. */
export function ToolCallIndicator({ toolUse, result }: ToolCallIndicatorProps) {
  const [expanded, setExpanded] = useState(false);
  const isError = result?.isError ?? false;
  const isCutShort = result === null;

  const modifierClass = isError
    ? " tool-call-indicator--error"
    : isCutShort
      ? " tool-call-indicator--cut-short"
      : "";

  return (
    <div className={`tool-call-indicator${modifierClass}`}>
      <div className="tool-call-indicator__row">
        <FontAwesomeIcon
          icon={isError || isCutShort ? faCircleExclamation : faWrench}
          className="tool-call-indicator__icon"
          aria-hidden="true"
        />
        <span className="tool-call-indicator__label">
          {verbFor(toolUse.name)}: {toolUse.name}({compactInput(toolUse.input)})
        </span>
      </div>
      {isCutShort && (
        <span className="tool-call-indicator__cut-short-note">
          Cut short — ran out of tool-call budget before this finished
        </span>
      )}
      {result && (
        <button
          type="button"
          className="tool-call-indicator__toggle"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          <FontAwesomeIcon icon={expanded ? faChevronDown : faChevronRight} aria-hidden="true" />
          {summarizeResult(result)}
        </button>
      )}
      {result && expanded && <pre className="tool-call-indicator__detail">{result.content}</pre>}
    </div>
  );
}
