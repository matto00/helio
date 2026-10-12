/**
 * HEL-1458: `apply_patch_set` keeps `target.fingerprint` through input validation and surfaces a 409
 * `PATCH_SET_STALE` as a tool error that names the stale targets. Goes through a real `callTool`, because
 * zod silently strips keys the input schema does not declare.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { HelioApiError } from "../httpClient.js";
import type { HelioApi } from "../helioApi.js";
import type { PatchSet } from "../types.js";
import { createServer } from "../server.js";

const stamped: PatchSet = {
  edits: [
    {
      target: { kind: "panel", id: "panel-1", fingerprint: "v1:abc" },
      op: "update",
      patch: { title: "New" },
    },
  ],
};

async function callApply(applyPatchSet: (p: PatchSet) => Promise<unknown>) {
  const server = createServer({ applyPatchSet } as unknown as HelioApi);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await client.callTool({ name: "apply_patch_set", arguments: { patchSet: stamped } });
  } finally {
    await client.close();
    await server.close();
  }
}

describe("apply_patch_set stale-target handling", () => {
  it("forwards target.fingerprint to the apply call unchanged", async () => {
    let received: PatchSet | undefined;
    await callApply(async (p) => {
      received = p;
      return { edits: [] };
    });

    expect(received?.edits[0]?.target.fingerprint).toBe("v1:abc");
  });

  it("reports a 409 as an error result naming the status and every stale target", async () => {
    const message =
      "409 Conflict: Nothing was applied: changed since the preview: edit 0 (panel panel-1). Preview the patch set again before applying.";
    const result = await callApply(async () => {
      throw new HelioApiError(409, "http://helio.test/api/patch-sets/apply", message);
    });

    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("status 409");
    expect(text).toContain("edit 0 (panel panel-1)");
  });
});
