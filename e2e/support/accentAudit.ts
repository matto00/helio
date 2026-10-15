import type { Page } from "@playwright/test";

// HEL-1579 (design.md D11): a mechanical accent audit for the desktop pipeline page, a measurement aid for
// the skeptic's visual check, not a substitute for it. With a vivid user accent set, it walks every
// rendered element under `.pipeline-detail-page` and reads the colour-bearing computed properties
// (`color`, backgrounds and gradients, the four border colours, `outline-color`, `box-shadow`,
// `accent-color`, `text-decoration-color`, SVG `fill`/`stroke`). A colour counts as the
// accent when it is visibly saturated, has non-trivial alpha and sits within a few degrees of the accent's
// hue (this catches the token itself and every `color-mix` of it, which serialise as unrelated rgb
// strings). Only three things may carry it: the Run button, the selected step row (wash and number) and
// the focused element's ring.

export interface AccentHit {
  selector: string;
  property: string;
  value: string;
}

export async function auditAccent(page: Page, accentHex: string): Promise<AccentHit[]> {
  return page.evaluate((hex) => {
    const parse = (s: string): [number, number, number, number][] => {
      const out: [number, number, number, number][] = [];
      const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/g;
      for (const m of s.matchAll(rgb)) {
        const a =
          m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        out.push([+m[1], +m[2], +m[3], a]);
      }
      const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/g;
      for (const m of s.matchAll(srgb)) {
        const a =
          m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        out.push([+m[1] * 255, +m[2] * 255, +m[3] * 255, a]);
      }
      return out;
    };
    const hsl = (r: number, g: number, b: number): [number, number] => {
      const rr = r / 255,
        gg = g / 255,
        bb = b / 255;
      const max = Math.max(rr, gg, bb),
        min = Math.min(rr, gg, bb);
      const l = (max + min) / 2;
      const d = max - min;
      if (d === 0) return [0, 0];
      const s = d / (1 - Math.abs(2 * l - 1));
      let h = 0;
      if (max === rr) h = ((gg - bb) / d) % 6;
      else if (max === gg) h = (bb - rr) / d + 2;
      else h = (rr - gg) / d + 4;
      return [(h * 60 + 360) % 360, s];
    };
    const hexToRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [ar, ag, ab] = hexToRgb(hex);
    const [accentHue] = hsl(ar, ag, ab);
    const isAccent = (value: string): boolean =>
      parse(value).some(([r, g, b, a]) => {
        if (a < 0.03) return false;
        const [h, s] = hsl(r, g, b);
        if (s < 0.25) return false;
        const diff = Math.min(Math.abs(h - accentHue), 360 - Math.abs(h - accentHue));
        return diff < 12;
      });

    const root = document.querySelector(".pipeline-detail-page");
    if (!root) return [{ selector: "(no .pipeline-detail-page)", property: "-", value: "-" }];
    const describe = (el: Element): string => {
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur !== root && parts.length < 4) {
        const cls = (cur.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)[0];
        const label = cur.getAttribute("aria-label");
        parts.unshift(
          `${cur.tagName.toLowerCase()}${cls ? "." + cls : ""}${label ? `[aria-label="${label}"]` : ""}`,
        );
        cur = cur.parentElement;
      }
      return parts.join(" > ");
    };
    const allowedRun = (el: Element) => !!el.closest(".spine-header__btn--primary");
    const allowedSelected = (el: Element) => !!el.closest(".spine-row--selected");
    const focused = document.activeElement;

    const hits: { selector: string; property: string; value: string }[] = [];
    const props: [string, (cs: CSSStyleDeclaration) => string | null][] = [
      ["color", (cs) => cs.color],
      ["background-color", (cs) => cs.backgroundColor],
      ["background-image", (cs) => cs.backgroundImage],
      [
        "border-top-color",
        (cs) =>
          cs.borderTopStyle !== "none" && parseFloat(cs.borderTopWidth) > 0
            ? cs.borderTopColor
            : null,
      ],
      [
        "border-right-color",
        (cs) =>
          cs.borderRightStyle !== "none" && parseFloat(cs.borderRightWidth) > 0
            ? cs.borderRightColor
            : null,
      ],
      [
        "border-bottom-color",
        (cs) =>
          cs.borderBottomStyle !== "none" && parseFloat(cs.borderBottomWidth) > 0
            ? cs.borderBottomColor
            : null,
      ],
      [
        "border-left-color",
        (cs) =>
          cs.borderLeftStyle !== "none" && parseFloat(cs.borderLeftWidth) > 0
            ? cs.borderLeftColor
            : null,
      ],
      [
        "outline-color",
        (cs) =>
          cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 ? cs.outlineColor : null,
      ],
      ["box-shadow", (cs) => (cs.boxShadow !== "none" ? cs.boxShadow : null)],
      [
        "text-decoration-color",
        (cs) => (cs.textDecorationLine !== "none" ? cs.textDecorationColor : null),
      ],
      ["fill", (cs) => cs.fill],
      ["stroke", (cs) => cs.stroke],
    ];
    for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (rect.width === 0 && rect.height === 0) continue;
      const isFocused = el === focused;
      for (const [name, read] of props) {
        const value = read(cs);
        if (value === null || !isAccent(value)) continue;
        if (allowedRun(el) || allowedSelected(el)) continue;
        if (isFocused && (name === "outline-color" || name === "box-shadow")) continue;
        // Native form controls take the accent through `accent-color`; it is audited like any colour.
        hits.push({ selector: describe(el), property: name, value });
      }
      // `accent-color` is `auto` unless set; only an explicit accent-hued value counts.
      const ac = cs.getPropertyValue("accent-color");
      if (ac && ac !== "auto" && isAccent(ac) && !allowedRun(el) && !allowedSelected(el)) {
        hits.push({ selector: describe(el), property: "accent-color", value: ac });
      }
    }
    return hits;
  }, accentHex);
}
