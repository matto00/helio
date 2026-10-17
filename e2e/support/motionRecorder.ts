import type { Page } from "@playwright/test";

// HEL-1573: the in-page recorder of every animation the browser starts, plus the types the specs share.

export type Mode = "full" | "subtle" | "off" | "os-reduce";
export type Theme = "light" | "dark";

export interface MotionRecord {
  kind: "css-animation" | "css-transition" | "waapi";
  target: string;
  name: string;
  duration: number;
  /** The animation's start delay in ms (the stagger step shows up here). */
  delay: number;
  easing: string;
  props: string[];
  moves: boolean;
  /** True for a record rebuilt from computed animation-* values because the animation had already gone. */
  inferred?: boolean;
}

/** Installed before any page script: records every animation the browser starts. */
export const RECORDER = () => {
  const w = window as unknown as { __motionLog: unknown[] };
  w.__motionLog = [];
  const MOVING = ["transform", "translate", "left", "top", "width", "height"];
  const matrixOf = (value: unknown): number[] | null => {
    try {
      const text = typeof value === "string" ? value : "";
      const m = new DOMMatrix(text === "" || text === "none" ? undefined : text);
      return [m.a, m.b, m.c, m.d, m.e, m.f];
    } catch {
      return null;
    }
  };
  const identity = [1, 0, 0, 1, 0, 0];
  const differs = (a: number[] | null, b: number[] | null) =>
    a !== null && b !== null && a.some((v, i) => Math.abs(v - b[i]) > 0.01);

  const label = (el: Element | null | undefined) =>
    el === null || el === undefined
      ? "?"
      : el.className?.toString().split(/\s+/).filter(Boolean).slice(0, 2).join(".") ||
        el.tagName.toLowerCase();

  function record(kind: string, anim: Animation) {
    const effect = anim.effect as KeyframeEffect | null;
    if (!effect) return;
    const timing = effect.getComputedTiming();
    const frames = effect.getKeyframes() as Array<Record<string, unknown>>;
    const props = new Set<string>();
    for (const frame of frames) {
      for (const key of Object.keys(frame)) {
        if (!["offset", "easing", "composite", "computedOffset"].includes(key)) props.add(key);
      }
    }
    let moves = false;
    for (const prop of props) {
      if (!MOVING.includes(prop)) continue;
      const values = frames.map((f) => f[prop]);
      if (prop === "transform" || prop === "translate") {
        const mats = values.map(matrixOf);
        if (mats.length >= 2) moves ||= differs(mats[0], mats[mats.length - 1]);
        else moves ||= differs(mats[0], identity);
      } else if (values.length >= 2) {
        moves ||= String(values[0]) !== String(values[values.length - 1]);
      }
    }
    const name =
      "animationName" in anim
        ? String((anim as CSSAnimation).animationName)
        : "transitionProperty" in anim
          ? String((anim as CSSTransition).transitionProperty)
          : [...props].join("+");
    w.__motionLog.push({
      kind,
      target: label(effect.target as Element),
      name,
      duration: Number(timing.duration),
      delay: Number(timing.delay),
      easing: String(timing.easing),
      props: [...props],
      moves,
    });
  }

  document.addEventListener(
    "animationstart",
    (event) => {
      const target = event.target as Element;
      let found = false;
      for (const anim of target.getAnimations()) {
        if (anim instanceof CSSAnimation && anim.animationName === event.animationName) {
          record("css-animation", anim);
          found = true;
        }
      }
      if (found) return;
      // Under CPU load the animation can already be gone when this handler runs (its fill releases it), so fall back
      // to the computed animation-* values the element started with.
      const style = getComputedStyle(target);
      const list = (value: string) => value.split(/,\s*(?![^()]*\))/);
      const names = list(style.animationName);
      const i = names.indexOf(event.animationName);
      if (i < 0) return;
      const ms = (value: string | undefined) => {
        const v = (value ?? "0s").trim();
        return v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000;
      };
      const rise = style.getPropertyValue("--motion-rise-distance").trim();
      w.__motionLog.push({
        kind: "css-animation",
        target: label(target),
        name: event.animationName,
        duration: ms(list(style.animationDuration)[i % list(style.animationDuration).length]),
        delay: ms(list(style.animationDelay)[i % list(style.animationDelay).length]),
        easing:
          list(style.animationTimingFunction)[i % list(style.animationTimingFunction).length] ?? "",
        props: [],
        // Only the stagger rises; its displacement is the rise token.
        inferred: true,
        moves: event.animationName === "motion-enter" && rise !== "" && parseFloat(rise) !== 0,
      });
    },
    true,
  );
  document.addEventListener(
    "transitionrun",
    (event) => {
      const target = event.target as Element;
      for (const anim of target.getAnimations()) {
        if (anim instanceof CSSTransition && anim.transitionProperty === event.propertyName) {
          record("css-transition", anim);
        }
      }
    },
    true,
  );
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (this: Element, ...args: Parameters<Element["animate"]>) {
    const anim = animate.apply(this, args);
    record("waapi", anim);
    return anim;
  };

  // The first chart's zrender animation clock: one entry per unfinished <-> finished edge (C1).
  type Fiber = { stateNode?: { getEchartsInstance?: () => unknown } | null; return?: Fiber };
  type DisplayEl = { type?: string; shape?: { height?: number }; ignore?: boolean };
  type Instance = {
    getZr(): {
      animation: { isFinished(): boolean };
      storage: { getDisplayList(update?: boolean, includeIgnored?: boolean): DisplayEl[] };
    };
  };
  // Summed height of the drawn rectangles per frame: an entrance replay grows the bars from zero, an update tween does not.
  const bars: Array<{ t: number; sum: number }> = [];
  (w as unknown as { __chartBars: typeof bars }).__chartBars = bars;
  const edges: Array<{ t: number; unfinished: boolean }> = [];
  (w as unknown as { __chartEdges: typeof edges }).__chartEdges = edges;
  const find = (): Instance | null => {
    const canvas = document.querySelector(".chart-panel__canvas canvas, .panel-grid canvas");
    let host: Element | null = canvas;
    while (host) {
      const key = Object.keys(host).find((k) => k.startsWith("__reactFiber$"));
      let f: Fiber | null | undefined = key
        ? (host as unknown as Record<string, Fiber>)[key]
        : null;
      while (f) {
        if (f.stateNode && typeof f.stateNode.getEchartsInstance === "function") {
          return f.stateNode.getEchartsInstance() as Instance;
        }
        f = f.return;
      }
      host = host.parentElement;
    }
    return null;
  };
  (w as unknown as { __findChart: typeof find }).__findChart = find;
  let last: boolean | null = null;
  const tick = () => {
    const instance = find();
    if (instance) {
      const zr = instance.getZr();
      const sum = zr.storage
        .getDisplayList(false, false)
        .filter((el) => el.type === "rect" && !el.ignore)
        .reduce((total, el) => total + Math.abs(el.shape?.height ?? 0), 0);
      bars.push({ t: performance.now(), sum });
      const unfinished = !zr.animation.isFinished();
      if (unfinished !== last) {
        edges.push({ t: performance.now(), unfinished });
        last = unfinished;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

export async function log(page: Page): Promise<MotionRecord[]> {
  return page.evaluate(() => (window as unknown as { __motionLog: MotionRecord[] }).__motionLog);
}

export async function clearLog(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __motionLog: unknown[] }).__motionLog.length = 0;
  });
}
