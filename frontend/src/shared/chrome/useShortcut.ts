import { useEffect, useRef } from "react";

import { isOverlayOpen, isTypingTarget, matchesCombo, shortcuts } from "./shortcuts";

/**
 * HEL-510 design.md Decision 1 — the reviewed public surface `useShortcut` exposes. THIS SHAPE
 * IS FROZEN: three downstream tickets (HEL-516, HEL-519, HEL-503) consume it. If it proves
 * inexpressible for a future binding, STOP and escalate rather than widening it unilaterally.
 *
 * Both guard options default to preserving today's behavior, so migrating an existing binding
 * onto `useShortcut` (tasks 3.1/3.2) is a pure refactor — any behavior change is opted into
 * explicitly and visibly at the call site.
 */
export interface ShortcutOptions {
  /** Binding is inert while false. Registration still happens, so the overlay still lists it. */
  when?: boolean;
  /** Bypass the shared typing guard. `true` = always; a predicate = per-target. Default false. */
  allowWhileTyping?: boolean | ((target: EventTarget | null) => boolean);
  /** Apply the overlay-open guard (design.md Decision 4). Default false. */
  guardWhileOverlayOpen?: boolean;
}

type Handler = (event: KeyboardEvent) => void;

interface Registration {
  getHandler: () => Handler;
  getOptions: () => ShortcutOptions;
}

/**
 * HEL-510 design.md Decision 3 — exactly ONE physical `window` keydown listener exists for
 * global shortcuts after this change, owned here as a module-level singleton (not a React
 * context) so `useShortcut` works correctly even in a test that renders a consuming hook without
 * wrapping it in any provider component (e.g. `useLayoutUndoRedo.test.ts`). The listener attaches
 * lazily on the first registration and detaches when the last one unregisters.
 */
const registry = new Map<string, Registration>();
let listenerAttached = false;

function handleWindowKeyDown(event: KeyboardEvent): void {
  for (const [id, registration] of registry) {
    const declaration = shortcuts.find((s) => s.id === id);
    if (!declaration) continue;
    const options = registration.getOptions();
    if (options.when === false) continue;
    if (!matchesCombo(event, declaration.combo)) continue;

    // Real keydown events bubble from the focused element, so `event.target` and
    // `document.activeElement` normally agree. Checking both keeps this correct for a caller
    // that dispatches the event directly on `window` while focus sits on a typing target
    // elsewhere (`useLayoutUndoRedo.test.ts`'s pre-existing dispatch shape) without changing
    // behavior for the normal bubbling case.
    const allowWhileTyping = options.allowWhileTyping;
    const typingElement = isTypingTarget(event.target)
      ? event.target
      : isTypingTarget(document.activeElement)
        ? document.activeElement
        : null;
    if (typingElement) {
      const allowed =
        typeof allowWhileTyping === "function"
          ? allowWhileTyping(typingElement)
          : allowWhileTyping === true;
      if (!allowed) continue;
    }

    if (options.guardWhileOverlayOpen && isOverlayOpen()) continue;

    registration.getHandler()(event);
  }
}

function ensureListenerAttached(): void {
  if (listenerAttached) return;
  window.addEventListener("keydown", handleWindowKeyDown);
  listenerAttached = true;
}

function detachListenerIfIdle(): void {
  if (registry.size > 0) return;
  if (!listenerAttached) return;
  window.removeEventListener("keydown", handleWindowKeyDown);
  listenerAttached = false;
}

/**
 * Registers a runtime handler for the shortcut declared under `id` in `shortcuts.ts`
 * (`keyboard-shortcut-declarations` spec). Throws a descriptive dev-time error when `id` is
 * absent from the declaration — this enforces "no binding outside the declaration".
 *
 * See `ShortcutOptions` above for the frozen option contract. Do not widen this signature.
 */
export function useShortcut(id: string, handler: Handler, options: ShortcutOptions = {}): void {
  const handlerRef = useRef(handler);
  const optionsRef = useRef(options);

  useEffect(() => {
    handlerRef.current = handler;
    optionsRef.current = options;
  });

  useEffect(() => {
    if (!shortcuts.some((s) => s.id === id)) {
      throw new Error(
        `useShortcut("${id}"): no such id in shared/chrome/shortcuts.ts. ` +
          "Every global binding must be declared there before a handler can register for it " +
          "(keyboard-shortcut-declarations spec).",
      );
    }
  }, [id]);

  useEffect(() => {
    const registration: Registration = {
      getHandler: () => handlerRef.current,
      getOptions: () => optionsRef.current,
    };
    registry.set(id, registration);
    ensureListenerAttached();
    return () => {
      if (registry.get(id) === registration) registry.delete(id);
      detachListenerIfIdle();
    };
  }, [id]);
}
