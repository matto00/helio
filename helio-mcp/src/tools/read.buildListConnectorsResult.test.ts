/**
 * HEL-886 tasks.md 4.5 — `buildListConnectorsResult` (design.md Decision 5): an empty list
 * yields a second text block naming `create_connector`; a non-empty list yields exactly one
 * content block, unchanged from before this ticket.
 */

import type { ConnectorSummary } from "../types.js";
import { buildListConnectorsResult } from "./read.js";

describe("buildListConnectorsResult (HEL-886 design.md Decision 5)", () => {
  it("an empty list yields the bare-array JSON block plus a hint block naming create_connector", () => {
    const result = buildListConnectorsResult([]);

    expect(result.content).toHaveLength(2);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual([]);
    expect((result.content[1] as { text: string }).text).toContain("create_connector");
  });

  it("a non-empty list yields exactly one content block and no hint", () => {
    const items: ConnectorSummary[] = [
      { id: "conn-1", name: "Sleeper", kind: "rest_api", host: "https://api.sleeper.app" },
    ];

    const result = buildListConnectorsResult(items);

    expect(result.content).toHaveLength(1);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(items);
  });
});
