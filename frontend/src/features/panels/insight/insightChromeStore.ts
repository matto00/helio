import { useSyncExternalStore } from "react";

import { registerSessionReset } from "../../../shared/session/sessionReset";

/** HEL-1744 D7 -- what the insight panel body tells the panel chrome (the card footer's "Updated" time and the refresh
 *  action), keyed by Output id. The chrome renders before the Output's kind is known and never reads the insight itself, so
 *  the body publishes here while it is mounted. Several bodies can be mounted for one Output (grid card and fullscreen);
 *  each registers under its own token and only its own unregistration removes its entry. */
export interface InsightChrome {
  /** When the stored render was made, or `null` for no render (the footer then shows no updated time). */
  renderedAt: string | null;
  /** Re-reads the insight (the chrome's refresh action; never asks the server to render). */
  refetch: () => void;
}

interface Registered extends InsightChrome {
  owner: symbol;
}

const entries = new Map<string, Registered>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setInsightChrome(outputId: string, owner: symbol, chrome: InsightChrome): void {
  const current = entries.get(outputId);
  if (
    current &&
    current.owner === owner &&
    current.renderedAt === chrome.renderedAt &&
    current.refetch === chrome.refetch
  ) {
    return;
  }
  entries.set(outputId, { ...chrome, owner });
  emit();
}

export function clearInsightChrome(outputId: string, owner: symbol): void {
  if (entries.get(outputId)?.owner !== owner) return;
  entries.delete(outputId);
  emit();
}

export function getInsightChrome(outputId: string): InsightChrome | null {
  return entries.get(outputId) ?? null;
}

export function resetInsightChrome(): void {
  entries.clear();
  emit();
}

registerSessionReset("insightChromeStore", {
  covers: ["features/panels/insight/insightChromeStore.ts#entries"],
  reset: resetInsightChrome,
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The chrome of the insight panel mounted for `outputId`, or `null` (not an insight, or not mounted yet). */
export function useInsightChrome(outputId: string | null): InsightChrome | null {
  return useSyncExternalStore(subscribe, () => (outputId ? getInsightChrome(outputId) : null));
}
