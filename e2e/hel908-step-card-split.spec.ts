import { expect, test } from "@playwright/test";

// HEL-908 — live verification of the HEL-682 `PipelineDetailPage.tsx` /
// `StepCard.tsx` split (tasks 3.1/3.2), a strictly behavior-preserving
// refactor extracting `usePipelineDetailPage`, `useStepCardPreview`, and
// `StepOpEditor`. Exercises the two named historical invariants the split
// was required to preserve exactly:
//
// - F-105: the debounced re-analyze effect must not double-fire on initial
//   step seeding (one `/analyze` call on page load, not two).
// - F-146: drag/keyboard reorder must not cascade-rerender every StepCard —
//   verified functionally here (reorder + duplicate + toggle all still work
//   against the real backend) since render-count instrumentation isn't
//   wired into this production build.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel908-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

test.describe("HEL-908 PipelineDetailPage/StepCard split live verification", () => {
  test("initial load fires /analyze once; reorder/duplicate/toggle/run all work", async ({
    page,
  }) => {
    const email = uniqueEmail("split");
    const password = "correcthorsebattery1";

    // Registering here already establishes a session cookie (same as
    // logging in) — going to /login afterward would redirect an already-
    // authenticated session straight back out, detaching the form mid-fill.
    // Just register and rely on the cookie for subsequent navigation.
    const registerRes = await page.request.post("/api/auth/register", {
      data: { email, password, displayName: "HEL-908 E2E" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(registerRes.status()).toBe(201);

    const sourceRes = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-908 Sales",
        type: "static",
        columns: [{ name: "amount", type: "integer" }],
        rows: [[10], [20], [30]],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(sourceRes.status()).toBe(201);
    const source = await sourceRes.json();

    const pipelineRes = await page.request.post("/api/pipelines", {
      data: {
        name: "HEL-908 Split Verification",
        sourceDataSourceId: source.id,
        outputDataTypeName: "HEL-908 Split Output",
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = await pipelineRes.json();

    const step1Res = await page.request.post(`/api/pipelines/${pipeline.id}/steps`, {
      data: { type: "limit", config: { count: 2 } },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(step1Res.status()).toBe(201);
    const step2Res = await page.request.post(`/api/pipelines/${pipeline.id}/steps`, {
      data: { type: "sort", config: { sortBy: [{ field: "amount", direction: "asc" }] } },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(step2Res.status()).toBe(201);
    const step2 = await step2Res.json();

    // F-105 — count /analyze calls from page load through settle. The mount
    // effect fires one immediate call; the debounced re-analyze effect must
    // treat the persisted-steps seeding as a no-op (skipNextAnalyzeRef), not
    // a second, duplicate call ~300ms later.
    let analyzeCallCount = 0;
    page.on("request", (req) => {
      if (req.url().includes(`/api/pipelines/${pipeline.id}/analyze`) && req.method() === "GET") {
        analyzeCallCount += 1;
      }
    });

    await page.goto(`/pipelines/${pipeline.id}`);
    await expect(page.getByText("Limit").first()).toBeVisible();
    // Settle past the 300ms debounce window with margin.
    await page.waitForTimeout(800);
    expect(analyzeCallCount).toBe(1);

    // F-146 functional check — duplicate the sort step, then move it up,
    // then toggle it disabled/enabled. Each of these round-trips through the
    // page-owned handlers extracted into usePipelineDetailPage.
    const stepCards = page.locator(".pipeline-detail-page__step-card");
    await expect(stepCards).toHaveCount(2);

    await page.locator(".pipeline-detail-page__step-card-duplicate-btn").nth(1).click();
    await expect(stepCards).toHaveCount(3);

    await page.getByRole("button", { name: "Move step up" }).nth(2).click();
    await expect(stepCards).toHaveCount(3);

    const disableButtons = page.getByRole("button", { name: "Disable step" });
    await disableButtons.first().click();
    await expect(page.getByRole("button", { name: "Enable step" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Enable step" }).first().click();
    await expect(disableButtons.first()).toBeVisible();

    // Run the pipeline end to end — exercises handleRunPipeline/SSE wiring
    // extracted into the hook.
    await page.getByRole("button", { name: /run pipeline/i }).click();
    await expect(page.getByLabel(/run status: succeeded/i)).toBeVisible({ timeout: 15000 });

    void step2; // referenced above only for the request assertion
  });
});
