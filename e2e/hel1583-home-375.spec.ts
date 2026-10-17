import { writeFileSync } from "node:fs";

import { expect, test, type APIRequestContext } from "@playwright/test";
import { CSRF_HEADER, currentUserId, registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { seedPipelineRuns } from "./support/homeSeed";

// HEL-1583 task 3.5a -- HEL-1578 flagged that at 375px Home's four shelf cards push the run timeline far down. This
// spec MEASURES it (rendered boxes, after `document.fonts.ready`) and screenshots it in both themes; it does not
// redesign Home. The one assertion is this ticket's own phone-gutter rule: Home's content is 12px from the screen edge.

test.describe.configure({ mode: "parallel" });
test.setTimeout(120_000);

const AUTH = { prefix: "hel1583h", displayName: "HEL-1583 Home", domain: "example.com" } as const;

async function post<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: { [CSRF_HEADER]: "1" } });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(201);
  return (await res.json()) as T;
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [375, 430]) {
    test(`Home at ${width}px (${theme}): where the run timeline starts below the four shelf cards`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      await registerAndLogin(page, request, { ...AUTH, label: `${width}${theme}`, isolate: true });
      const userId = await currentUserId(request);
      for (const name of ["Ops", "Sales", "Growth", "Support"]) {
        await post(request, "/api/dashboards", { name: `HEL-1583 ${name}` });
      }
      const source = await post<{ id: string }>(request, "/api/data-sources", {
        name: "HEL-1583 Home Source",
        type: "static",
        columns: [{ name: "note", type: "string", required: true }],
        rows: [["seed"]],
      });
      const pipeline = await post<{ id: string }>(request, "/api/pipelines", {
        name: "hel1583-orders-sync",
        roots: [{ sourceId: source.id }],
      });
      await post(request, `/api/pipelines/${pipeline.id}/outputs`, {
        kind: "table",
        name: "T",
        config: {},
      });
      seedPipelineRuns(pipeline.id, userId, [
        { status: "succeeded", hoursAgo: 8 },
        { status: "succeeded", hoursAgo: 5 },
        { status: "failed", hoursAgo: 3, errorLog: "source returned 0 rows" },
      ]);

      await page.goto("/home");
      const home = page.getByRole("region", { name: "Home" });
      // A `list` on the phone layout (a `group` on desktop), so address it by its label, not its role.
      const timeline = home.locator('[aria-label="Pipeline runs, last 24 hours"]');
      await expect(timeline).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      const m = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>(".app-content");
        const scrollTop = scroller?.scrollTop ?? 0;
        const abs = (el: Element) => {
          const r = el.getBoundingClientRect();
          return {
            top: r.top + scrollTop,
            bottom: r.bottom + scrollTop,
            left: r.left,
            right: r.right,
          };
        };
        const page = document.querySelector(".home-page")!;
        const cards = Array.from(document.querySelectorAll(".home-shelf__item"));
        const tl = document.querySelector('[aria-label="Pipeline runs, last 24 hours"]')!;
        const section = Array.from(document.querySelectorAll("h2"))
          .find((h) => h.textContent?.startsWith("Pipeline runs"))!
          .closest("section")!;
        const view = document.documentElement.clientWidth;
        const cardBoxes = cards.map(abs);
        return {
          viewportHeight: window.innerHeight,
          viewWidth: view,
          pageLeft: abs(page).left,
          cardCount: cards.length,
          firstCardLeft: cardBoxes[0]?.left,
          firstCardRightGap: cardBoxes[0] ? view - cardBoxes[0].right : null,
          shelfTop: cardBoxes[0]?.top,
          shelfBottom: cardBoxes[cardBoxes.length - 1]?.bottom,
          cardHeights: cardBoxes.map((b) => Math.round(b.bottom - b.top)),
          sectionTop: abs(section).top,
          timelineTop: abs(tl).top,
          horizontalOverflow: document.documentElement.scrollWidth > view,
        };
      });
      const out = {
        width,
        theme,
        ...m,
        shelfHeight: Math.round((m.shelfBottom ?? 0) - (m.shelfTop ?? 0)),
        sectionBelowFold: m.sectionTop > m.viewportHeight,
        sectionTopOverViewport: Math.round((m.sectionTop / m.viewportHeight) * 100) / 100,
      };
      console.log(`HEL1583-HOME ${JSON.stringify(out)}`);
      writeFileSync(
        evidencePath("HEL-1583", `home-${width}-${theme}.json`),
        JSON.stringify(out, null, 2),
      );
      await page.screenshot({
        path: evidencePath("HEL-1583", `home-${width}-${theme}-viewport.png`),
      });
      await page.screenshot({
        path: evidencePath("HEL-1583", `home-${width}-${theme}-full.png`),
        fullPage: true,
      });
      // Scroll the content area to the timeline so the evidence shows how far down it sits.
      await timeline.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: evidencePath("HEL-1583", `home-${width}-${theme}-at-timeline.png`),
      });

      // This ticket's phone-gutter rule: Home's content sits 12px from the screen edge, no horizontal scroll.
      expect(m.cardCount).toBe(4);
      expect(m.firstCardLeft).toBe(12);
      expect(m.firstCardRightGap).toBe(12);
      expect(m.horizontalOverflow).toBe(false);
    });
  }
}
