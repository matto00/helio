// summarizeStepConfig — HEL-1579 (design.md D5): the one-line mono summary a spine row shows under
// its title, per op kind (e.g. filter `duration_s ≥ 180`, sort `date ↑`, compute `x = expr`).
// Pure, total, and defensive: a config missing the fields its kind normally carries (a draft, a
// legacy row) yields a shorter summary rather than throwing, and an unknown/unsupported kind falls
// back to the op's own label, so a row always has something to say.

import type {
  AggregateConfig,
  AssertConfig,
  CastConfig,
  ComputeConfig,
  DateBucketConfig,
  DedupeConfig,
  FillNullConfig,
  FilterConfig,
  JoinConfig,
  LimitConfig,
  LookupConfig,
  PivotConfig,
  RenameConfig,
  SelectConfig,
  SortConfig,
  StringOpsConfig,
  UnionConfig,
  UpsertSourceConfig,
  WindowConfig,
} from "../types/pipelineStep";
import type { Step } from "../types/step";

const OPERATOR_GLYPH: Record<string, string> = {
  ">=": "≥",
  "<=": "≤",
  "!=": "≠",
  "==": "=",
};

/** Joins at most `max` names and says how many more there are, so a 40-column select stays one line. */
function listNames(names: readonly string[] | undefined, max = 3): string {
  if (!names || names.length === 0) return "";
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} +${names.length - max}` : shown;
}

function filterSummary(c: Partial<FilterConfig>): string {
  const conditions = c.conditions ?? [];
  if (conditions.length === 0) return "";
  const word = String(c.combinator).toLowerCase() === "or" ? " or " : " and ";
  const parts = conditions.slice(0, 2).map((cond) => {
    const op = OPERATOR_GLYPH[cond.operator] ?? cond.operator;
    const value = cond.value === undefined || cond.value === null ? "" : ` ${cond.value}`;
    return `${cond.field} ${op}${value}`.trim();
  });
  const more = conditions.length > 2 ? ` +${conditions.length - 2}` : "";
  return parts.join(word) + more;
}

function pairsSummary(map: Record<string, string> | undefined, glyph: string): string {
  const entries = Object.entries(map ?? {});
  if (entries.length === 0) return "";
  const parts = entries.slice(0, 2).map(([from, to]) => `${from} ${glyph} ${to}`);
  return parts.join(", ") + (entries.length > 2 ? ` +${entries.length - 2}` : "");
}

function secondaryName(input: JoinConfig["secondaryInput"] | undefined): string {
  if (!input) return "";
  return input.kind === "source" ? "another source" : "another lane";
}

/** The summary text for one step; `""` when the config has nothing to summarise. */
function summaryFor(step: Step): string {
  const c = step.config as unknown;
  switch (step.opType.id) {
    case "filter":
      return filterSummary(c as Partial<FilterConfig>);
    case "sort": {
      const keys = (c as Partial<SortConfig>).sortBy ?? [];
      return keys.map((k) => `${k.field} ${k.direction === "desc" ? "↓" : "↑"}`).join(", ");
    }
    case "compute": {
      const cc = c as Partial<ComputeConfig>;
      return cc.column ? `${cc.column} = ${cc.expression ?? ""}`.trim() : "";
    }
    case "select":
      return listNames((c as Partial<SelectConfig>).fields);
    case "rename":
      return pairsSummary((c as Partial<RenameConfig>).renames, "→");
    case "cast":
      return pairsSummary((c as Partial<CastConfig>).casts, "as");
    case "limit": {
      const count = (c as Partial<LimitConfig>).count;
      return count === undefined ? "" : `first ${count}`;
    }
    case "aggregate": {
      const ac = c as Partial<AggregateConfig>;
      const aggs = (ac.aggregations ?? []).map((a) => `${a.fn}(${a.field})`);
      const by = (ac.groupBy ?? []).map((g) => g.name);
      const head = listNames(aggs, 2);
      return by.length > 0 ? `${head} by ${listNames(by, 2)}` : head;
    }
    case "datebucket": {
      const dc = c as Partial<DateBucketConfig>;
      return dc.field ? `${dc.field} by ${dc.granularity ?? "day"}` : "";
    }
    case "pivot": {
      const pc = c as Partial<PivotConfig>;
      return pc.column ? `${pc.agg ?? "sum"}(${pc.values ?? ""}) by ${pc.column}` : "";
    }
    case "window": {
      const wc = c as Partial<WindowConfig>;
      return wc.function ? `${wc.function} → ${wc.outputColumn ?? ""}`.trim() : "";
    }
    case "dedupe": {
      const dd = c as Partial<DedupeConfig>;
      return dd.keys && dd.keys.length > 0 ? `on ${listNames(dd.keys)}` : "all columns";
    }
    case "fillnull": {
      const fc = c as Partial<FillNullConfig>;
      return fc.columns && fc.columns.length > 0
        ? `${listNames(fc.columns)} · ${fc.strategy ?? "constant"}`
        : "";
    }
    case "stringops": {
      const sc = c as Partial<StringOpsConfig>;
      return sc.operation ? `${sc.operation} ${sc.field ?? ""}`.trim() : "";
    }
    case "join": {
      const jc = c as Partial<JoinConfig>;
      return jc.joinKey
        ? `${jc.joinType ?? "inner"} on ${jc.joinKey} with ${secondaryName(jc.secondaryInput)}`
        : "";
    }
    case "union": {
      const uc = c as Partial<UnionConfig>;
      return uc.secondaryInput ? `append ${secondaryName(uc.secondaryInput)}` : "";
    }
    case "lookup": {
      const lc = c as Partial<LookupConfig>;
      return lc.sourceKey ? `${lc.sourceKey} = ${lc.lookupKey ?? ""}`.trim() : "";
    }
    case "assert": {
      const n = (c as Partial<AssertConfig>).rules?.length ?? 0;
      return n === 0 ? "" : `${n} rule${n === 1 ? "" : "s"}`;
    }
    case "upsertsource": {
      const uc = c as Partial<UpsertSourceConfig>;
      const target =
        uc.target?.kind === "newSource" ? uc.target.name : uc.target ? "existing source" : "";
      return target ? `${uc.mode ?? "append"} → ${target}` : (uc.mode ?? "");
    }
    default:
      return "";
  }
}

/** One-line summary for the spine row; falls back to the op's label for an unknown/unsupported kind. */
export function summarizeStepConfig(step: Step): string {
  try {
    const text = summaryFor(step);
    return text.length > 0 ? text : step.opType.label;
  } catch {
    return step.opType.label;
  }
}
