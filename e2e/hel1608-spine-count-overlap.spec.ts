import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./support/auth";

// HEL-1608: in compact spine rows (narrow desktop pages) the row count shares the summary line. A long count
// ("12,345") must take its own width and never overprint the summary. The HEL-1579 sweep seeds only 14 rows, so
// this spec seeds a source large enough for a 6-character count, with its own seeding.

const CSRF = { "X-Helio-Requested-With": "1" };
const ROWS = 12_345;

test("compact spine rows: a 6-character row count never overlaps the summary", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await registerAndLogin(page, request, {
    prefix: "hel1608cnt",
    displayName: "HEL-1608",
    domain: "example.test",
    label: "count",
  });
  const post = async <T>(url: string, data: unknown): Promise<T> => {
    const res = await page.request.post(url, { data, headers: CSRF });
    expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as T;
  };
  const csv =
    "n,label\n" + Array.from({ length: ROWS }, (_, i) => `${i},row-${i}`).join("\n") + "\n";
  const res = await page.request.post("/api/data-sources", {
    multipart: {
      name: "hel1608-big-src",
      file: { name: "big.csv", mimeType: "text/csv", buffer: Buffer.from(csv) },
    },
    headers: CSRF,
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const source = (await res.json()) as { id: string };
  const pipeline = await post<{ id: string }>("/api/pipelines", {
    name: "hel1608-big-pipe",
    roots: [{ sourceId: source.id }],
  });
  const step = (type: string, config: unknown, extra: object = {}) =>
    post<{ id: string }>(`/api/pipelines/${pipeline.id}/steps`, { type, config, ...extra });
  await step("sort", { sortBy: [{ field: "label", direction: "asc" }] });
  const sort = await step("sort", { sortBy: [{ field: "n", direction: "desc" }] });
  await step(
    "sort",
    { sortBy: [{ field: "label", direction: "desc" }] },
    { parentStepId: sort.id, attachAsTail: true },
  );
  await post(`/api/pipelines/${pipeline.id}/run`, {});

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/pipelines/${pipeline.id}`);
  await expect(page.locator(".spine-row__count", { hasText: "12,345" }).first()).toBeVisible({
    timeout: 60_000,
  });
  await page.evaluate(() => document.fonts.ready);

  for (const listWidth of ["default", "max"] as const) {
    if (listWidth === "max") {
      await page.getByRole("separator").first().focus();
      await page.keyboard.press("End");
    }
    for (const width of [769, 809, 849, 889, 929, 969, 1009, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      await page.mouse.move(0, 0);
      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".spine-body__spine .spine-row")).map(
          (row) => {
            const rect = (sel: string) =>
              row.querySelector<HTMLElement>(sel)!.getBoundingClientRect();
            const c = rect(".spine-row__count");
            const s = rect(".spine-row__summary");
            const sel = rect(".spine-row__select");
            return {
              label: row.querySelector(".spine-row__title")!.textContent,
              count: row.querySelector(".spine-row__count")!.textContent,
              overlap: Math.min(c.right, s.right) - Math.max(c.left, s.left),
              sameLine: c.top < s.bottom && c.bottom > s.top,
              countInside: c.left >= sel.left - 0.5 && c.right <= sel.right + 0.5,
              summaryW: s.width,
            };
          },
        ),
      );
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const r of rows) {
        const at = `${width}px list=${listWidth} "${r.label}" count "${r.count}"`;
        expect(r.count!.length, `${at}: the long count is shown`).toBeGreaterThanOrEqual(5);
        expect(
          r.sameLine && r.overlap > 0,
          `${at}: count overlaps the summary by ${Math.round(r.overlap)}px`,
        ).toBe(false);
        expect(r.countInside, `${at}: count stays inside the row`).toBe(true);
      }
    }
  }
});
