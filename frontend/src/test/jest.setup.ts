import "@testing-library/jest-dom";

// react-router-dom (v7) uses the Node.js web APIs which jsdom doesn't polyfill.
if (typeof globalThis.TextEncoder === "undefined") {
  const { TextEncoder, TextDecoder } = require("util") as typeof import("util");
  globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
}

// Polyfill ReadableStream for tests that exercise fetch-based SSE streaming.
// jsdom does not expose the Streams API but Node.js 18+ has it in stream/web.
if (typeof globalThis.ReadableStream === "undefined") {
  const { ReadableStream: RS } = require("stream/web") as { ReadableStream: typeof ReadableStream };
  globalThis.ReadableStream = RS;
}

// jsdom never performs real layout, so `offsetWidth`/`offsetHeight` are
// always 0 (see systematic-debugging probe in HEL-301's files-modified.md).
// react-grid-layout's `useContainerWidth` (used by `PanelGrid`, unmocked in
// tests like App.test.tsx) reads `offsetWidth` on mount to decide the
// initial grid width — HEL-301 made that width load-bearing (it now gates
// whether `PanelGrid` renders the desktop grid or the phone stack), so an
// unstubbed 0 silently flips every test that doesn't explicitly mock
// react-grid-layout onto the phone path. Default to a desktop-representative
// width so tests get the desktop grid unless they explicitly mock width
// themselves (as PanelGrid.test.tsx / MobilePanelStack.test.tsx do to
// exercise the phone path) — matching the pre-HEL-301 behavior where
// `PanelGrid` always rendered the RGL grid regardless of measured width.
if (typeof HTMLElement !== "undefined") {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 1280,
  });
}

// jsdom (this project's jest-environment-jsdom version) implements no
// `PointerEvent` constructor at all — `@testing-library/dom`'s
// `fireEvent.pointer*` helpers look up `window.PointerEvent` by name to
// build the event (see `event-map.js`), so without this, `clientY` and
// friends are silently dropped and every `onPointerDown/Move/Up` handler
// under test reads `undefined` (HEL-773's drag-to-dismiss coverage —
// `MobileNavSheet.test.tsx` — was the first test in this repo to exercise
// pointer-drag gestures and hit this gap). Minimal polyfill: `MouseEvent`
// already supports `clientX`/`clientY` via its init dict natively, so this
// only needs to add the Pointer Events-specific fields real browsers carry.
// `Element.prototype.setPointerCapture`/`releasePointerCapture` (called by
// drag handlers) are ALSO unimplemented in this jsdom — stub them too.
interface PointerEventPolyfillInit {
  bubbles?: boolean;
  cancelable?: boolean;
  clientX?: number;
  clientY?: number;
  pointerId?: number;
  pointerType?: string;
  isPrimary?: boolean;
}

if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    public pointerId: number;
    public pointerType: string;
    public isPrimary: boolean;

    constructor(type: string, params: PointerEventPolyfillInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

if (typeof Element !== "undefined" && typeof Element.prototype.setPointerCapture !== "function") {
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
}

// react-grid-layout 2.2.4 replaced `useContainerWidth`'s `node.offsetWidth`
// read (stubbed above) with `getContentWidth(node)`, which prefers
// `Number.parseFloat(getComputedStyle(node).width)` and only falls back to
// `clientWidth` when that parse is non-finite (see HEL-1014's
// files-modified.md for the full probe transcript). This is a real, load
// -bearing behavior difference between jsdom and a real browser, NOT a bug
// in the library: a real browser's `getComputedStyle().width` reports the
// USED value in px (e.g. "1152px") after layout, whereas jsdom performs no
// layout and returns the SPECIFIED value verbatim. The product renders
// `.panel-list__zoom-container` with an inline percentage width
// (`PanelList.tsx`: `width: ${100 / zoomLevel}%`), so jsdom's
// `getComputedStyle` reports the literal string "100%" for it —
// `Number.parseFloat("100%")` is a FINITE 100, so `getContentWidth` returns
// 100 immediately and the `clientWidth` fallback (which the old, now-
// insufficient, stub targeted) is never reached. A measured width of 100 is
// below `panelGridConfig.breakpoints.sm` (768), so `PanelGrid` silently
// flips to the phone-only `MobilePanelStack`, which by design (HEL-301) has
// no panel-actions trigger — that's the accessible-name regression this
// stub repairs.
//
// The fix must depend on the OUTCOME (a desktop-representative width
// measurement), not on which primitive react-grid-layout happens to read
// this version — a future library bump could switch primitives again. So
// this shims `getComputedStyle` itself, narrowly: any element whose style
// already carries a resolved `px` width (i.e. a test that set one
// explicitly, or a real used-value) passes through untouched, and only an
// unresolved value (anything not ending in "px" — percentages, "auto", "")
// is reported as a desktop-width `"1280px"`, matching the existing
// `offsetWidth` stub above.
if (typeof globalThis.getComputedStyle === "function") {
  const nativeGetComputedStyle = globalThis.getComputedStyle.bind(globalThis);
  globalThis.getComputedStyle = function shimmedGetComputedStyle(
    ...args: Parameters<typeof nativeGetComputedStyle>
  ): CSSStyleDeclaration {
    const style = nativeGetComputedStyle(...args);
    if (typeof style.width === "string" && style.width.endsWith("px")) {
      return style;
    }
    return new Proxy(style, {
      get(target, prop, receiver) {
        if (prop === "width") {
          return "1280px";
        }
        if (prop === "getPropertyValue") {
          return (property: string) =>
            property === "width"
              ? "1280px"
              : Reflect.get(target, prop, receiver).call(target, property);
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  } as typeof globalThis.getComputedStyle;
}
