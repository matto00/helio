import { createContext, useCallback, useContext, useEffect, useId, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";

interface OverlayContextValue {
  activeId: string | null;
  setActiveId: Dispatch<SetStateAction<string | null>>;
}

const OverlayContext = createContext<OverlayContextValue | null>(null);

interface OverlayProviderProps {
  children: ReactNode;
}

export function OverlayProvider({ children }: OverlayProviderProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveId(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <OverlayContext.Provider value={{ activeId, setActiveId }}>{children}</OverlayContext.Provider>
  );
}

const noop = () => {};

export function useOverlay(): { isActive: boolean; open: () => void; close: () => void } {
  const id = useId();
  const ctx = useContext(OverlayContext);
  const setActiveId = ctx?.setActiveId ?? noop;

  const open = useCallback(() => setActiveId(id), [setActiveId, id]);
  const close = useCallback(
    () => setActiveId((current) => (current === id ? null : current)),
    [setActiveId, id],
  );

  return { isActive: (ctx?.activeId ?? null) === id, open, close };
}
