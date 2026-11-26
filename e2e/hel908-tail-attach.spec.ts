import { expect, type Page, test } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import {
  AUTH,
  COMPUTE,
  DRAFT_TEXT,
  FILTER,
  LIMIT,
  openDraft,
  openPipeline,
  pickStep,
  seed,
  stepMenu,
} from "./support/hel1684-draft-structural";
import { editorAction, rowMenuItem, selectRow, spineRows } from "./support/pipelineSpine";

// HEL-908 added the "tail" (a step branching off a trunk step); HEL-912 generalised it to several lanes per step, and the
// step editor has been a draft since HEL-1631/1685/1684. HEL-1542 rewrote these four probes (quarantined since HEL-951) for
// today's editor. Every structural action happens in a DRAFT, and every test asserts the tree twice [C1]: in the draft,
// before Save & run (the without-reload class HEL-908 existed for, now the client's draft replay), and after Save & run plus a
// reload (the server's persisted tree). A tail is a step in a nested lane under its owner's row (`.spine-lane--sub`).
// Seed (support/hel1684-draft-structural.ts): trunk Filter -> Sort -> Compute, 14 rows.

const SORT = "Sort rows";
const RENAME = "Rename column";

/** The spine in document order, each row's title indented two spaces per lane it sits in (a tail is one lane deep). */
async function tree(page: Page): Promise<string[]> {
  return spineRows(page).evaluateAll((rows) =>
    rows.map((row) => {
      let depth = 0;
      for (let e: Element | null = row.parentElement; e; e = e.parentElement) {
        if (e.classList.contains("spine-lane--sub")) depth++;
      }
      return `${"  ".repeat(depth)}${row.querySelector(".spine-row__title")?.textContent ?? ""}`;
    }),
  );
}

/** Starts a draft on a fresh pipeline (Filter, Sort, Compute) and returns its id. */
async function startDraft(
  page: Page,
  request: Parameters<typeof registerAndLogin>[1],
  label: string,
) {
  const creds = await registerAndLogin(page, request, { ...AUTH, prefix: "hel908", label });
  const { pipelineId } = await seed(page, creds.email);
  await openPipeline(page, pipelineId, "light");
  await openDraft(page, "desktop");
  return pipelineId;
}

/** Adds a step in a lane under the nth row ("Branch from here"). */
async function addTail(page: Page, rowIndex: number, kind: string): Promise<void> {
  await stepMenu(page, "desktop", rowIndex, "Branch from here");
  await pickStep(page, kind);
}

/** Save & run, going through the removal confirmation when the draft removes something; ends with the draft gone. */
async function save(page: Page, confirmRemovals: boolean): Promise<void> {
  const saved = page.waitForResponse(
    (r) => r.url().includes("/draft/save") && r.request().method() === "POST" && r.status() === 200,
  );
  await page.getByRole("button", { name: "Save and run" }).click();
  if (confirmRemovals) {
    const dialog = page.getByRole("dialog", { name: "Confirm removals" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Remove and save" }).click();
  }
  await saved;
  await expect(page.getByText(DRAFT_TEXT)).toHaveCount(0);
}

/** The persisted tree: reload and wait for the spine. */
async function reloaded(page: Page): Promise<string[]> {
  await page.reload();
  await expect(spineRows(page).first()).toBeVisible();
  await expect(page.getByText(DRAFT_TEXT)).toHaveCount(0);
  return tree(page);
}

test.describe("HEL-908 tail-attach live verification (rewritten for the draft editor, HEL-1542)", () => {
  test.setTimeout(120_000);
  test.use({ viewport: { width: 1280, height: 800 }, actionTimeout: 15_000 });

  test("a trunk step can carry several tails, and adding one keeps the add affordance", async ({
    page,
    request,
  }) => {
    await startDraft(page, request, "several-tails");
    expect(await tree(page)).toEqual([FILTER, SORT, COMPUTE]);

    await addTail(page, 0, "limit");
    // The tail nests under Filter; the trunk stays three cards (the pre-HEL-912 one-tail-per-step rule is gone).
    const oneTail = [FILTER, `  ${LIMIT}`, SORT, COMPUTE];
    expect(await tree(page)).toEqual(oneTail);
    // Adding a tail does not consume the affordance: Filter's menu still offers it, enabled.
    await expect(await rowMenuItem(page, 0, "Branch from here")).toBeEnabled();
    await page.keyboard.press("Escape");

    await addTail(page, 0, "rename");
    const twoTails = [FILTER, `  ${LIMIT}`, `  ${RENAME}`, SORT, COMPUTE];
    expect(await tree(page)).toEqual(twoTails);
    await expect(page.getByText(DRAFT_TEXT).first()).toBeVisible();

    await save(page, false);
    expect(await reloaded(page)).toEqual(twoTails);
  });

  test("a leaf tail follows its true owner after a later trunk append", async ({
    page,
    request,
  }) => {
    await startDraft(page, request, "append-after-tail");
    // Compute is the leaf of the trunk; a tail off it nests under Compute.
    await addTail(page, 2, "limit");
    expect(await tree(page)).toEqual([FILTER, SORT, COMPUTE, `  ${LIMIT}`]);

    // Appending a trunk step after Compute re-homes Compute's tail onto the new step.
    await page.getByRole("button", { name: "+ Add transformation step" }).click();
    await pickStep(page, "rename");
    const afterAppend = [FILTER, SORT, COMPUTE, RENAME, `  ${LIMIT}`];
    expect(await tree(page)).toEqual(afterAppend);

    await save(page, false);
    expect(await reloaded(page)).toEqual(afterAppend);
  });

  test("duplicating a tailed trunk step keeps the tail on the clone", async ({ page, request }) => {
    await startDraft(page, request, "duplicate-tailed");
    await addTail(page, 0, "limit");
    expect(await tree(page)).toEqual([FILTER, `  ${LIMIT}`, SORT, COMPUTE]);

    await selectRow(page, 0);
    await editorAction(page, "Duplicate step").click();
    // The clone sits right after Filter and takes the tail: the original Filter has none.
    const duplicated = [FILTER, FILTER, `  ${LIMIT}`, SORT, COMPUTE];
    await expect.poll(() => tree(page)).toEqual(duplicated);

    await save(page, false);
    expect(await reloaded(page)).toEqual(duplicated);
  });

  test("removing a step that owns both a head child and a tail drops the cascade-deleted tail", async ({
    page,
    request,
  }) => {
    await startDraft(page, request, "remove-owner");
    // Filter owns its head child (Sort) and, after this, a tail (Limit).
    await addTail(page, 0, "limit");
    expect(await tree(page)).toEqual([FILTER, `  ${LIMIT}`, SORT, COMPUTE]);

    await selectRow(page, 0);
    await editorAction(page, "Remove step").click();
    // Sort takes Filter's place; the tail goes with it and is not promoted to a trunk card.
    const removed = [SORT, COMPUTE];
    await expect.poll(() => tree(page)).toEqual(removed);
    await expect(spineRows(page).filter({ hasText: LIMIT })).toHaveCount(0);

    await save(page, true);
    expect(await reloaded(page)).toEqual(removed);
  });
});
