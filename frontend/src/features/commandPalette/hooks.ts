import { useEffect, useSyncExternalStore } from "react";

import { useCommandPaletteContext } from "./CommandPaletteProvider";
import type { CommandAction } from "./model/types";

/**
 * React entry point for contributing actions to the command palette (`command-action-registry`
 * spec). Registers `actions` on mount, disposes them on unmount, and replaces the registration
 * whenever the array's identity changes — so a contributor cannot leak actions. Memoize `actions`
 * (e.g. `useMemo`); the hook compares by identity, not deep equality, so a fresh array every
 * render churns the registration on every render.
 */
export function useCommandActions(actions: CommandAction[]): void {
  const { registry } = useCommandPaletteContext();

  useEffect(() => {
    const dispose = registry.register(actions);
    return dispose;
  }, [registry, actions]);
}

/** The palette's current query — empty while the palette is closed. Lets a query-dependent
 * contributor (resource search, recents) compute its own actions from what the user typed
 * without this contract having to change (`command-action-registry` spec). */
export function useCommandQuery(): string {
  const { registry } = useCommandPaletteContext();
  return useSyncExternalStore(registry.subscribe, registry.getQuery);
}

/** Open/close state and controls for the palette overlay. */
export function useCommandPalette(): { isOpen: boolean; open: () => void; close: () => void } {
  const { isOpen, open, close } = useCommandPaletteContext();
  return { isOpen, open, close };
}

/** Internal: read the live, unranked action list. Used by `CommandPalette` itself. */
export function useCommandRegistryActions(): CommandAction[] {
  const { registry } = useCommandPaletteContext();
  return useSyncExternalStore(registry.subscribe, registry.getActions);
}

/** Internal: the setter side of the query, used only by `CommandPalette`'s own input — every
 * other consumer should read via `useCommandQuery`. */
export function useSetCommandQuery(): (query: string) => void {
  const { registry } = useCommandPaletteContext();
  return registry.setQuery;
}
