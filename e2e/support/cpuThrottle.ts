import type { Page } from "@playwright/test";

/** HEL-1651: env-gated CPU throttling (`HEL1651_CPU_THROTTLE=6`), the HEL1829 precedent. Unset (or 1) opens no CDP
 *  session, so a normal run is untouched. The throttle persists for the page's later navigations. */
export async function maybeThrottleCpu(page: Page): Promise<void> {
  const raw = process.env.HEL1651_CPU_THROTTLE;
  if (raw === undefined || raw === "" || raw === "1") return;
  if (!/^[2-9]$|^[1-9][0-9]+$/.test(raw)) {
    throw new Error(`HEL1651_CPU_THROTTLE must be an integer >= 1 (e.g. 4), got "${raw}"`);
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(raw) });
}
