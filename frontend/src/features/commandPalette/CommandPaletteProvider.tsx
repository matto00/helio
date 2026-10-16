import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { createCommandRegistry } from "./model/commandRegistry";
import type { CommandRegistry } from "./model/commandRegistry";

/** HEL-1575 D11: `open-tab` is the tab bar's "+" mode: dashboards only, chosen one opens as a new tab. */
export type PaletteIntent = "open-tab";

export interface PaletteOpenOptions {
  intent?: PaletteIntent;
}

interface CommandPaletteContextValue {
  registry: CommandRegistry;
  isOpen: boolean;
  /** The mode the palette was opened in; `null` is the ordinary palette. Reset on close. */
  intent: PaletteIntent | null;
  open: (options?: PaletteOpenOptions) => void;
  close: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

interface CommandPaletteProviderProps {
  children: ReactNode;
}

/** Creates one `CommandRegistry` instance for the authenticated shell and supplies open/close
 * state alongside it (design.md D3). Mount once, near the root of the authenticated tree
 * (`AppShell`) — every `useCommandActions`/`useCommandQuery`/`useCommandPalette` call below reads
 * from this single instance via context. */
export function CommandPaletteProvider({ children }: CommandPaletteProviderProps) {
  const [registry] = useState<CommandRegistry>(() => createCommandRegistry());
  const [isOpen, setIsOpen] = useState(false);
  const [intent, setIntent] = useState<PaletteIntent | null>(null);

  const value = useMemo<CommandPaletteContextValue>(
    () => ({
      registry,
      isOpen,
      intent,
      // `open` is also handed to onClick handlers, so a stray event object must read as "no options".
      open: (options?: PaletteOpenOptions) => {
        setIntent(options?.intent === "open-tab" ? "open-tab" : null);
        setIsOpen(true);
      },
      close: () => {
        setIsOpen(false);
        setIntent(null);
        // `command-palette-shell` spec: reopening starts from a clean query.
        registry.setQuery("");
      },
    }),
    [registry, isOpen, intent],
  );

  return <CommandPaletteContext.Provider value={value}>{children}</CommandPaletteContext.Provider>;
}

export function useCommandPaletteContext(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) {
    throw new Error("useCommandPaletteContext must be used within a CommandPaletteProvider");
  }
  return ctx;
}
