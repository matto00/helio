import { expect, test, type APIRequestContext } from "@playwright/test";

import { currentUserId, registerUser } from "./support/auth";
import { setUserTierForTest } from "./support/historySeed";
import { loginThenIsolate } from "./support/isolateLivePage";

// HEL-1743 -- the real render trigger path on a real build. The e2e backend has no model API key, and a fake model inside the
// production backend is refused, so no `ok` render can be produced here (the psql seed in support/insightSeed.ts stays for
// `ok` states). What CAN be proven end to end is the trigger plumbing, which keyless degrades to a no-model `failed` attempt:
//   * a real run of a pipeline with an on_run insight records a `failed` attempt (nothing was sent, nobody was charged);
//   * the panel shows the failed state with a Refresh button for the owner; pressing it posts the refresh (202), shows the
//     rendering state, and ends with the newest attempt re-read;
//   * `{"trigger":"pin"}` records the newest attempt with trigger `pin`, and a body of anything else is a 400.
// Throwaway users are recorded by registerUser and deleted by exact id in the run's global teardown.

const CSRF = { "X-Helio-Requested-With": "1" };

async function api<T>(
  request: APIRequestContext,
  method: "post" | "get",
  url: string,
  data: unknown,
  status: number,
): Promise<T> {
  const res =
    method === "post"
      ? await request.post(url, { data, headers: CSRF })
      : await request.get(url, { headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(status);
  return (await res.json()) as T;
}

interface InsightRead {
  canRefresh: boolean;
  render: unknown;
  lastAttempt: { id: string; status: string; trigger: string; createdAt: string } | null;
}

test("insight refresh: run trigger, panel Refresh button, pin trigger (keyless backend)", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const credentials = await registerUser(request, {
    prefix: "hel1743",
    label: "refresh",
    displayName: "HEL-1743",
    logEmail: false,
  });
  const userId = await currentUserId(request);
  console.log(
    `[HEL-1743 e2e] created user ${userId}; tier set for ${setUserTierForTest(userId, "beta")}`,
  );
  await loginThenIsolate(page, credentials);

  const source = await api<{ id: string }>(
    request,
    "post",
    "/api/data-sources",
    {
      name: "HEL-1743 orders",
      type: "static",
      columns: [{ name: "amount", type: "integer" }],
      rows: [[10], [20]],
    },
    201,
  );
  const pipeline = await api<{ id: string }>(
    request,
    "post",
    "/api/pipelines",
    { name: "HEL-1743 pipeline", roots: [{ sourceId: source.id }] },
    201,
  );
  const insight = await api<{ id: string }>(
    request,
    "post",
    `/api/pipelines/${pipeline.id}/outputs`,
    { kind: "insight", name: "HEL-1743 insight", config: {} },
    201,
  );
  // Creating an insight renders nothing: no run, pin or refresh has happened yet.
  const before = await api<InsightRead>(
    request,
    "get",
    `/api/outputs/${insight.id}/insight`,
    undefined,
    200,
  );
  expect(before.lastAttempt).toBeNull();
  expect(before.canRefresh).toBe(true);

  // A real run triggers the render asynchronously; keyless, it records a no-model failed attempt.
  await api(request, "post", `/api/pipelines/${pipeline.id}/run`, {}, 200);
  await expect
    .poll(
      async () =>
        (
          await api<InsightRead>(
            request,
            "get",
            `/api/outputs/${insight.id}/insight`,
            undefined,
            200,
          )
        ).lastAttempt?.status,
      { timeout: 30_000 },
    )
    .toBe("failed");

  const dashboard = await api<{ id: string }>(
    request,
    "post",
    "/api/dashboards",
    { name: "HEL-1743 board" },
    201,
  );
  await api(
    request,
    "post",
    "/api/panels",
    {
      dashboardId: dashboard.id,
      title: "HEL-1743 insight panel",
      type: "output",
      config: { outputId: insight.id },
    },
    201,
  );
  await page.goto(`/dashboards/${dashboard.id}`);
  const card = page
    .locator("article.panel-grid-card")
    .filter({ hasText: "HEL-1743 insight panel" });
  await expect(card.getByText("The last update failed")).toBeVisible({ timeout: 20_000 });
  const refreshButton = card.getByRole("button", { name: "Update insight" });
  await expect(refreshButton).toBeEnabled();

  const posted = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/outputs/${insight.id}/insight/refresh`) &&
      r.request().method() === "POST",
  );
  await refreshButton.click();
  expect((await posted).status()).toBe(202);
  await expect(refreshButton).toBeEnabled({ timeout: 30_000 });
  await expect(card.getByText("The last update failed")).toBeVisible();

  // Pin: exactly the newest attempt carries trigger `pin`; another body value is refused.
  await api(
    request,
    "post",
    `/api/outputs/${insight.id}/insight/refresh`,
    { trigger: "daily" },
    400,
  );
  await api(request, "post", `/api/outputs/${insight.id}/insight/refresh`, { trigger: "pin" }, 202);
  await expect
    .poll(
      async () =>
        (
          await api<InsightRead>(
            request,
            "get",
            `/api/outputs/${insight.id}/insight`,
            undefined,
            200,
          )
        ).lastAttempt?.trigger,
      { timeout: 30_000 },
    )
    .toBe("pin");
});
