import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { createCommandRegistry } from "./model/commandRegistry";
import type { CommandRegistry } from "./model/commandRegistry";

interface CommandPaletteContextValue {
  registry: CommandRegistry;
  isOpen: boolean;
  open: () => void;
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

  const value = useMemo<CommandPaletteContextValue>(
    () => ({
      registry,
      isOpen,
      open: () => setIsOpen(true),
      close: () => {
        setIsOpen(false);
        // `command-palette-shell` spec: reopening starts from a clean query.
        registry.setQuery("");
      },
    }),
    [registry, isOpen],
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
