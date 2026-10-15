import type { Locator } from "@playwright/test";

// The app loads its web fonts (Schibsted Grotesk, JetBrains Mono) from a NON-BLOCKING Google Fonts stylesheet
// (frontend/app.html: `media="print"`, flipped to `all` in `onload`). Rows paint in the fallback face, then re-flow
// (a row is ~2px shorter) when the web face is applied, ~100-250ms after first paint. A layout-sensitive spec must
// not compute a pointer position, or assert a pixel measurement that depends on text metrics, before that swap has
// happened (HEL-1606, HEL-1613).
//
// Why not `document.fonts.status === "loaded"` / `document.fonts.ready`: both are VACUOUSLY true until the
// stylesheet has applied (no web FontFace exists yet) and, even after it applied, until layout has started the
// face request for the text actually on screen.

const FONT_WAIT_MS = 10_000;
const POLL_MS = 50;

interface FontState {
  settled: boolean;
  stylesheetMedia: string | null;
  status: string;
  loadingFaces: string[];
  scopeFamilies: { family: string; states: string[] }[];
}

/** Settled when, for the scope of `target`: the live Google Fonts stylesheet is applied, no web face is loading
 *  (page-wide), and every web family the scope's text is set in has a face that finished (loaded, or errored and so
 *  never swaps). The scope is the table row holding `target` (the row-gesture callers pass a button inside a `<tr>`),
 *  else `target` itself: pass the narrowest container you are about to measure (a card, a dialog), not `body`.
 *  Faces left `unloaded` are fine: the stylesheet defines ~34 unicode-range subsets and only the ones some rendered
 *  text needs are ever fetched. Bounded and loud: on timeout it throws naming the last observed state.
 *
 *  Call it before EACH measurement step whose measured container holds newly rendered text, once that text is visible
 *  (a face is only requested once text in it is laid out, so text rendered later, such as a dialog opened or a row
 *  created after an earlier wait, can need a face that wait never saw; fonts also reload per document). Never call it
 *  inside the retry or poll of an assertion. It never reads labels.
 *  Polled from Node on real time, so it makes progress under an installed fake clock (`page.clock`). */
export async function waitForWebFonts(target: Locator): Promise<void> {
  const deadline = Date.now() + FONT_WAIT_MS;
  let state = await target.evaluate(readFontState);
  while (!state.settled) {
    if (Date.now() > deadline) {
      throw new Error(
        `waitForWebFonts: web fonts did not settle within ${FONT_WAIT_MS}ms for the measured scope: ${JSON.stringify(state)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    state = await target.evaluate(readFontState);
  }
}

// Runs in the page (Playwright serializes it), so it is free of closures.
function readFontState(button: Element): FontState {
  // The live element, not the <noscript> copy (inert text while JS runs).
  const link = document.querySelector<HTMLLinkElement>(
    'link[rel="stylesheet"][href*="fonts.googleapis.com/css2"]',
  );
  const scope = button.closest("tr") ?? button;
  // Reading a rect and computed styles forces the style recalc + layout that registers the faces and starts the
  // requests for the text on screen, so the checks below cannot run in the gap before those requests begin.
  const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");
  const firstFamilies = new Set<string>();
  scope.getBoundingClientRect();
  for (const el of [scope, ...scope.querySelectorAll<HTMLElement>("*")]) {
    const hasText = [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
    );
    const first = hasText ? getComputedStyle(el).fontFamily.split(",")[0] : undefined;
    if (first) firstFamilies.add(unquote(first));
  }
  const faces = [...document.fonts];
  // A family with no registered face is a system font: nothing to wait for.
  const scopeFamilies = [...firstFamilies]
    .map((family) => ({
      family,
      states: faces.filter((f) => unquote(f.family) === family).map((f) => f.status),
    }))
    .filter((entry) => entry.states.length > 0);
  const loadingFaces = faces.filter((f) => f.status === "loading").map((f) => f.family);
  const settled =
    link !== null &&
    link.media === "all" &&
    loadingFaces.length === 0 &&
    document.fonts.status === "loaded" &&
    scopeFamilies.every((e) => e.states.some((s) => s === "loaded" || s === "error"));
  return {
    settled,
    stylesheetMedia: link?.media ?? null,
    status: document.fonts.status,
    loadingFaces,
    scopeFamilies,
  };
}
