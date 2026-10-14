import { CASES, DEFAULT_NOTE } from "./cases";
import { PANEL_RECTS, panelCentre, placeOverPanel } from "./rectStyle";

// Each example holds still for the first 60% of its stretch, then hands over to the next across the last 40%:
// it slides up and fades while the next slides in. Headline endings go out first, then in, never overlapping.
const HOLD = 0.6;

const smoothstep = (p: number) => p * p * (3 - 2 * p);
const byId = (id: string) => document.getElementById(id) as HTMLElement;

export function initReel(): void {
  const reel = byId("reel");
  const frame = byId("frame");
  const shots = Array.from(frame.querySelectorAll<HTMLElement>(".shot"));
  const ends = Array.from(byId("ends").children) as HTMLElement[];
  const casesEl = byId("cases");
  const note = byId("reel-note");
  const progressEl = byId("progress");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const n = CASES.length;
  let current = -1;
  let hint: HTMLElement | null = null;

  const pills = CASES.map((c, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "case tap-expand-44";
    b.textContent = c.label;
    b.addEventListener("click", () => jumpTo(i));
    casesEl.appendChild(b);
    return b;
  });
  const fills = CASES.map(() => {
    const seg = document.createElement("i");
    const fill = document.createElement("b");
    seg.appendChild(fill);
    progressEl.appendChild(seg);
    return fill;
  });
  const hots = PANEL_RECTS.map((rect, p) => {
    const h = document.createElement("button");
    h.type = "button";
    h.className = "hot";
    placeOverPanel(h, rect);
    h.setAttribute("aria-expanded", "false");
    h.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleHint(p);
    });
    frame.appendChild(h);
    return h;
  });

  function closeHint() {
    hint?.remove();
    hint = null;
    hots.forEach((h) => h.setAttribute("aria-expanded", "false"));
  }
  function toggleHint(p: number) {
    const wasOpen = hots[p].getAttribute("aria-expanded") === "true";
    closeHint();
    if (wasOpen) return;
    hint = document.createElement("div");
    hint.className = "hint";
    hint.setAttribute("role", "status");
    const q = document.createElement("q");
    q.textContent = CASES[current].hints[p];
    const small = document.createElement("small");
    small.textContent = "Ask your agent, or Helio's assistant in Beta.";
    hint.append(q, small);
    const { left, top } = panelCentre(PANEL_RECTS[p]);
    hint.style.left = left;
    hint.style.top = top;
    frame.appendChild(hint);
    hots[p].setAttribute("aria-expanded", "true");
  }
  document.addEventListener("click", closeHint);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeHint();
  });

  function setActive(i: number) {
    if (i === current) return;
    current = i;
    closeHint();
    pills.forEach((b, j) => b.setAttribute("aria-current", String(j === i)));
    hots.forEach((h, p) =>
      h.setAttribute("aria-label", `${CASES[i].label} panel ${p + 1}: show a follow-up prompt`),
    );
    note.textContent = CASES[i].note ?? DEFAULT_NOTE;
  }

  /** `pos` runs 0..n continuously with scroll. */
  function render(pos: number) {
    const i = Math.min(n - 1, Math.floor(pos));
    const t = pos - i;
    const p = i < n - 1 && t > HOLD ? smoothstep((t - HOLD) / (1 - HOLD)) : 0;
    const shift = reduce.matches ? 0 : 1;
    const outT = Math.min(1, p * 2);
    const inT = Math.max(0, p * 2 - 1);
    for (let j = 0; j < n; j++) {
      const shot = shots[j];
      const end = ends[j];
      if (j === i) {
        shot.style.visibility = "visible";
        shot.style.zIndex = "1";
        shot.style.transform = shift ? `translateY(${-p * 18}%)` : "none";
        shot.style.opacity = String(shift ? 1 : 1 - p);
        end.style.opacity = String(1 - outT);
        end.style.transform = `translateY(${-outT * 0.4 * shift}em)`;
      } else if (j === i + 1 && p > 0) {
        shot.style.visibility = "visible";
        shot.style.zIndex = "2";
        shot.style.transform = shift ? `translateY(${(1 - p) * 100}%)` : "none";
        shot.style.opacity = String(shift ? 1 : p);
        end.style.opacity = String(inT);
        end.style.transform = `translateY(${(1 - inT) * 0.4 * shift}em)`;
      } else {
        shot.style.visibility = "hidden";
        shot.style.opacity = "0";
        end.style.opacity = "0";
      }
      fills[j].style.transform = `scaleX(${Math.max(0, Math.min(1, pos - j))})`;
    }
    setActive(p > 0.5 ? i + 1 : i);
  }

  const segment = () => (reel.offsetHeight - window.innerHeight) / n;
  function jumpTo(i: number) {
    if (reduce.matches) {
      render(i);
      return;
    }
    window.scrollTo({ top: reel.offsetTop + segment() * i + 2, behavior: "smooth" });
  }
  let ticking = false;
  function onScroll() {
    ticking = false;
    render(Math.max(0, Math.min(n, (window.scrollY - reel.offsetTop) / segment())));
  }
  if (reduce.matches) {
    render(0);
    return;
  }
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(onScroll);
      }
    },
    { passive: true },
  );
  window.addEventListener("resize", onScroll);
  onScroll();
}
