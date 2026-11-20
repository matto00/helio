import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { setMotion } from "./support/motionPrimitivesSeed";
import { AUTH, registerMotionModes, TICKET } from "./support/hel1573-motion-primitives";

// HEL-1573 -- Motion = off and os-reduce, both themes, and the Motion group's own indicator snap.
// One of the `hel1573-motion-primitives-*.spec.ts` parts (HEL-1789 split the spec so CI's file-level sharding can place them on
// different legs); the per-mode driver, the helpers and the rationale live in support/hel1573-motion-primitives.ts. The file-level
// configure and use are repeated here exactly.

test.describe.configure({ mode: "parallel" });
test.use({ video: "on", viewport: { width: 1900, height: 1000 } });

registerMotionModes(["off", "os-reduce"]);

test("HEL-1573 the Motion group's own indicator snaps when Motion changes from Full to Subtle", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await registerAndLogin(page, request, { ...AUTH, label: "motion-group", isolate: true });
  await setMotion(request, "full");
  await page.goto("/settings");
  const group = page.getByRole("radiogroup", { name: "Motion" });
  await expect(group.getByRole("radio", { name: "Full", checked: true })).toBeVisible();
  await page.waitForTimeout(800);
  // Click through the DOM and sample every frame from the same task, so the first frames cannot be missed.
  const trace = await page.evaluate(async () => {
    const radiogroup = document.querySelector(
      '[role="radiogroup"][aria-label="Motion"]',
    ) as HTMLElement;
    const indicator = radiogroup.querySelector(".motion-indicator") as HTMLElement;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame((t) => resolve(t)));
    (radiogroup.querySelectorAll('[role="radio"]')[1] as HTMLElement).click();
    const frames: Array<{ left: number; running: string[] }> = [];
    for (let i = 0; i < 6; i++) {
      await frame();
      frames.push({
        left: indicator.getBoundingClientRect().left,
        running: indicator
          .getAnimations()
          .filter((a) => a.playState === "running")
          .map((a) => (a as CSSTransition).transitionProperty),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    const final = (
      radiogroup.querySelector("[data-indicator-active]") as HTMLElement
    ).getBoundingClientRect().left;
    return { frames, final, motion: document.documentElement.getAttribute("data-motion") };
  });
  writeFileSync(
    evidencePath(TICKET, "motion-group-indicator.json"),
    JSON.stringify(trace, null, 2),
  );
  expect(trace.motion).toBe("subtle");
  // By the second frame the indicator is already where it ends up, with nothing still transitioning.
  expect(Math.abs(trace.frames[1].left - trace.final)).toBeLessThan(1.5);
  for (const f of trace.frames.slice(1)) expect(f.running).toEqual([]);
});
