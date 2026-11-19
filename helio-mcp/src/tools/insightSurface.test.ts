/**
 * HEL-1747 -- the insight MCP surface: `insight` in every kind enum (and a drift guard against the
 * backend schema), the config docs, `place_outputs` kind-agnosticism, and the three new tools
 * (`get_output_insight`, `refresh_insight`, `ask_dashboard`) driven through the real server.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  connectMcp,
  resultText,
  type FakeFetch,
  type McpHarness,
} from "../testing/mcpFetchHarness.js";
import { OUTPUT_KINDS } from "./outputKinds.js";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SRC_ROOT = path.resolve(__dirname, "..");

interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

function recorder(responses: Record<string, { status: number; body: unknown }>) {
  const calls: Recorded[] = [];
  const fake: FakeFetch = (url, init) => {
    const parsed = new URL(url);
    const key = `${init.method} ${parsed.pathname}`;
    calls.push({
      method: String(init.method),
      path: parsed.pathname,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const hit = responses[key];
    if (!hit) return { status: 500, body: { message: `unexpected ${key}` } };
    return hit;
  };
  return { fake, calls };
}

async function listTools(h: McpHarness) {
  return (await h.client.listTools()).tools;
}

/** Every `enum` array reachable in a JSON schema value. */
function collectEnums(node: unknown, out: string[][] = []): string[][] {
  if (Array.isArray(node)) {
    for (const n of node) collectEnums(n, out);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "enum" && Array.isArray(v)) out.push(v as string[]);
      else collectEnums(v, out);
    }
  }
  return out;
}

function kindEnums(schema: unknown): string[][] {
  return collectEnums(schema).filter((e) => e.includes("timeline") && e.includes("markdown"));
}

describe("Output kind enums (HEL-1747 D5)", () => {
  it("OUTPUT_KINDS equals the backend schema's kind enum", () => {
    const schema = JSON.parse(
      readFileSync(
        path.join(
          REPO_ROOT,
          "schemas/pipelines/create-pipeline-transactional-output-request.schema.json",
        ),
        "utf8",
      ),
    ) as { properties: { kind: { enum: string[] } } };

    expect([...OUTPUT_KINDS].sort()).toEqual([...schema.properties.kind.enum].sort());
    expect(OUTPUT_KINDS).toContain("insight");
  });

  it("no helio-mcp source file re-inlines a kind enum literal", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".test.ts") &&
          entry.name !== "outputKinds.ts"
        ) {
          if (/"timeline",\s*"markdown"/.test(readFileSync(full, "utf8"))) offenders.push(full);
        }
      }
    };
    walk(SRC_ROOT);

    expect(offenders).toEqual([]);
  });

  it.each([
    ["add_output"],
    ["add_outputs_from_shape"],
    ["create_pipeline"],
    ["analyze_pipeline_proposal"],
    ["apply_pipeline_proposal"],
    ["propose_pipeline"],
    ["apply_combined_proposal"],
  ])("%s accepts the insight kind and nothing but the backend's kinds", async (toolName) => {
    const h = await connectMcp(() => ({ status: 500, body: {} }));
    try {
      const tool = (await listTools(h)).find((t) => t.name === toolName);
      const enums = kindEnums(tool?.inputSchema);

      expect(enums.length).toBeGreaterThan(0);
      for (const e of enums) expect([...e].sort()).toEqual([...OUTPUT_KINDS].sort());
    } finally {
      await h.close();
    }
  });

  it("add_output with kind insight issues one POST with that kind", async () => {
    const { fake, calls } = recorder({
      "POST /api/pipelines/p-1/outputs": { status: 201, body: { id: "o-1", kind: "insight" } },
    });
    const h = await connectMcp(fake);
    try {
      const result = await h.client.callTool({
        name: "add_output",
        arguments: {
          pipelineId: "p-1",
          kind: "insight",
          name: "Why",
          config: { refresh: "manual" },
        },
      });

      expect((result as { isError?: boolean }).isError).toBeFalsy();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.body).toMatchObject({ kind: "insight", name: "Why" });
    } finally {
      await h.close();
    }
  });
});

describe("insight config docs (HEL-1747 D6)", () => {
  async function descriptions(): Promise<Map<string, string>> {
    const h = await connectMcp(() => ({ status: 500, body: {} }));
    try {
      return new Map((await listTools(h)).map((t) => [t.name, t.description ?? ""]));
    } finally {
      await h.close();
    }
  }

  it("add_output and update_output document the stored-ids rule and that creation does not render", async () => {
    const d = await descriptions();
    for (const name of ["add_output", "update_output"]) {
      const text = d.get(name) ?? "";
      expect(text).toContain("`reads.outputs` names STORED ids of other non-insight Outputs");
      expect(text).toContain("does not render");
      for (const key of ["preset", "prompt", "maxSentences", "maxChars", "refresh", "model"]) {
        expect(text).toContain(`\`${key}\``);
      }
    }
  });

  it.each([
    "create_pipeline",
    "propose_pipeline",
    "analyze_pipeline_proposal",
    "apply_pipeline_proposal",
    "apply_combined_proposal",
  ])("%s says a non-empty insight reads.outputs is rejected on a new pipeline", async (name) => {
    const d = await descriptions();

    expect(d.get(name)).toContain(
      "any non-empty insight `reads.outputs` is rejected (400) because a brand-new pipeline has no stored Output to read",
    );
  });

  it("the keys doc lists the insight keys", async () => {
    const d = await descriptions();

    expect(d.get("create_pipeline")).toContain("insight: `preset`");
  });
});

describe("place_outputs is kind-agnostic (HEL-1747)", () => {
  it("places an insight Output by outputId only", async () => {
    const { fake, calls } = recorder({
      "POST /api/panels/batch": { status: 201, body: { panels: [] } },
    });
    const h = await connectMcp(fake);
    try {
      await h.client.callTool({
        name: "place_outputs",
        arguments: { dashboardId: "d-1", items: [{ outputId: "insight-out-1", title: "Why" }] },
      });

      expect(calls).toEqual([
        {
          method: "POST",
          path: "/api/panels/batch",
          body: {
            dashboardId: "d-1",
            panels: [{ title: "Why", type: "output", config: { outputId: "insight-out-1" } }],
          },
        },
      ]);
    } finally {
      await h.close();
    }
  });
});

describe("get_output_insight", () => {
  const body = {
    outputId: "o-1",
    render: { id: "r1", markdown: "Up [c1].", citations: [{ id: "c1" }], trigger: "manual" },
    lastAttempt: { id: "r1", status: "ok", trigger: "manual", createdAt: "x" },
    canRefresh: true,
  };

  it("issues one GET and returns the body unchanged", async () => {
    const { fake, calls } = recorder({
      "GET /api/outputs/o-1/insight": { status: 200, body },
    });
    const h = await connectMcp(fake);
    try {
      const result = await h.client.callTool({
        name: "get_output_insight",
        arguments: { outputId: "o-1" },
      });

      expect(calls).toEqual([{ method: "GET", path: "/api/outputs/o-1/insight", body: undefined }]);
      expect(JSON.parse(resultText(result))).toEqual(body);
    } finally {
      await h.close();
    }
  });

  it("surfaces a 404 as a tool error and issues no other request", async () => {
    const { fake, calls } = recorder({
      "GET /api/outputs/o-1/insight": { status: 404, body: { message: "Output not found" } },
    });
    const h = await connectMcp(fake);
    try {
      const result = await h.client.callTool({
        name: "get_output_insight",
        arguments: { outputId: "o-1" },
      });

      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(resultText(result)).toContain("404");
      expect(calls).toHaveLength(1);
    } finally {
      await h.close();
    }
  });

  it("describes the role-shaped read and that it never renders", async () => {
    const h = await connectMcp(() => ({ status: 500, body: {} }));
    try {
      const text = (await listTools(h)).find((t) => t.name === "get_output_insight")?.description;

      expect(text).toContain("role-shaped");
      expect(text).toContain("canRefresh");
      expect(text).toContain("never renders");
      expect(text).toContain("not_updated");
    } finally {
      await h.close();
    }
  });
});

describe("refresh_insight", () => {
  it("issues one POST with no body and returns {outputId, started}", async () => {
    const { fake, calls } = recorder({
      "POST /api/outputs/o-1/insight/refresh": {
        status: 202,
        body: { outputId: "o-1", started: true },
      },
    });
    const h = await connectMcp(fake);
    try {
      const result = await h.client.callTool({
        name: "refresh_insight",
        arguments: { outputId: "o-1" },
      });

      expect(calls).toEqual([
        { method: "POST", path: "/api/outputs/o-1/insight/refresh", body: undefined },
      ]);
      expect(JSON.parse(resultText(result))).toEqual({ outputId: "o-1", started: true });
    } finally {
      await h.close();
    }
  });

  it("exposes no trigger argument and documents the asynchronous contract", async () => {
    const h = await connectMcp(() => ({ status: 500, body: {} }));
    try {
      const tool = (await listTools(h)).find((t) => t.name === "refresh_insight");

      expect(Object.keys((tool?.inputSchema as { properties: object }).properties)).toEqual([
        "outputId",
      ]);
      expect(tool?.description).toContain("asynchronous");
      expect(tool?.description).toContain("started: false");
      expect(tool?.description).toContain("429");
      expect(tool?.description).toContain("403");
    } finally {
      await h.close();
    }
  });
});

describe("ask_dashboard", () => {
  const answer = {
    answer: "Revenue is 10 [c1].",
    citations: [{ id: "c1", outputId: "o-1", field: "amount", number: 10, isPct: false }],
    citedOutputs: [{ id: "o-1", name: "Revenue" }],
    pin: null,
  };

  it("issues one POST whose body is exactly {question} and returns the answer", async () => {
    const { fake, calls } = recorder({
      "POST /api/dashboards/d-1/ask": { status: 200, body: answer },
    });
    const h = await connectMcp(fake);
    try {
      const result = await h.client.callTool({
        name: "ask_dashboard",
        arguments: { dashboardId: "d-1", question: "How is revenue?" },
      });

      expect(calls).toEqual([
        { method: "POST", path: "/api/dashboards/d-1/ask", body: { question: "How is revenue?" } },
      ]);
      expect(JSON.parse(resultText(result))).toEqual(answer);
    } finally {
      await h.close();
    }
  });

  it.each([
    ["empty", ""],
    ["2001 characters", "x".repeat(2001)],
  ])("rejects a %s question before any request", async (_label, question) => {
    const { fake, calls } = recorder({});
    const h = await connectMcp(fake);
    try {
      const result = await h.client.callTool({
        name: "ask_dashboard",
        arguments: { dashboardId: "d-1", question },
      });

      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(calls).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it("takes no model argument and documents pin and the error bodies", async () => {
    const h = await connectMcp(() => ({ status: 500, body: {} }));
    try {
      const tool = (await listTools(h)).find((t) => t.name === "ask_dashboard");
      const props = Object.keys((tool?.inputSchema as { properties: object }).properties).sort();

      expect(props).toEqual(["dashboardId", "question"]);
      for (const needle of [
        "ASK_UNGROUNDED",
        "ASK_ANSWER_TRUNCATED",
        "TIER_FORBIDDEN",
        "CHAT_LIMIT_REACHED",
        "503",
        "404",
        "pin.request",
        "add_output",
        "nothing is persisted",
      ]) {
        expect(tool?.description).toContain(needle);
      }
    } finally {
      await h.close();
    }
  });

  it("surfaces a 422 ASK_UNGROUNDED as a tool error", async () => {
    const { fake } = recorder({
      "POST /api/dashboards/d-1/ask": {
        status: 422,
        body: { code: "ASK_UNGROUNDED", message: "not grounded", reasons: ["a"] },
      },
    });
    const h = await connectMcp(fake);
    try {
      const result = await h.client.callTool({
        name: "ask_dashboard",
        arguments: { dashboardId: "d-1", question: "q" },
      });

      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(resultText(result)).toContain("422");
    } finally {
      await h.close();
    }
  });
});
