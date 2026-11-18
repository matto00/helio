# files modified (HEL-1759)

- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.css` — HEL-1759
- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.test.tsx` — HEL-1759
- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.tsx` — HEL-1759
- `frontend/src/hooks/usePortalPopover.test.tsx` — HEL-1759
- `frontend/src/hooks/usePortalPopover.ts` — HEL-1759
- `e2e/hel1759-popover-keyboard-focus.spec.ts` — HEL-1759

## Exact diff of shared file frontend/src/hooks/usePortalPopover.ts (C16, for HEL-1744)
```diff
diff --git a/frontend/src/hooks/usePortalPopover.ts b/frontend/src/hooks/usePortalPopover.ts
index e07327e59..a5e2a2f03 100644
--- a/frontend/src/hooks/usePortalPopover.ts
+++ b/frontend/src/hooks/usePortalPopover.ts
@@ -51,7 +51,9 @@ export type PortalPopoverPlace = (panel: HTMLElement, triggerRect: DOMRect) => P
  * popover with focusable content inside its panel would otherwise close the
  * instant focus moved from the trigger into that content. See
  * `ActionsMenu.tsx` / `Select.tsx` for the wired usage (HEL a11y sweep
- * F-007 / F-048).
+ * F-007 / F-048). When that focus-out starts INSIDE the panel and was caused by a
+ * keyboard Tab / Shift+Tab, real focus also returns to the trigger (HEL-1759);
+ * a pointer move, or focus leaving from the trigger itself, only closes.
  */
 export function usePortalPopover<T extends HTMLElement = HTMLButtonElement>(options?: {
   /** Opts into measured placement: the panel renders `visibility: hidden` (`placed` false) until the first placement,
@@ -66,6 +68,9 @@ export function usePortalPopover<T extends HTMLElement = HTMLButtonElement>(opti
   const panelRef = useRef<HTMLElement | null>(null);
   const [isOpen, setIsOpen] = useState(false);
   const [panelPos, setPanelPos] = useState<PortalPopoverPos | null>(null);
+  /** True from a Tab keydown until the focus move it causes (cleared by any other key, a pointerdown, each focusout and on
+   *  close), so only a keyboard Tab out of the panel returns focus to the trigger (HEL-1759). */
+  const tabbingRef = useRef(false);
   /** Guards the viewport clamp below against re-measuring its own output. */
   const hasClampedRef = useRef(false);
 
@@ -86,12 +91,39 @@ export function usePortalPopover<T extends HTMLElement = HTMLButtonElement>(opti
     return () => document.removeEventListener("keydown", onKeyDown);
   }, [isOpen]);
 
+  // Track a keyboard Tab (HEL-1759). Capture phase, so a descendant or ancestor that stops propagation cannot hide it.
+  useEffect(() => {
+    if (!isOpen) return;
+    let expire: ReturnType<typeof setTimeout> | undefined;
+    function onKeyDown(event: KeyboardEvent) {
+      clearTimeout(expire);
+      tabbingRef.current = event.key === "Tab";
+      // Tab's focus move is the keydown's default action, which runs in the same task as the dispatch, before any timer;
+      // so a flag still set after one timer tick belongs to a Tab that moved no focus (cancelled, or at the document end).
+      // (A microtask would be too early: it runs between the listeners and that default action.)
+      if (tabbingRef.current) expire = setTimeout(() => (tabbingRef.current = false), 0);
+    }
+    function onPointerDown() {
+      tabbingRef.current = false;
+    }
+    document.addEventListener("keydown", onKeyDown, true);
+    document.addEventListener("pointerdown", onPointerDown, true);
+    return () => {
+      document.removeEventListener("keydown", onKeyDown, true);
+      document.removeEventListener("pointerdown", onPointerDown, true);
+      clearTimeout(expire);
+      tabbingRef.current = false;
+    };
+  }, [isOpen]);
+
   // Close when focus leaves the popover entirely (trigger + panel) — e.g. Tab
   // past the last focusable element inside a portalled panel. Only engages
   // once `panelRef` is actually attached to something (see doc comment above).
   useEffect(() => {
     if (!isOpen) return;
     function onFocusOut(event: FocusEvent) {
+      const viaTab = tabbingRef.current;
+      tabbingRef.current = false;
       if (!panelRef.current) return;
       const next = event.relatedTarget as Node | null;
       // `relatedTarget` is null when focus leaves the document/window
@@ -101,6 +133,14 @@ export function usePortalPopover<T extends HTMLElement = HTMLButtonElement>(opti
       const withinPanel = panelRef.current.contains(next);
       if (!withinTrigger && !withinPanel) {
         setIsOpen(false);
+        // A Tab / Shift+Tab out of the panel returns focus to the trigger, the user's last known place, instead of
+        // leaving it on whatever the portalled panel's DOM neighbour is (HEL-1759). Not for focus leaving the trigger
+        // itself (a virtual-focus combobox) or a pointer move.
+        if (viaTab && panelRef.current.contains(event.target as Node)) {
+          // Deferred a microtask: the browser (and jsdom) is mid focus move inside `focusout`, and a synchronous focus()
+          // there is not guaranteed to outlast the move it interrupts.
+          queueMicrotask(() => triggerRef.current?.focus());
+        }
       }
     }
     document.addEventListener("focusout", onFocusOut);
```

## Notes
- D1 probe: in Chromium a synchronous trigger.focus() inside focusout DID stick (probe-sync run, 10/12 green, editor-save case red for the separate reason); jsdom does not honor it, so the focus is deferred with queueMicrotask, re-verified in the real browser (12/12 green).
- Tab tracking is capture-phase (robust to stopPropagation); ProvenancePopover traps Tab itself so the change is inert there. panelRef consumers: ActionsMenu, Select, ProvenanceTrigger/Popover, DashboardAppearanceEditor, OutputSchemaDisclosure.
- D4: all 22 hel1756 email labels match PLAIN_EMAIL_LOCAL; no edit.
- Phone: the appearance editor trigger is rendered but hidden at 768 and 390 (spec asserts 0 visible); phone covers the actions menu inside the step sheet dialog.

- Cycle 2: the Tab flag expires via setTimeout(0), not a microtask (a microtask runs before the keydown's default focus move and would clear the flag too early); real-browser Shift+Tab cases still pass. Task 5.4 now cites the evaluator's screenshots; phone editor cases are skipped with a stated reason plus one hidden-trigger assertion.
