import { expect, test, type Page } from "@playwright/test";
import { registerAndLogin } from "./support/auth";
import {
  FRESH_LABEL,
  agePage,
  freshRowLabel,
  gotoSettled,
  installFreshClock,
  pageScroller,
  placeBottomNearViewportEdge,
  pressRowTops,
  pressTargets,
  recordPresses,
  rewindClock,
  revealGeometry,
  rowTopSamples,
  settledRowTop,
  watchRowTop,
} from "./support/rowDeleteGesture";

test.describe.configure({ mode: "parallel" });

// HEL-1605 -- the overview-row Delete confirm: a switch between rows, the reveal clearing the BottomNav, and the
// last row at the end of the page. jsdom evaluates no layout, so the pin, the deferred reveal and the phone
// scroll-padding can only be observed in a real browser.

const AUTH = { prefix: "hel1605", displayName: "HEL-1605", domain: "example.com" } as const;
const CSRF_HEADER = "X-Helio-Requested-With";

async function seedSources(page: Page, prefix: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const res = await page.request.post("/api/data-sources", {
      data: {
        name: `${prefix} ${String(i).padStart(2, "0")}`,
        type: "static",
        columns: [{ name: "a", type: "integer" }],
        rows: [[1]],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(res.status()).toBe(201);
    ids.push(((await res.json()) as { id: string }).id);
  }
  return ids;
}

async function seedPipelines(page: Page, prefix: string, sourceIds: string[]): Promise<void> {
  for (let i = 0; i < sourceIds.length; i++) {
    const res = await page.request.post("/api/pipelines", {
      data: {
        name: `${prefix} ${String(i).padStart(2, "0")}`,
        roots: [{ sourceId: sourceIds[i] }],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(res.status()).toBe(201);
  }
}

function nameOf(label: string | null): string {
  return (label ?? "").replace(/^Delete /, "");
}

/** Puts the confirm of `name` through the reveal checks: bottom at or above the BottomNav's top, top on screen. */
async function expectRevealedClearOfNav(page: Page, name: string): Promise<void> {
  await expect
    .poll(async () => {
      const g = await revealGeometry(page, `Confirm delete ${name}`);
      const floor = g.navTop ?? g.viewport;
      return g.groupTop >= 0 && g.groupBottom <= floor + 1;
    })
    .toBe(true);
}

async function scrollTopOf(page: Page): Promise<number> {
  return pageScroller(page).evaluate((el) => el.scrollTop);
}

test.describe("HEL-1605 overview row Delete confirm", () => {
  for (const mode of ["keyboard", "pointer"] as const) {
    test(`375px: a ${mode} reveal leaves the confirm above the BottomNav, on both pages (${mode === "keyboard" ? "I6" : "I4"})`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width: 375, height: 700 });
      await registerAndLogin(page, request, { ...AUTH, label: `nav-${mode}`, isolate: true });
      const ids = await seedSources(page, "HEL-1605 Nav Src", 16);
      await seedPipelines(page, "HEL-1605 Nav Pipe", ids);

      for (const [route, prefix] of [
        ["/sources", "HEL-1605 Nav Src"],
        ["/pipelines", "HEL-1605 Nav Pipe"],
      ] as const) {
        await gotoSettled(page, route);
        const deletes = page.getByRole("button", { name: new RegExp(`^Delete ${prefix}`) });
        await expect(deletes).toHaveCount(16);
        const target = deletes.nth(8);
        const name = nameOf(await target.getAttribute("aria-label"));
        await placeBottomNearViewportEdge(page, target);
        if (mode === "keyboard") {
          // Revealed immediately, and the confirm holds focus.
          await target.focus();
          await page.keyboard.press("Enter");
          await expect(page.getByRole("group", { name: `Confirm delete ${name}` })).toBeFocused();
        } else {
          // The row does not move during the double-click window, then the confirm comes into view.
          await watchRowTop(page, `Delete ${name}`);
          await target.click({ force: true });
          await expect(page.getByRole("group", { name: `Confirm delete ${name}` })).toBeAttached();
        }
        await expectRevealedClearOfNav(page, name);
        if (mode === "pointer") {
          // Sampled in the page: the page does not scroll in the first 450 ms (the reveal waits 500). A late re-flow
          // above can nudge scrollTop a few px through scroll anchoring; the reveal moves it by the confirm's height.
          await page.waitForTimeout(1000);
          const samples = await rowTopSamples(page);
          const early = samples.filter((sample) => sample.t <= 450);
          expect(early.length).toBeGreaterThan(0);
          for (const sample of early) {
            expect(Math.abs(sample.scrollTop - early[0].scrollTop)).toBeLessThan(20);
          }
        }
        await page.getByRole("button", { name: "Cancel" }).click();
      }
    });
  }

  // I8 / I14 / I15: a confirm is open under row A and the user double-clicks the Delete of a row B below it. Closing
  // A's confirm moves B up by its height; the pin scrolls the page back, which needs scrollTop >= that height.
  for (const [label, aIndex, bIndex, viewport, rowCount] of [
    ["I8: B directly below A's confirm", 12, 13, { width: 375, height: 700 }, 24],
    ["I14: A's confirm scrolled above the viewport", 2, 15, { width: 375, height: 700 }, 24],
    // 768 is the widest phone shell. On Sources the table scroller there overflows vertically by 1px (HEL-1605
    // evaluation 1, CR1), which used to capture the pin: the page never moved and B slid up under press 2.
    [
      "I14 (1px-overflowing table scroller): page scrolled by about A's confirm height",
      2,
      15,
      { width: 768, height: 900 },
      22,
    ],
  ] as const) {
    test(`${viewport.width}px: ${label} -- both presses land on B, only B's confirm opens, it is revealed above the BottomNav`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize(viewport);
      await registerAndLogin(page, request, {
        ...AUTH,
        label: `sw${viewport.width}-${aIndex}`,
        isolate: true,
      });
      await seedSources(page, "HEL-1605 Switch", rowCount);
      await installFreshClock(page, ["/api/data-sources"]);
      await gotoSettled(page, "/sources");
      const deletes = page.getByRole("button", { name: /^Delete HEL-1605 Switch/ });
      await expect(deletes).toHaveCount(rowCount);
      const a = deletes.nth(aIndex);
      const b = deletes.nth(bIndex);
      const aName = nameOf(await a.getAttribute("aria-label"));
      const bName = nameOf(await b.getAttribute("aria-label"));

      await a.scrollIntoViewIfNeeded();
      await a.click();
      const aGroup = page.getByRole("group", { name: `Confirm delete ${aName}` });
      await expect(aGroup).toBeVisible();
      const aHeight = (await aGroup.locator("xpath=ancestor::tr").boundingBox())!.height;

      // B near the bottom edge, so its own confirm opens below the fold.
      await placeBottomNearViewportEdge(page, b);
      // The compensable geometry: the page is scrolled down by at least A's confirm height.
      expect(await scrollTopOf(page)).toBeGreaterThanOrEqual(aHeight);
      if (aIndex === 2 && viewport.width === 375) {
        const above = await revealGeometry(page, `Confirm delete ${aName}`);
        expect(above.groupBottom).toBeLessThan(0);
      }

      await recordPresses(page, `Delete ${bName}`);
      expect(await freshRowLabel(b)).toMatch(FRESH_LABEL);
      await agePage(page);
      await b.dblclick({ force: true });
      expect(await pressTargets(page)).toEqual([`Delete ${bName}`, `Delete ${bName}`]);
      const [pressOneTop, pressTwoTop] = await pressRowTops(page);
      expect(Math.abs(pressTwoTop - pressOneTop)).toBeLessThan(2);
      await expect(page.getByRole("group", { name: /Confirm delete/ })).toHaveCount(1);
      await expect(page.getByRole("group", { name: `Confirm delete ${bName}` })).toBeVisible();
      await expect(page).toHaveURL(/\/sources$/);

      // I15: B's confirm was below the fold; after the double-click window it is in view above the BottomNav.
      await expectRevealedClearOfNav(page, bName);
    });
  }

  // I19: the page cannot scroll to compensate (page at the top), so a switch moves B up and press 2 can land on B's
  // own new confirm. The pin cannot help there; the guard is that Confirm and Cancel ignore the second press.
  test("375px: I19 -- switching rows near the top of the page: press 2 lands on a Confirm/Cancel button and deletes nothing", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await registerAndLogin(page, request, { ...AUTH, label: "i19", isolate: true });
    const ids = await seedSources(page, "HEL-1605 Src", 3);
    const names = ["HEL-1605 Pipe B short", "HEL-1605 Pipe A longer name here to wrap"];
    for (let i = 0; i < names.length; i++) {
      const res = await page.request.post("/api/pipelines", {
        data: { name: names[i], roots: [{ sourceId: ids[i] }] },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(res.status()).toBe(201);
    }
    const deleteRequests: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "DELETE") deleteRequests.push(req.url());
    });
    await gotoSettled(page, "/pipelines");
    const [bName, aName] = names;
    const a = page.getByRole("button", { name: `Delete ${aName}`, exact: true });
    const b = page.getByRole("button", { name: `Delete ${bName}`, exact: true });
    await expect(a).toBeVisible();
    await page
      .locator(".pipeline-list-table__scroll")
      .evaluate((el) => (el.scrollLeft = el.scrollWidth));
    await pageScroller(page).evaluate((el) => (el.scrollTop = 0));
    await settledRowTop(b);
    await a.click();
    await expect(page.getByRole("group", { name: `Confirm delete ${aName}` })).toBeVisible();
    await page.waitForTimeout(700);
    expect(await scrollTopOf(page)).toBeLessThan(5);
    const box = (await b.boundingBox())!;

    await recordPresses(page, `Delete ${bName}`);
    // Freshness is irrelevant here (the shift is A's closing confirm, not a relabel); the geometry below is tuned so
    // that, with the page unable to scroll back, press 2 lands on B's own new confirm: A's name length sets how far
    // B moves up (the first press), the centre of B's Delete sets where press 2 falls in B's confirm.
    await b.dblclick({ force: true, position: { x: box.width / 2, y: box.height / 2 } });
    const presses = await pressTargets(page);
    expect(presses[0]).toBe(`Delete ${bName}`);
    // The cell is not vacuous: press 2 really landed on a Confirm/Cancel button of B's confirm, not on empty page.
    expect([`Confirm delete ${bName}`, "Cancel"]).toContain(presses[1]);
    const [pressOneTop, pressTwoTop] = await pressRowTops(page);
    expect(pressOneTop - pressTwoTop).toBeGreaterThan(20); // B really moved up: the page could not compensate
    // ... and that press changed nothing: no DELETE request, B's confirm still the one open, no navigation.
    await page.waitForTimeout(700);
    expect(deleteRequests).toEqual([]);
    await expect(page.getByRole("group", { name: /Confirm delete/ })).toHaveCount(1);
    await expect(page.getByRole("group", { name: `Confirm delete ${bName}` })).toBeVisible();
    await expect(page).toHaveURL(/\/pipelines$/);
  });

  // I17 (HEL-1574 skeptic-final-5 CR1): the page at its maximum scroll, the table at its end, a double-click on the
  // LAST row. The confirm opens below the fold of a page that had no room under the row.
  test("820px, list at 400: double-clicking the last row at maximum scroll opens one confirm, stays on the page, then reveals it (I17)", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 820, height: 800 });
    await registerAndLogin(page, request, { ...AUTH, label: "last", isolate: true });
    const patched = await page.request.patch("/api/users/me/preferences", {
      data: { contextListWidth: 400 },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(patched.status()).toBe(200);
    const ids = await seedSources(page, "HEL-1605 Last Src", 18);
    await seedPipelines(page, "HEL-1605 Last Pipe", ids);

    const clockStart = await installFreshClock(page, ["/api/data-sources", "/api/pipelines"]);
    for (const [route, scroller, prefix] of [
      ["/pipelines", ".pipeline-list-table__scroll", "HEL-1605 Last Pipe"],
      ["/sources", ".source-list-table__scroll", "HEL-1605 Last Src"],
    ] as const) {
      await rewindClock(page, clockStart);
      await gotoSettled(page, route);
      const deletes = page.getByRole("button", { name: new RegExp(`^Delete ${prefix}`) });
      await expect(deletes).toHaveCount(18);
      await page.locator(scroller).evaluate((el) => (el.scrollLeft = el.scrollWidth));
      const last = deletes.last();
      const name = nameOf(await last.getAttribute("aria-label"));
      await last.scrollIntoViewIfNeeded();
      await pageScroller(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await settledRowTop(last);
      await pageScroller(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));

      await recordPresses(page, `Delete ${name}`);
      expect(await freshRowLabel(last)).toMatch(FRESH_LABEL);
      await agePage(page);
      await last.dblclick({ force: true });
      expect(await pressTargets(page)).toEqual([`Delete ${name}`, `Delete ${name}`]);
      const [pressOneTop, pressTwoTop] = await pressRowTops(page);
      expect(Math.abs(pressTwoTop - pressOneTop)).toBeLessThan(2);
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await expect(page.getByRole("group", { name: /Confirm delete/ })).toHaveCount(1);
      await expect(page.getByRole("group", { name: `Confirm delete ${name}` })).toBeVisible();
      // Then revealed: wholly inside the viewport once the double-click window has passed.
      await expectRevealedClearOfNav(page, name);
      await page.getByRole("button", { name: "Cancel" }).click();

      // HEL-1604, from the other side: a second click of a multi-click that lands on the row itself (not on Delete)
      // must not navigate to the item.
      const row = last.locator("xpath=ancestor::tr");
      const cell = row.locator("td:not(:has(a, button))").first();
      await cell.scrollIntoViewIfNeeded();
      const box = (await cell.boundingBox())!;
      // One press that is already the second of a multi-click (click detail 2): Playwright's own `clickCount: 2`
      // would send the first click too.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down({ clickCount: 2 });
      await page.mouse.up({ clickCount: 2 });
      await page.waitForTimeout(300);
      await expect(page).toHaveURL(new RegExp(`${route}$`));
    }
  });
});
