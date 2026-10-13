import { expect, type APIRequestContext } from "@playwright/test";

/**
 * Cleanup delete of one exact id, with its status checked (HEL-1440). Soft: a wrong status records a failure
 * without throwing, so a cleanup problem is reported but never masks the error that sent the test body to `finally`
 * (and a later cleanup delete still runs). Every DELETE the specs use answers `204`.
 */
export async function expectDeleted(
  request: APIRequestContext,
  path: string,
  headers: Record<string, string>,
): Promise<void> {
  const res = await request.delete(path, { headers });
  expect.soft(res.status(), `cleanup DELETE ${path}`).toBe(204);
}
