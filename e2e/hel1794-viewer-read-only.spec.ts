import { writeFileSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import {
  compositeOver,
  compositeStack,
  contrastRatio,
  parseColor,
} from "./support/stateContrast.mjs";
import {
  DESKTOP,
  OUTPUT_NAME,
  PHONE,
  collaborator,
  openPipeline,
  seedSharedPipeline,
} from "./support/hel1661Fixture";

// HEL-1794: a viewer grantee is offered NO actionable edit control on the pipeline detail page (desktop and phone, light and
// dark) and cannot create a client-only draft; an editor keeps every control. Real backend, real grants, plain emails.
//
//  1. Exact allow-list scan: every visible, enabled control of the page (and of every dialog/menu opened on the way) must have an
//     accessible name in ALLOWED (exact strings; only the fixture's own step row is parameterised). Plus explicit absence checks.
//  2. Whole-flow network watch: no write request to /api/pipelines, /api/pipeline-steps or /api/outputs (bar the named read-only
//     POSTs) is sent during the viewer flow.
//  3. A viewer cannot create a draft: the first configuration field cannot be edited, no grip exists, and neither "Discard draft",
//     a draft chip nor a kept-draft key appears.
//  4. The editor on the same pipeline keeps the controls, and typing into a field creates a draft.
// The owner also PUTs a schedule: a grantee never receives it from the server (owner-only routes), so the viewer must see no
// schedule control even though one exists.

/** Soft assertions with a short timeout: one run reports EVERY offending control instead of stopping at the first. */
const soft = expect.configure({ soft: true, timeout: 2_000 });

const CSRF = { "X-Helio-Requested-With": "1" };
const KEPT_DRAFT_PREFIX = "helio.pipelineDraft.";

/** Read-only POSTs the page may send for a viewer (named in design.md D4). */
const READ_ONLY_POSTS = [
  /^\/api\/pipelines\/[^/]+\/preview$/,
  /^\/api\/pipelines\/[^/]+\/validate-expression$/,
  /^\/api\/pipelines\/[^/]+\/draft-preview$/,
  /^\/api\/pipelines\/analyze-proposal$/,
];

/** The EXACT accessible names a viewer may be offered (no regex, no prefix). `STEP_ROW` is added per run from the fixture. */
const ALLOWED = new Set<string>([
  "Pipelines", // the "Pipeline path" crumb link (desktop)
  "Back to pipelines", // phone
  `Open ${OUTPUT_NAME} output`,
  `Output actions for ${OUTPUT_NAME}`,
  `History for ${OUTPUT_NAME}`,
  "Pipeline actions",
  "Run history",
  "Displayed Output",
  "Output", // the live column's disclosure toggle (narrow desktop)
  "Previewed step",
  "Steps", // phone tabs
  "Preview",
  "Runs",
  "Close", // the Output sheet / history dialog close control
  "Request Beta access (opens in a new tab)", // the Output sheet's Ask panel upsell for a free-tier user (a link, not an edit)
]);

interface Found {
  tag: string;
  role: string;
  name: string;
}

/** Every visible, enabled interactive element inside the main region and any open dialog/menu, with its accessible name. */
async function scan(page: Page): Promise<Found[]> {
  return page.evaluate(() => {
    const SELECTOR =
      "button, a[href], input, select, textarea, [role=button], [role=menuitem], [role=combobox], [role=switch], [draggable=true], [contenteditable=true]";
    const roots = Array.from(
      document.querySelectorAll("main, dialog[open], [role=menu], [role=listbox]"),
    );
    const seen = new Set<Element>();
    const out: { tag: string; role: string; name: string }[] = [];
    const nameOf = (el: Element): string => {
      const aria = el.getAttribute("aria-label");
      if (aria) return aria.trim();
      const by = el.getAttribute("aria-labelledby");
      if (by) {
        const t = by
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ")
          .trim();
        if (t) return t;
      }
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l?.textContent?.trim()) return l.textContent.trim();
      }
      const wrap = el.closest("label");
      if (wrap?.textContent?.trim()) return wrap.textContent.trim();
      const txt = (el.textContent ?? "").trim();
      if (txt) return txt;
      return el.getAttribute("title") ?? el.getAttribute("placeholder") ?? "";
    };
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll(SELECTOR))) {
        if (seen.has(el)) continue;
        seen.add(el);
        const style = getComputedStyle(el);
        if (el.getClientRects().length === 0 || style.visibility === "hidden") continue;
        if (el.closest("[hidden], [inert]")) continue;
        if ((el as HTMLButtonElement).disabled || el.closest("fieldset[disabled]")) continue;
        if (el.getAttribute("aria-disabled") === "true") continue;
        if (el.getAttribute("type") === "hidden") continue;
        out.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") ?? "",
          name: nameOf(el),
        });
      }
    }
    return out;
  });
}

async function expectOnlyAllowed(page: Page, where: string, stepRow: string): Promise<void> {
  const found = await scan(page);
  const bad = found.filter((f) => !ALLOWED.has(f.name) && f.name !== stepRow);
  expect
    .soft(
      bad.map((f) => `${f.tag}${f.role ? `[${f.role}]` : ""} "${f.name}"`),
      `${where}: controls outside the viewer allow-list`,
    )
    .toEqual([]);
}

/** Value-text contrast of a read-only (disabled) field: its colour, with the element's and every ancestor's opacity folded in,
 *  over the opaque backdrop its ancestors paint. A bare `color` read would miss the shared disabled recipe's 0.55 dimming. */
async function valueContrast(target: Locator): Promise<number> {
  const probe = await target.evaluate((el) => {
    const layers: string[] = [];
    let opacity = 1;
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      opacity *= Number(style.opacity);
      layers.push(style.backgroundColor);
    }
    return { color: getComputedStyle(el).color, opacity, layers };
  });
  const backdrop = compositeStack(probe.layers.map((c: string) => parseColor(c)));
  const text = parseColor(probe.color);
  const shown = compositeOver({ ...text, a: text.a * probe.opacity }, backdrop);
  return contrastRatio(shown, backdrop);
}

function watchWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (request) => {
    const method = request.method();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
    const { pathname } = new URL(request.url());
    if (!/^\/api\/(pipelines|pipeline-steps|outputs)(\/|$)/.test(pathname)) return;
    if (READ_ONLY_POSTS.some((rx) => rx.test(pathname))) return;
    writes.push(`${method} ${pathname}`);
  });
  return writes;
}

async function keptDraftKeys(page: Page): Promise<string[]> {
  return page.evaluate((prefix) => {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    return keys;
  }, KEPT_DRAFT_PREFIX);
}

async function expectNoEditControls(page: Page, where: string): Promise<void> {
  const absent = [
    page.getByRole("button", { name: "Edit pipeline name" }),
    page.getByRole("button", { name: "Add schedule" }),
    page.getByRole("button", { name: "Add source" }),
    page.getByRole("button", { name: /^\+ Add (transformation )?step$/ }),
    page.getByRole("button", { name: "New output" }),
    page.getByRole("button", { name: "Disable step" }),
    page.getByRole("button", { name: "Duplicate step" }),
    page.getByRole("button", { name: "Remove step" }),
    page.getByRole("button", { name: "Save", exact: true }),
    page.getByRole("button", { name: "Delete", exact: true }),
    page.locator('button[aria-label^="Edit schedule"]'),
    page.locator('button[aria-label^="Step actions for"]'),
    page.locator('[draggable="true"]'),
    page.getByRole("button", { name: "Discard draft" }),
  ];
  for (const locator of absent) await soft(locator, where).toHaveCount(0);
}

/** Opens the Pipeline actions menu when the page has one, asserts no edit item, closes it. */
async function checkMenu(page: Page, where: string, stepRow: string): Promise<void> {
  const trigger = page.getByRole("button", { name: "Pipeline actions" });
  if ((await trigger.count()) === 0) return;
  await trigger.click();
  for (const item of ["Rename", "Edit source", "Set schedule", "Pause schedule", "Add source"]) {
    await expect
      .soft(page.getByRole("menuitem", { name: item }), `${where}: ${item}`)
      .toHaveCount(0);
  }
  await expect
    .soft(page.getByRole("menuitem", { name: /schedule/i }), `${where}: schedule`)
    .toHaveCount(0);
  await expectOnlyAllowed(page, `${where} (menu open)`, stepRow);
  await page.keyboard.press("Escape");
}

async function viewerFlow(
  page: Page,
  pipelineId: string,
  phone: boolean,
  theme: "light" | "dark",
  label: string,
): Promise<void> {
  await openPipeline(page, pipelineId, theme, phone ? PHONE : DESKTOP);
  const writes = watchWrites(page);
  const row = page.locator(".spine-row__select").first();
  const stepRow = (await row.getAttribute("aria-label")) ?? "";
  expect(stepRow).toMatch(/^Step 1:/);
  const where = `${label}/${theme}`;

  await soft(page.getByText("View only").first(), where).toBeVisible();
  await expectNoEditControls(page, where);
  await expectOnlyAllowed(page, `${where} (page)`, stepRow);
  await checkMenu(page, where, stepRow);

  // Select the step (desktop) / open its sheet (phone).
  await row.click();
  const editorRoot = phone ? page.locator("dialog.mobile-step-sheet[open]") : page.locator("main");
  await expect(editorRoot.locator(".step-focused")).toBeVisible();
  await expectNoEditControls(page, `${where} (step open)`);
  await expectOnlyAllowed(page, `${where} (step open)`, stepRow);

  // The read-only values stay readable: >= 4.5:1 in this theme, opacity included.
  const contrast: Record<string, number> = {};
  const stepFields = editorRoot.locator(
    ".step-focused__fieldset input, .step-focused__fieldset textarea",
  );
  for (let i = 0; i < Math.min(await stepFields.count(), 3); i += 1) {
    contrast[`step field ${i}`] = await valueContrast(stepFields.nth(i));
  }

  // With no draft yet, a structural control would write at once (not record a draft): a viewer is offered none, so nothing is sent.
  const duplicate = page.getByRole("button", { name: "Duplicate step" });
  if ((await duplicate.count()) > 0) {
    await duplicate.click();
  }

  // A viewer cannot create a draft: the first configuration field refuses an edit and nothing draft-like appears.
  const field = editorRoot
    .locator(".step-focused__fieldset input, .step-focused__fieldset textarea")
    .first();
  await expect(field, where).toBeVisible();
  const before = await field.inputValue();
  await field.fill(`${before}x`, { force: true, timeout: 3_000 }).catch(() => undefined);
  await field.press("x", { timeout: 3_000 }).catch(() => undefined);
  soft(await field.inputValue(), `${where}: the field value is unchanged`).toBe(before);
  await soft(page.getByRole("button", { name: "Discard draft" }), where).toHaveCount(0);
  await soft(page.getByText("Draft · unsaved changes"), where).toHaveCount(0);
  soft(await keptDraftKeys(page), `${where}: no kept draft`).toEqual([]);
  await soft(page.locator(".spine-row__grip"), where).toHaveCount(0);

  if (phone) {
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.mobile-step-sheet[open]")).toHaveCount(0);
  }

  // Open the Output: its preview shows with no editable field and no Save/Delete.
  await page.getByRole("button", { name: `Open ${OUTPUT_NAME} output` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect
    .soft(dialog.getByRole("button", { name: "Save", exact: true }), where)
    .toHaveCount(0);
  await expect
    .soft(dialog.getByRole("button", { name: "Delete", exact: true }), where)
    .toHaveCount(0);
  await soft(dialog.getByRole("textbox", { name: "Name" }), where).toBeDisabled();
  await expectOnlyAllowed(page, `${where} (output sheet)`, stepRow);
  contrast["output name"] = await valueContrast(dialog.getByRole("textbox", { name: "Name" }));
  contrast["output kind"] = await valueContrast(dialog.locator("#output-kind"));
  writeFileSync(
    evidencePath("HEL-1794", `contrast-${label}-${theme}.json`),
    JSON.stringify(contrast, null, 2),
  );
  for (const [what, ratio] of Object.entries(contrast)) {
    soft(ratio, `${where}: ${what} value contrast`).toBeGreaterThanOrEqual(4.5);
  }
  await page.screenshot({ path: evidencePath("HEL-1794", `viewer-${label}-${theme}-output.png`) });
  await page.keyboard.press("Escape");
  await soft(page.getByRole("dialog")).toHaveCount(0);

  await page.screenshot({ path: evidencePath("HEL-1794", `viewer-${label}-${theme}.png`) });
  soft(writes, `${where}: write requests during the viewer flow`).toEqual([]);
  soft(await keptDraft(page), where).toEqual([]);
}

async function keptDraft(page: Page): Promise<string[]> {
  return keptDraftKeys(page);
}

test.describe("HEL-1794 viewer read-only pipeline page (live)", () => {
  for (const [label, phone] of [
    ["desktop", false],
    ["phone", true],
  ] as const) {
    test(`viewer on ${label}: no edit control, no write request, no draft, light and dark`, async ({
      page,
      request,
      browser,
      baseURL,
    }) => {
      test.setTimeout(420_000);
      await registerAndLogin(page, request, {
        prefix: "hel1794",
        label: `owner-${label}`,
        displayName: "HEL-1794",
      });
      const editor = await collaborator(browser, baseURL, `editor-${label}`);
      const viewer = await collaborator(browser, baseURL, `viewer-${label}`);
      const pipelineId = await seedSharedPipeline(page, editor, viewer);
      // The owner schedules the pipeline: the viewer must still see no schedule control (grantees never receive it).
      const put = await page.request.put(`/api/pipelines/${pipelineId}/schedule`, {
        data: { kind: "interval", expression: "15m", timezone: "UTC", enabled: true },
        headers: CSRF,
      });
      expect(put.status()).toBeLessThan(300);

      for (const theme of ["light", "dark"] as const) {
        await viewerFlow(viewer.page, pipelineId, phone, theme, label);
      }
      await editor.context.close();
      await viewer.context.close();
    });
  }

  test("editor keeps every edit control on desktop and phone, and typing creates a draft", async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    await registerAndLogin(page, request, {
      prefix: "hel1794",
      label: "owner-editor",
      displayName: "HEL-1794",
    });
    const editor = await collaborator(browser, baseURL, "editor-control");
    const viewer = await collaborator(browser, baseURL, "viewer-control");
    const pipelineId = await seedSharedPipeline(page, editor, viewer);
    const p = editor.page;

    // Desktop.
    await openPipeline(p, pipelineId, "light", DESKTOP);
    await expect(p.getByRole("button", { name: "Edit pipeline name" })).toBeVisible();
    await expect(p.getByRole("button", { name: "Add schedule" })).toBeVisible();
    await expect(p.getByRole("button", { name: "Add source" })).toBeVisible();
    await expect(p.getByRole("button", { name: "+ Add transformation step" })).toBeVisible();
    await expect(p.getByRole("button", { name: "New output" })).toBeVisible();
    await expect(p.locator('button[aria-label^="Step actions for"]')).toHaveCount(1);
    await p.locator(".spine-row__select").first().click();
    await expect(p.getByRole("button", { name: "Disable step" })).toBeVisible();
    await expect(p.getByRole("button", { name: "Duplicate step" })).toBeVisible();
    await expect(p.getByRole("button", { name: "Remove step" })).toBeVisible();
    const field = p
      .locator(".step-focused__fieldset input, .step-focused__fieldset textarea")
      .first();
    await expect(field).toBeEnabled();
    await field.fill(`${await field.inputValue()}0`);
    await expect(p.getByRole("button", { name: "Discard draft" })).toBeVisible();
    await p.getByRole("button", { name: "Discard draft" }).click();
    await expect(p.getByRole("button", { name: "Discard draft" })).toHaveCount(0);
    await p.screenshot({ path: evidencePath("HEL-1794", "editor-desktop-light.png") });

    // Phone.
    await openPipeline(p, pipelineId, "dark", PHONE);
    await p.locator(".spine-row__select").first().click();
    const sheet = p.locator("dialog.mobile-step-sheet[open]");
    await expect(sheet.locator('button[aria-label^="Step actions for"]')).toHaveCount(1);
    const phoneField = sheet
      .locator(".step-focused__fieldset input, .step-focused__fieldset textarea")
      .first();
    await expect(phoneField).toBeEnabled();
    await p.screenshot({ path: evidencePath("HEL-1794", "editor-phone-dark.png") });

    // The role is not known until the analyze response lands: no edit control is offered while it is held, then they appear.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await p.route(`**/api/pipelines/${pipelineId}/analyze*`, async (route) => {
      await gate;
      await route.continue();
    });
    await p.setViewportSize(DESKTOP);
    await p.goto(`/pipelines/${pipelineId}`);
    await expect(p.getByText("hel1661-orders").first()).toBeVisible();
    await expect(p.getByRole("button", { name: "Edit pipeline name" })).toHaveCount(0);
    await expect(p.getByRole("button", { name: "New output" })).toHaveCount(0);
    await p.screenshot({ path: evidencePath("HEL-1794", "editor-pending.png") });
    release();
    await expect(p.getByRole("button", { name: "Edit pipeline name" })).toBeVisible();
    await expect(p.getByRole("button", { name: "New output" })).toBeVisible();
    await p.screenshot({ path: evidencePath("HEL-1794", "editor-resolved.png") });

    await editor.context.close();
    await viewer.context.close();
  });
});
