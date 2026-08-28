import { renderHook, render, act } from "@testing-library/react";
import type { ReactNode } from "react";

import { CommandPaletteProvider } from "./CommandPaletteProvider";
import {
  useCommandActions,
  useCommandPalette,
  useCommandQuery,
  useCommandRegistryActions,
} from "./hooks";
import type { CommandAction } from "./model/types";

function wrapper({ children }: { children: ReactNode }) {
  return <CommandPaletteProvider>{children}</CommandPaletteProvider>;
}

function makeAction(id: string): CommandAction {
  return { id, title: id, run: jest.fn() };
}

describe("useCommandActions", () => {
  it("registers on mount", () => {
    const actions = [makeAction("a")];
    const { result } = renderHook(
      () => {
        useCommandActions(actions);
        return useCommandRegistryActions();
      },
      { wrapper },
    );

    expect(result.current.map((a) => a.id)).toEqual(["a"]);
  });

  it("replaces the registration when the action list identity changes", () => {
    const first = [makeAction("a")];
    const second = [makeAction("b")];

    const { result, rerender } = renderHook(
      ({ actions }: { actions: CommandAction[] }) => {
        useCommandActions(actions);
        return useCommandRegistryActions();
      },
      { wrapper, initialProps: { actions: first } },
    );

    expect(result.current.map((a) => a.id)).toEqual(["a"]);

    rerender({ actions: second });

    expect(result.current.map((a) => a.id)).toEqual(["b"]);
  });

  it("unmounting a component removes exactly its own actions", () => {
    function Harness({ mounted }: { mounted: boolean }) {
      if (mounted) {
        return <Registrant />;
      }
      return null;
    }
    function Registrant() {
      useCommandActions([makeAction("leaky")]);
      return null;
    }
    function Reader({ onActions }: { onActions: (ids: string[]) => void }) {
      const actions = useCommandRegistryActions();
      onActions(actions.map((a) => a.id));
      return null;
    }

    let seen: string[] = [];
    function Tree({ mounted }: { mounted: boolean }) {
      return (
        <CommandPaletteProvider>
          <Harness mounted={mounted} />
          <Reader
            onActions={(ids) => {
              seen = ids;
            }}
          />
        </CommandPaletteProvider>
      );
    }

    const { rerender } = render(<Tree mounted={true} />);

    expect(seen).toEqual(["leaky"]);

    rerender(<Tree mounted={false} />);

    expect(seen).toEqual([]);
  });
});

describe("useCommandQuery", () => {
  it("reflects a query set through the palette open/close lifecycle and resets on close", () => {
    const { result } = renderHook(
      () => ({ palette: useCommandPalette(), query: useCommandQuery() }),
      { wrapper },
    );

    expect(result.current.query).toBe("");

    act(() => {
      result.current.palette.open();
    });
    expect(result.current.palette.isOpen).toBe(true);

    act(() => {
      result.current.palette.close();
    });
    expect(result.current.query).toBe("");
  });
});
