// HEL-1372 -- turns the server-reported `historyPayloadLimits` into the Output editor's help
// sentence. Pure and figure-free of constants: every number comes from the response, so an
// operator's PAYLOAD_HISTORY_* override can never leave the copy stale.

import type { HistoryPayloadLimits, HistoryPayloadTierLimit } from "../../types/output";

const KIB = 1024;
const MIB = KIB * 1024;

const count = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, unit: string) => `${count(n)} ${unit}${n === 1 ? "" : "s"}`;

/** Largest whole binary unit (MiB, KiB), else grouped raw bytes. */
export function formatByteCap(bytes: number): string {
  if (bytes >= MIB && bytes % MIB === 0) return `${count(bytes / MIB)} MiB`;
  if (bytes >= KIB && bytes % KIB === 0) return `${count(bytes / KIB)} KiB`;
  return plural(bytes, "byte");
}

function tierClause(name: string, tier: HistoryPayloadTierLimit, lead: string): string {
  if (tier.maxRuns <= 0 || tier.maxAgeDays <= 0) return `${name} keeps no rows`;
  return `${name} keeps ${lead}${plural(tier.maxRuns, "run")} for ${plural(tier.maxAgeDays, "day")}`;
}

/** The cap + retention sentences; `null` when the server reported no limits (render no figures). */
export function formatHistoryPayloadLimits(
  limits: HistoryPayloadLimits | undefined,
): string | null {
  if (!limits) return null;
  const { maxRows, maxBytes, tiers } = limits;
  return (
    `A run over ${plural(maxRows, "row")} or ${formatByteCap(maxBytes)} keeps only its summary. ` +
    `${tierClause("Beta", tiers.beta, "the last ")}; ${tierClause("Owner", tiers.owner, "")}.`
  );
}
