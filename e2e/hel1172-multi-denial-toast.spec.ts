import { expect, test, type Locator, type Page } from "@playwright/test";
import { registerAndLogin, registerUser } from "./support/auth";
import {
  applyTheme,
  iconToTextOffset,
  seedMultiDenial,
  submitNote,
  type SeededPipeline,
} from "./support/multiDenialSeed";
import { bisectHitExtent } from "./support/touchTargetProbe";

// HEL-1172 — live-browser proof of the multi-denial toast: ONE dataset write denying TWO pipelines
// shows one persistent toast whose rows link to each pipeline's page and carry their own
// "Run to update". The seed (e2e/support/multiDenialSeed.ts) uses hel1096's denial mechanism. HEL-1840: rows are
// ordered by pipeline NAME; the seed assigns names after creation so the id order is always the reverse of the name
// order, and no expected order below is ever derived from an id sort.
test.describe("HEL-1172 multi-denial toast (real backend)", () => {
  test.setTimeout(180_000);

  const AUTH = {
    prefix: "hel1172",
    displayName: "HEL-1172",
    domain: "example.com",
    isolate: true,
  } as const;

  /** Describes the focused element: its tag, accessible-ish label and href. */
  function activeElementInfo(page: Page) {
    return page.evaluate(() => {
      const el = document.activeElement;
      return {
        tag: el?.tagName ?? null,
        label: el?.getAttribute("aria-label") ?? el?.textContent?.trim() ?? null,
        href: el?.getAttribute("href") ?? null,
        isBody: el === document.body,
      };
    });
  }

  test("one toast lists every pipeline in name order, persists, exposes computed ARIA, and each row runs only its pipeline; focus never drops to body", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "rows" });
    const [alpha, beta, gamma] = await seedMultiDenial(
      request,
      ["HEL-1172 Alpha", "HEL-1172 Beta", "HEL-1172 Gamma"],
      { idsOppositeToNames: true },
    );
    // The seed discriminates: the ids run opposite to the names, so only a name sort yields Alpha, Beta, Gamma.
    expect([alpha.id, beta.id, gamma.id]).toEqual(
      [alpha.id, beta.id, gamma.id].sort((x, y) => y.localeCompare(x)),
    );

    const runPosts: string[] = [];
    page.on("request", (req) => {
      const m = /\/api\/pipelines\/([^/]+)\/run$/.exec(new URL(req.url()).pathname);
      if (req.method() === "POST" && m) runPosts.push(m[1]);
    });

    await page.goto("/dashboards");
    const form = await submitNote(page, "denies three");

    const toast = page.locator(".toast--warning").filter({ has: page.locator(".toast__list") });
    await expect(toast).toHaveCount(1);
    for (const p of [alpha, beta, gamma]) {
      await expect(toast.getByRole("link", { name: p.name })).toHaveAttribute(
        "href",
        `/pipelines/${p.id}`,
      );
    }
    const run = (p: SeededPipeline) =>
      toast.getByRole("button", { name: `Run to update: ${p.name}` });
    await expect(run(alpha)).toBeVisible();
    await expect(run(beta)).toBeVisible();
    await expect(run(gamma)).toBeVisible();
    await expect(run(alpha)).toHaveAccessibleDescription(/too many steps/i);

    // Persistent: still there well past the 4 s default auto-dismiss.
    await page.waitForTimeout(5500);
    await expect(toast).toHaveCount(1);

    // Rows are ordered by pipeline name (HEL-1840 / HEL-1844), not id. Keyboard order follows the rendered order:
    // each row's link -> its run -> the next row's link -> ...
    const rows = [alpha, beta, gamma];
    await expect(toast.locator(".toast__link")).toHaveText(rows.map((r) => r.name));
    await toast.getByRole("link", { name: rows[0].name }).focus();
    for (const [i, row] of rows.entries()) {
      if (i > 0) {
        await page.keyboard.press("Tab");
        await expect(toast.getByRole("link", { name: row.name })).toBeFocused();
      }
      await page.keyboard.press("Tab");
      await expect(run(row)).toBeFocused();
    }

    // Enter on Beta's run: only Beta runs, its action goes, focus lands on Beta's own link.
    await form.getByRole("button", { name: "Submit" }).focus();
    await run(beta).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => runPosts).toEqual([beta.id]);
    await expect(run(beta)).toHaveCount(0);
    await expect(run(alpha)).toBeVisible();
    await expect(toast.getByRole("link", { name: beta.name })).toBeFocused();

    await run(alpha).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => runPosts).toEqual([beta.id, alpha.id]);
    await expect(toast).toHaveCount(1);

    // Enter on Gamma's run (the last action): the toast closes and focus returns to the control focus came
    // from -- the form's Submit button here, since focus entered the toast straight from it.
    await form.getByRole("button", { name: "Submit" }).focus();
    await run(gamma).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => runPosts).toEqual([beta.id, alpha.id, gamma.id]);
    await expect(toast).toHaveCount(0);
    const active = await activeElementInfo(page);
    expect(active.isBody).toBe(false);
    expect(active).toMatchObject({ tag: "BUTTON", label: "Submit" });
  });

  test("a row's pipeline link opens that pipeline's page", async ({ page, request }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "link" });
    const [, beta] = await seedMultiDenial(request, ["HEL-1172 Alpha", "HEL-1172 Beta"], {
      idsOppositeToNames: true,
    });
    await page.goto("/dashboards");
    await submitNote(page, "link test");

    await page.getByRole("link", { name: "HEL-1172 Beta" }).click();
    await expect(page).toHaveURL(new RegExp(`/pipelines/${beta.id}`));
  });

  test("rapid identical writes leave one toast", async ({ page, request }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "storm" });
    await seedMultiDenial(request, ["HEL-1172 Alpha", "HEL-1172 Beta"]);
    await page.goto("/dashboards");
    await submitNote(page, "one");
    await submitNote(page, "two");
    await submitNote(page, "three");

    await expect(
      page.locator(".toast--warning").filter({ has: page.locator(".toast__list") }),
    ).toHaveCount(1);
  });

  // DESIGN.md §3: every touch control clears 44px. bisectHitExtent walks outward from each control's centre with
  // elementFromPoint and asserts >= 44 - samplingStep itself, so a row whose expander is truncated by a neighbour
  // (tiling) or clipped by the scroll list fails here.
  test("390px: every in-toast link and run action has a 44px hit region on the y axis", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "touch" });
    await seedMultiDenial(request, ["HEL-1172 Alpha", "HEL-1172 Beta"]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboards");
    await submitNote(page, "touch");

    const toast = page.locator(".toast--warning").filter({ has: page.locator(".toast__list") });
    await expect(toast).toHaveCount(1);
    for (const name of ["HEL-1172 Alpha", "HEL-1172 Beta"]) {
      await toast.getByRole("link", { name }).scrollIntoViewIfNeeded();
      await bisectHitExtent(page, toast.getByRole("link", { name }), "y");
      await toast.getByRole("button", { name: `Run to update: ${name}` }).scrollIntoViewIfNeeded();
      await bisectHitExtent(
        page,
        toast.getByRole("button", { name: `Run to update: ${name}` }),
        "y",
      );
    }
  });

  test("390px: the single-pipeline toast's 'Run to update' has a 44px hit region", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "touch-single" });
    await seedMultiDenial(request, ["HEL-1172 Solo"]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboards");
    await submitNote(page, "touch single");

    const runBtn = page.locator(".toast--warning").getByRole("button", { name: "Run to update" });
    await expect(runBtn).toBeVisible();
    await bisectHitExtent(page, runBtn, "y");
  });

  // HEL-1840 D2. The first row's link lines up with the variant icon the way a single-message toast's text does.
  const ALIGNMENT_CASES = [
    { theme: "light", viewport: { width: 390, height: 844 } },
    { theme: "dark", viewport: { width: 390, height: 844 } },
    { theme: "light", viewport: { width: 1280, height: 800 } },
  ] as const;
  for (const { theme, viewport } of ALIGNMENT_CASES) {
    test(`${viewport.width}px ${theme}: the first row lines up with the icon as a single-message toast's text does`, async ({
      page,
      request,
      browser,
      baseURL,
    }) => {
      // Reference: the single-message toast's icon -> text offset at this viewport and theme (its own user).
      let singleOffset = 0;
      const refContext = await browser.newContext({ baseURL, viewport, ignoreHTTPSErrors: true });
      try {
        const refPage = await refContext.newPage();
        // The registration cookie already authenticates this context (no UI login needed).
        await registerUser(refContext.request, { ...AUTH, label: "align-ref" });
        await seedMultiDenial(refContext.request, ["HEL-1172 Solo"]);
        await applyTheme(refPage, theme);
        await submitNote(refPage, "single");
        const single = refPage.locator(".toast--warning").filter({
          has: refPage.locator(".toast__message:visible"),
        });
        await expect(single).toHaveCount(1);
        singleOffset = await iconToTextOffset(single, ".toast__message");
      } finally {
        await refContext.close();
      }

      await registerAndLogin(page, request, { ...AUTH, label: "align" });
      await seedMultiDenial(request, ["HEL-1172 Alpha", "HEL-1172 Beta"], {
        idsOppositeToNames: true,
      });
      await page.setViewportSize(viewport);
      await applyTheme(page, theme);
      await submitNote(page, "align");
      const toast = page.locator(".toast--warning").filter({ has: page.locator(".toast__list") });
      await expect(toast).toHaveCount(1);
      const multiOffset = await iconToTextOffset(toast, ".toast__list .toast__link");
      console.log(
        `[HEL-1840] ${viewport.width}px ${theme} single=${singleOffset} multi=${multiOffset}`,
      );
      expect(Math.abs(multiOffset - singleOffset)).toBeLessThanOrEqual(1);

      // Precedence 1 (phone width, where the touch expanders exist): they keep their 44px y extent.
      if (viewport.width <= 768) {
        await bisectHitExtent(page, toast.getByRole("link", { name: "HEL-1172 Alpha" }), "y");
        await bisectHitExtent(
          page,
          toast.getByRole("button", { name: "Run to update: HEL-1172 Beta" }),
          "y",
        );
      }
    });
  }

  // HEL-1840 D3. The cue is the frame's data attribute plus its ::after fade; a list that fits has neither.
  const fadeImage = (frame: Locator) =>
    frame.evaluate((el) => getComputedStyle(el, "::after").backgroundImage);

  for (const theme of ["light", "dark"] as const) {
    test(`390px ${theme}: an overflowing list shows the fade until scrolled to its end, and never paints over the toast border`, async ({
      page,
      request,
    }) => {
      test.setTimeout(240_000);
      await registerAndLogin(page, request, { ...AUTH, label: `overflow-${theme}` });
      await seedMultiDenial(
        request,
        ["A", "B", "C", "D", "E", "F"].map((l) => `HEL-1172 ${l}`),
        { idsOppositeToNames: true },
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await applyTheme(page, theme);
      await submitNote(page, "overflow");

      const toast = page.locator(".toast--warning").filter({ has: page.locator(".toast__list") });
      const frame = toast.locator(".toast__list-frame");
      const list = toast.locator(".toast__list");
      await expect(toast).toHaveCount(1);
      await expect(frame).toHaveAttribute("data-overflow-below", "true");
      expect(await fadeImage(frame)).not.toBe("none");
      expect(await fadeImage(frame)).toContain("linear-gradient");

      // Mid-scrolled and at the end, no row content is painted at or above the toast's top border inner edge.
      const maxScroll = await list.evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(maxScroll).toBeGreaterThan(40);
      for (const fraction of [0, 0.5, 1]) {
        await list.evaluate((el, f) => {
          el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
        }, fraction);
        const painted = await toast.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const ul = el.querySelector(".toast__list")?.getBoundingClientRect();
          if (!ul) throw new Error("no list");
          const rows = Array.from(el.querySelectorAll(".toast__list-item")).map((li) => {
            const r = li.getBoundingClientRect();
            // Painted extent is clipped by the scroll container.
            return Math.max(r.top, ul.top) < Math.min(r.bottom, ul.bottom)
              ? Math.max(r.top, ul.top)
              : null;
          });
          return { boxTop: box.top, listTop: ul.top, rowTops: rows.filter((t) => t !== null) };
        });
        expect(painted.listTop).toBeGreaterThanOrEqual(painted.boxTop + 1);
        for (const top of painted.rowTops) expect(top).toBeGreaterThanOrEqual(painted.boxTop + 1);
        if (fraction === 0.5) {
          await expect(frame).toHaveAttribute("data-overflow-below", "true");
        }
      }
      await expect(frame).not.toHaveAttribute("data-overflow-below", /.*/);
    });
  }

  // HEL-1840 evaluation-1 CR2: a keyboard-focused row control never sits under the overflow fade.
  test("390px: every Tab stop in an overflowing list is clear of the fade while the fade shows", async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await registerAndLogin(page, request, { ...AUTH, label: "focus-fade" });
    await seedMultiDenial(
      request,
      ["A", "B", "C", "D", "E", "F"].map((l) => `HEL-1172 ${l}`),
      { idsOppositeToNames: true },
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboards");
    await submitNote(page, "focus fade");

    const toast = page.locator(".toast--warning").filter({ has: page.locator(".toast__list") });
    const frame = toast.locator(".toast__list-frame");
    await expect(frame).toHaveAttribute("data-overflow-below", "true");
    await toast.getByRole("link", { name: "HEL-1172 A" }).focus();
    for (let stop = 0; stop < 12; stop++) {
      const probe = await toast.evaluate((el) => {
        const active = document.activeElement;
        const frameEl = el.querySelector(".toast__list-frame");
        const list = el.querySelector(".toast__list");
        if (!active || !frameEl || !list || !list.contains(active)) return null;
        const fade = parseFloat(getComputedStyle(frameEl, "::after").height);
        return {
          label: active.textContent,
          fading: frameEl.getAttribute("data-overflow-below") === "true",
          bottom: active.getBoundingClientRect().bottom,
          clearLine: list.getBoundingClientRect().bottom - fade,
        };
      });
      expect(probe).not.toBeNull();
      // Scrolling settles asynchronously; a control may only be under the fade while the fade is gone.
      await expect
        .poll(
          async () =>
            toast.evaluate((el) => {
              const active = document.activeElement as HTMLElement;
              const frameEl = el.querySelector(".toast__list-frame") as HTMLElement;
              const list = el.querySelector(".toast__list") as HTMLElement;
              const fade = parseFloat(getComputedStyle(frameEl, "::after").height);
              const fading = frameEl.getAttribute("data-overflow-below") === "true";
              const b = active.getBoundingClientRect().bottom;
              const lb = list.getBoundingClientRect().bottom;
              return !fading || b <= lb - fade
                ? "ok"
                : JSON.stringify({
                    b,
                    lb,
                    fade,
                    st: list.scrollTop,
                    max: list.scrollHeight - list.clientHeight,
                  });
            }),
          { message: `Tab stop ${stop} (${probe?.label}) sits under the fade` },
        )
        .toBe("ok");
      await page.keyboard.press("Tab");
    }
  });

  // HEL-1840 skeptic-final-1/2 CR1: the cue must not depend on where the clip lands (an inter-row gap, a short
  // viewport, rows that shrank after "Run to update"). The fade is paired with a bottom-edge shadow that is painted at
  // the list's bottom edge whatever the rows are doing, and is distinct from the card surface.
  const DESKTOP_CUE_STATES = [
    { name: "1366x640 with 6 rows", viewport: { width: 1366, height: 640 }, runFirst: 0 },
    {
      name: "1440x900 after running the first two rows",
      viewport: { width: 1440, height: 900 },
      runFirst: 2,
    },
  ] as const;
  for (const state of DESKTOP_CUE_STATES) {
    for (const theme of ["light", "dark"] as const) {
      test(`${state.name}, ${theme}: the overflow cue has an edge treatment distinct from the card`, async ({
        page,
        request,
      }) => {
        test.setTimeout(300_000);
        await registerAndLogin(page, request, {
          ...AUTH,
          label: `edge-${state.runFirst}-${theme}`,
        });
        const rows = await seedMultiDenial(
          request,
          ["A", "B", "C", "D", "E", "F"].map((l) => `HEL-1172 ${l}`),
          { idsOppositeToNames: true },
        );
        await page.setViewportSize(state.viewport);
        await applyTheme(page, theme);
        await submitNote(page, "edge cue");

        const toast = page.locator(".toast--warning").filter({ has: page.locator(".toast__list") });
        const frame = toast.locator(".toast__list-frame");
        for (const row of rows.slice(0, state.runFirst)) {
          await toast.getByRole("button", { name: `Run to update: ${row.name}` }).click();
          await expect(
            toast.getByRole("button", { name: `Run to update: ${row.name}` }),
          ).toHaveCount(0);
        }
        await expect(frame).toHaveAttribute("data-overflow-below", "true");
        const cue = await toast.evaluate((el) => {
          const frameEl = el.querySelector(".toast__list-frame") as HTMLElement;
          const after = getComputedStyle(frameEl, "::after");
          const surface = getComputedStyle(el).backgroundColor;
          return {
            boxShadow: after.boxShadow,
            gradient: after.backgroundImage,
            surface,
            // The ::after box ends at the list's bottom edge, which is where the clip is.
            frameBottom: frameEl.getBoundingClientRect().bottom,
            listBottom: (el.querySelector(".toast__list") as HTMLElement).getBoundingClientRect()
              .bottom,
          };
        });
        console.log(`[HEL-1840] ${state.name} ${theme} cue ${JSON.stringify(cue)}`);
        expect(cue.gradient).toContain("linear-gradient");
        expect(cue.boxShadow).not.toBe("none");
        expect(cue.boxShadow).toContain("inset");
        // The edge colour is not the card surface (it is the theme text colour at partial alpha).
        {
          // Computed shadow colour is `color(srgb r g b / a)`; compare its channels to the card's `rgb(r, g, b)`.
          const shadow = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(cue.boxShadow);
          const surface = /rgb\((\d+), (\d+), (\d+)\)/.exec(cue.surface);
          expect(shadow).not.toBeNull();
          expect(surface).not.toBeNull();
          const gap = [1, 2, 3].map((i) =>
            Math.abs(Number(shadow?.[i]) - Number(surface?.[i]) / 255),
          );
          expect(Math.max(...gap)).toBeGreaterThan(0.3);
        }
        expect(Math.abs(cue.frameBottom - cue.listBottom)).toBeLessThanOrEqual(1);
      });
    }
  }

  test("1280px: a list that fits shows no fade", async ({ page, request }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "fits" });
    await seedMultiDenial(request, ["HEL-1172 Alpha", "HEL-1172 Beta"]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/dashboards");
    await submitNote(page, "fits");

    const toast = page.locator(".toast--warning").filter({ has: page.locator(".toast__list") });
    const frame = toast.locator(".toast__list-frame");
    await expect(frame).toHaveCount(1);
    const metrics = await toast
      .locator(".toast__list")
      .evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.client + 1);
    await expect(frame).not.toHaveAttribute("data-overflow-below", /.*/);
    expect(await fadeImage(frame)).toBe("none");
  });
});
