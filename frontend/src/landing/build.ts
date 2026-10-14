import { PANEL_RECTS, placeOverPanel } from "./rectStyle";

/** The pinned build section: one screen of scroll per step; the current step expands and lights the panels it made. */
export function initBuild(): void {
  const build = document.getElementById("build") as HTMLElement;
  const frame2 = document.getElementById("frame2") as HTMLElement;
  const steps = Array.from(build.querySelectorAll<HTMLElement>(".step"));
  const wide = window.matchMedia("(min-width: 1101px)");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let currentStep = -1;

  const veils = PANEL_RECTS.map((rect) => {
    const v = document.createElement("div");
    v.className = "veil";
    placeOverPanel(v, rect);
    frame2.appendChild(v);
    return v;
  });

  function light(i: number) {
    const lit = i < 0 ? [0, 1, 2, 3] : (steps[i].dataset.panels ?? "").split(",").map(Number);
    veils.forEach((v, k) => v.classList.toggle("on", !lit.includes(k)));
    steps.forEach((s, j) => s.classList.toggle("on", j === i));
  }
  const stepSegment = () => (build.offsetHeight - window.innerHeight) / steps.length;

  function onScroll() {
    if (!wide.matches || reduce.matches) {
      build.classList.remove("is-live");
      if (currentStep !== -1) {
        currentStep = -1;
        light(-1);
      }
      return;
    }
    build.classList.add("is-live");
    const y = window.scrollY - build.offsetTop;
    const i = Math.max(0, Math.min(steps.length - 1, Math.floor(y / stepSegment())));
    if (i !== currentStep) {
      currentStep = i;
      light(i);
    }
  }
  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          ticking = false;
          onScroll();
        });
      }
    },
    { passive: true },
  );
  window.addEventListener("resize", onScroll);
  onScroll();
}
