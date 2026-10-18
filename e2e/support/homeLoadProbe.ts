import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { CSRF_HEADER, currentUserId, registerAndLogin } from "./auth";
import { seedPipelineRuns } from "./homeSeed";

// HEL-1665 -- the shared fixture and per-frame recorder for the Home load-stability spec: seeds the HEL-1642 user
// (four dashboards, one pipeline whose runs all succeeded, so the opening sentence is the default "All quiet"), holds
// `GET /api/dashboards` and `GET /api/home-summary` so they can be released one at a time, and samples the geometry
// that must not move on EVERY animation frame (not just before/after: a transient mover is the defect).

export interface Sample {
  runsTop: number | null;
  contentTop: number | null;
  shelfTop: number | null;
  shelfHeadH: number | null;
  openingH: number | null;
  sentenceH: number | null;
  shelfCardH: number | null;
  runsHeadH: number | null;
  legend: boolean;
  link: boolean;
  fonts: string;
}

export interface ShiftEntry {
  value: number;
  sources: string[];
}

export async function post<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: { [CSRF_HEADER]: "1" } });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(201);
  return (await res.json()) as T;
}

/** Registers an isolated user with the HEL-1642 Home fixture; returns the user id (for exact-id cleanup records). */
export async function seedHome(
  page: Page,
  request: APIRequestContext,
  label: string,
): Promise<string> {
  await registerAndLogin(page, request, {
    prefix: "hel1665h",
    displayName: "HEL-1665 Home",
    domain: "example.com",
    label,
    isolate: true,
  });
  const userId = await currentUserId(request);
  const source = await post<{ id: string }>(request, "/api/data-sources", {
    name: "HEL-1665 Home Source",
    type: "static",
    columns: [{ name: "note", type: "string", required: true }],
    rows: [["seed"]],
  });
  const pipeline = await post<{ id: string }>(request, "/api/pipelines", {
    name: "hel1665-orders-sync",
    roots: [{ sourceId: source.id }],
  });
  const output = await post<{ id: string }>(request, `/api/pipelines/${pipeline.id}/outputs`, {
    kind: "table",
    name: "T",
    config: {},
  });
  for (const [index, name] of ["Ops", "Sales", "Growth", "Support"].entries()) {
    const dashboard = await post<{ id: string }>(request, "/api/dashboards", {
      name: `HEL-1665 ${name}`,
    });
    if (index < 2) {
      for (const title of ["A", "B", "C"]) {
        await post(request, "/api/panels", {
          dashboardId: dashboard.id,
          title: `HEL-1665 ${name} ${title}`,
          type: "output",
          config: { outputId: output.id },
        });
      }
    }
  }
  seedPipelineRuns(pipeline.id, userId, [
    { status: "succeeded", hoursAgo: 8 },
    { status: "succeeded", hoursAgo: 5 },
  ]);
  return userId;
}

/** Installs the rAF recorder + layout-shift observer; call BEFORE `page.goto`. */
export async function installRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const samples: unknown[] = [];
    const shifts: unknown[] = [];
    (window as unknown as { __h1665: unknown }).__h1665 = { samples, shifts };
    const top = (el: Element | null) => (el ? el.getBoundingClientRect().top : null);
    const height = (el: Element | null) => (el ? el.getBoundingClientRect().height : null);
    const frame = () => {
      const runs = document.querySelector(".home-runs");
      const head = runs?.querySelector(".home-section__head") ?? null;
      const shelf = document.querySelector(".home-section");
      samples.push({
        runsTop: top(runs),
        contentTop: top(head?.nextElementSibling ?? null),
        shelfTop: top(shelf),
        shelfHeadH: height(shelf?.querySelector(".home-section__head") ?? null),
        openingH: height(document.querySelector(".home-opening")),
        sentenceH: height(document.querySelector(".home-opening__sentence")),
        shelfCardH: height(document.querySelector(".home-shelf .home-card")),
        runsHeadH: height(head),
        legend: runs?.querySelector(".tl-legend") != null,
        link: shelf?.querySelector(".home-section__link") != null,
        fonts: document.fonts.status,
      });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const describe = (node: Node | null) => {
      if (!(node instanceof Element)) return "?";
      return `${node.tagName.toLowerCase()}.${String(node.className).replace(/\s+/g, ".")}`;
    };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as unknown as { value: number; sources?: { node: Node | null }[] };
          shifts.push({
            value: shift.value,
            sources: (shift.sources ?? []).map((s) => describe(s.node)),
          });
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // layout-shift is Chromium-only; the per-frame series is the assertion either way.
    }
  });
}

export interface Gates {
  releaseDashboards: () => void;
  releaseSummary: () => void;
}

/** Holds the two Home requests until released. `mutateSummary` rewrites the (real) summary body. */
export async function holdRequests(
  page: Page,
  mutateSummary?: (body: Record<string, unknown>) => void,
): Promise<Gates> {
  let releaseDashboards!: () => void;
  let releaseSummary!: () => void;
  const dashboards = new Promise<void>((resolve) => (releaseDashboards = resolve));
  const summary = new Promise<void>((resolve) => (releaseSummary = resolve));
  await page.route(/\/api\/dashboards(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await dashboards;
    return route.continue();
  });
  await page.route(/\/api\/home-summary(\?.*)?$/, async (route) => {
    await summary;
    if (mutateSummary === undefined) return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    mutateSummary(body);
    return route.fulfill({ response, json: body });
  });
  return { releaseDashboards, releaseSummary };
}

export async function recorded(page: Page): Promise<{ samples: Sample[]; shifts: ShiftEntry[] }> {
  return page.evaluate(
    () => (window as unknown as { __h1665: { samples: Sample[]; shifts: ShiftEntry[] } }).__h1665,
  );
}

/** Frames recorded so far in which the runs card already exists. */
export async function framesWithRunsCard(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as unknown as { __h1665: { samples: { runsTop: number | null }[] } }
      ).__h1665.samples.filter((s) => s.runsTop !== null).length,
  );
}

export function spread(values: (number | null)[]): number {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? 0 : Math.max(...present) - Math.min(...present);
}
