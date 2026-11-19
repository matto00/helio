/**
 * HEL-1747 -- the epic's agent exit criterion, scripted end to end with NO live model: an agent adds an
 * insight Output to an existing pipeline, refreshes it, reads a cited narrative, places it on a dashboard,
 * asks that dashboard a question and pins the answer.
 *
 * The real MCP server runs over an in-memory MCP client. The only fake is the Helio backend: every body it
 * answers is a leg RECORDED from the real routes (with a scripted model) by the backend's `InsightSeamSpec`
 * into `shared-test-fixtures/insight/exit-criterion.json`. The fake answers ONLY those legs, in order, and
 * fails the test on any unrecorded or out-of-order request. Each request MCP sends must equal the recorded one.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { connectMcp, resultText, type FakeFetch } from "./testing/mcpFetchHarness.js";

interface Leg {
  name: string;
  method: string;
  path: string;
  request?: unknown;
  status: number;
  response: unknown;
}

const fixture = JSON.parse(
  readFileSync(
    path.resolve(__dirname, "../../shared-test-fixtures/insight/exit-criterion.json"),
    "utf8",
  ),
) as { legs: Leg[] };

/** `{{OUTPUT_INSIGHT}}` -> `id-output-insight`: one concrete id per placeholder for the whole test. */
function concrete<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value).replace(
      /\{\{([A-Z0-9_]+)\}\}/g,
      (_m, name: string) => `id-${name.toLowerCase()}`,
    ),
  ) as T;
}

const legs = concrete(fixture.legs);

interface Cited {
  id: string;
  outputId?: string;
}

/** The fields of the tool results the script reads; everything else is compared through the recorded legs. */
interface ToolBody {
  id: string;
  kind: string;
  started?: boolean;
  outputId?: string;
  render: { citations: Cited[]; markdown: string };
  citations: Cited[];
  answer: string;
  pin: { pipelineId: string; request: Record<string, unknown> } | null;
}

function leg(name: string): Leg {
  const found = legs.find((l) => l.name === name);
  if (!found) throw new Error(`no recorded leg ${name}`);
  return found;
}

describe("agent exit criterion: insight Output, cited narrative, ask a dashboard (HEL-1747)", () => {
  it("replays the six recorded legs through the real MCP server and refuses anything else", async () => {
    const failures: string[] = [];
    let next = 0;
    const fake: FakeFetch = (url, init) => {
      const parsed = new URL(url);
      const body = init.body === undefined ? undefined : JSON.parse(String(init.body));
      const expected = legs[next];
      if (
        !expected ||
        expected.method !== init.method ||
        expected.path !== parsed.pathname ||
        !isDeepEqual(expected.request, body)
      ) {
        failures.push(
          `unrecorded or out-of-order request #${next}: ${String(init.method)} ${parsed.pathname} ${JSON.stringify(body)}` +
            ` (expected ${expected ? `${expected.method} ${expected.path} ${JSON.stringify(expected.request)}` : "none"})`,
        );
        return { status: 500, body: { message: "unrecorded request" } };
      }
      next += 1;
      return { status: expected.status, body: expected.response };
    };
    const h = await connectMcp(fake);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await h.client.callTool({ name, arguments: args });
      expect({ tool: name, isError: (result as { isError?: boolean }).isError ?? false }).toEqual({
        tool: name,
        isError: false,
      });
      return JSON.parse(resultText(result)) as ToolBody;
    };

    try {
      const add = leg("add-insight-output");
      const created = await call("add_output", {
        pipelineId: "id-pipeline_1",
        ...(add.request as object),
      });
      expect(created).toEqual(add.response);

      const refresh = await call("refresh_insight", { outputId: created.id });
      expect(refresh).toEqual(leg("refresh-insight").response);

      const read = await call("get_output_insight", { outputId: created.id });
      expect(read).toEqual(leg("get-insight").response);
      expect(read.render.citations.length).toBeGreaterThanOrEqual(1);
      // The narrative is about what the insight reads: some citation belongs to Revenue.
      expect(read.render.citations.map((c) => c.outputId)).toContain("id-output_revenue");
      for (const c of read.render.citations) {
        expect(read.render.markdown).toContain(`[${c.id}]`);
      }

      // No w/h on a placement: a size hint adds an auto-layout request that is not a recorded leg.
      const placed = await call("place_outputs", {
        dashboardId: "id-dashboard_1",
        items: [{ outputId: created.id, title: "Revenue narrative" }],
      });
      expect(placed).toEqual(leg("place-insight").response);

      const asked = await call("ask_dashboard", {
        dashboardId: "id-dashboard_1",
        question: (leg("ask-dashboard").request as { question: string }).question,
      });
      expect(asked).toEqual(leg("ask-dashboard").response);
      expect(asked.citations.length).toBeGreaterThanOrEqual(1);
      const pin = asked.pin;
      if (pin === null) throw new Error("the recorded ask carries no pin");
      for (const c of asked.citations) {
        expect(asked.answer).toContain(`[${c.id}]`);
      }

      const pinned = await call("add_output", {
        pipelineId: pin.pipelineId,
        ...pin.request,
      });
      expect(pinned).toEqual(leg("pin-answer").response);
    } finally {
      await h.close();
    }

    expect(failures).toEqual([]);
    expect(next).toBe(legs.length);
  });
});

function isDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a ?? null)) === JSON.stringify(sortKeys(b ?? null));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  }
  return v;
}
