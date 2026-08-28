import { IS_DEV } from "../../../config/env";
import type { CommandAction } from "./types";

/**
 * Command palette action registry (HEL-496, `command-action-registry` spec).
 *
 * A plain, framework-free observable store — deliberately not React state (design.md D3), so it
 * can be registered into from non-component code, is unit-testable without any rendering, and a
 * registration made while the palette is open re-renders it immediately via `subscribe`.
 *
 * Usage — imperative:
 * ```ts
 * const dispose = commandRegistry.register([{ id: "my-feature.do-thing", title: "Do thing", run() {} }]);
 * // later, when the feature no longer wants its actions listed:
 * dispose();
 * ```
 *
 * Usage — from a React component, prefer `useCommandActions` (registers on mount, disposes on
 * unmount, replaces on identity change) over calling `register`/the disposer directly:
 * ```ts
 * useCommandActions([{ id: "my-feature.do-thing", title: "Do thing", run() {} }]);
 * ```
 *
 * One registry instance is created per `CommandPaletteProvider` and shared via context — see
 * that module rather than importing this one directly from feature code.
 */
export interface CommandRegistry {
  /** Registers `actions`, returning a disposer that removes precisely these actions (and only
   * these) when called. Idempotent: calling the disposer more than once is a no-op. A duplicate
   * id is `console.warn`ed in development and the later registration is dropped — the palette
   * stays usable and the first registrant keeps its action. */
  register(actions: CommandAction[]): () => void;
  getActions(): CommandAction[];
  setQuery(query: string): void;
  getQuery(): string;
  /** Registers `listener` to be called after any change to actions or query. Returns an
   * unsubscribe function — the shape `useSyncExternalStore` expects. */
  subscribe(listener: () => void): () => void;
}

export function createCommandRegistry(): CommandRegistry {
  let actionsById = new Map<string, CommandAction>();
  // Cached snapshot array — `useSyncExternalStore` requires `getSnapshot` to return a referentially
  // stable value when nothing has changed (React logs "should be cached" and loops otherwise).
  // Recomputed only inside `notify()`, right after `actionsById` actually changes.
  let actionsSnapshot: CommandAction[] = [];
  let query = "";
  const listeners = new Set<() => void>();

  function notify() {
    for (const listener of listeners) listener();
  }

  function refreshActionsSnapshot() {
    actionsSnapshot = Array.from(actionsById.values());
  }

  return {
    register(actions) {
      const registeredIds: string[] = [];
      const next = new Map(actionsById);
      for (const action of actions) {
        if (next.has(action.id)) {
          if (IS_DEV) {
            console.warn(
              `command-palette: duplicate action id "${action.id}" — keeping the first registrant, dropping this one.`,
            );
          }
          continue;
        }
        next.set(action.id, action);
        registeredIds.push(action.id);
      }
      actionsById = next;
      refreshActionsSnapshot();
      notify();

      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        const afterDispose = new Map(actionsById);
        for (const id of registeredIds) afterDispose.delete(id);
        actionsById = afterDispose;
        refreshActionsSnapshot();
        notify();
      };
    },
    getActions() {
      return actionsSnapshot;
    },
    setQuery(nextQuery) {
      if (query === nextQuery) return;
      query = nextQuery;
      notify();
    },
    getQuery() {
      return query;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
