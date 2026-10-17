// HEL-1581 — splittext and extractheadings (ports of `SplitTextStep.scala` and `ExtractHeadingsStep.scala`).

import {
  StepConfigError,
  asObject,
  int as intKey,
  missingRequired,
  normalizeEnum,
  str,
  unsupportedEnum,
} from "../config";
import { javaTrim } from "../javaNumbers";
import { anyToString, cell, int, put, type Row, type Value } from "../value";
import type { StepHandler } from "./types";

const JAVA_SPACE = "[ \\t\\n\\x0B\\f\\r]";

// --- splittext ---------------------------------------------------------------------------------------

interface SplitTextConfig {
  field: string;
  mode: string;
  headingLevel: number;
  indexField: string;
}

const SPLIT_MODES = ["paragraph", "heading"];
const PARAGRAPH_BREAK = new RegExp(`\\n${JAVA_SPACE}*\\n+`);

const normalizeNewlines = (s: string): string => s.replaceAll("\r\n", "\n");

function splitParagraphs(content: string): string[] {
  return normalizeNewlines(content)
    .split(PARAGRAPH_BREAK)
    .map(javaTrim)
    .filter((s) => s !== "");
}

function splitHeadings(content: string, headingLevel: number): string[] {
  if (headingLevel < 0) throw new StepConfigError(`Illegal repetition: #{${headingLevel}}`);
  const lines = normalizeNewlines(content).split("\n");
  const heading = new RegExp(`^#{${headingLevel}}${JAVA_SPACE}+`);
  const starts: number[] = [];
  lines.forEach((line, idx) => {
    if (heading.test(line)) starts.push(idx);
  });
  return starts.map((start, i) =>
    lines.slice(start, i + 1 < starts.length ? starts[i + 1] : lines.length).join("\n"),
  );
}

export const splitTextHandler: StepHandler<SplitTextConfig> = {
  stepClass: "client",
  decode(raw) {
    const obj = asObject(raw);
    return {
      field: str(obj, "field", ""),
      mode: normalizeEnum(str(obj, "mode", "paragraph"), SPLIT_MODES),
      headingLevel: intKey(obj, "headingLevel", 1),
      indexField: str(obj, "indexField", "segmentIndex"),
    };
  },
  problems: (c) => [
    ...missingRequired("splittext", [["field", c.field]]),
    ...unsupportedEnum("splittext", "mode", c.mode, SPLIT_MODES),
  ],
  apply(rows, { field, mode, headingLevel, indexField }) {
    const split =
      mode === "heading" ? (s: string) => splitHeadings(s, headingLevel) : splitParagraphs;
    const out: Row[] = [];
    for (const row of rows) {
      const value = cell(row, field);
      if (value === null) continue;
      split(anyToString(value)).forEach((segment, idx) => {
        const next: Record<string, Value> = { ...row };
        put(next, field, segment);
        put(next, indexField, int(idx));
        out.push(next);
      });
    }
    return out;
  },
};

// --- extractheadings ---------------------------------------------------------------------------------

interface ExtractHeadingsConfig {
  field: string;
  indexField: string;
  levelField: string;
}

const HEADING_LINE = new RegExp(`^(#{1,6})${JAVA_SPACE}+([^\\n\\r\\u0085\\u2028\\u2029]*)$`);

export const extractHeadingsHandler: StepHandler<ExtractHeadingsConfig> = {
  stepClass: "client",
  decode(raw) {
    const obj = asObject(raw);
    return {
      field: str(obj, "field", ""),
      indexField: str(obj, "indexField", "headingIndex"),
      levelField: str(obj, "levelField", "headingLevel"),
    };
  },
  problems: (c) => missingRequired("extractheadings", [["field", c.field]]),
  apply(rows, { field, indexField, levelField }) {
    const out: Row[] = [];
    for (const row of rows) {
      const value = cell(row, field);
      if (value === null) continue;
      const headings: Array<[string, number]> = [];
      for (const line of normalizeNewlines(anyToString(value)).split("\n")) {
        const m = HEADING_LINE.exec(line);
        if (m) headings.push([javaTrim(m[2]), m[1].length]);
      }
      headings.forEach(([title, level], idx) => {
        const next: Record<string, Value> = { ...row };
        put(next, field, title);
        put(next, indexField, int(idx));
        put(next, levelField, int(level));
        out.push(next);
      });
    }
    return out;
  },
};
