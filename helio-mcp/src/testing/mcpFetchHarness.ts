/**
 * Test harness (HEL-1747): the real `createServer` over an in-memory MCP client, backed by the
 * real `HelioApi`/`HelioHttpClient` with an injected `fetch`. Tests supply the `fetch`.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HelioApi } from "../helioApi.js";
import { HelioHttpClient, type HelioRequestInit } from "../httpClient.js";
import type { HelioConfig } from "../config.js";
import { createServer } from "../server.js";

export const HARNESS_BASE_URL = "https://helio.test";

export interface FakeResponse {
  status: number;
  body: unknown;
}

export type FakeFetch = (url: string, init: HelioRequestInit) => FakeResponse;

export interface McpHarness {
  client: Client;
  close(): Promise<void>;
}

export async function connectMcp(fake: FakeFetch): Promise<McpHarness> {
  const config = { baseUrl: HARNESS_BASE_URL, pat: "pat-test" } as HelioConfig;
  const fetchImpl = (url: string, init: HelioRequestInit) => {
    const { status, body } = fake(url, init);
    return Promise.resolve({
      status,
      statusText: String(status),
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response);
  };
  const api = new HelioApi(new HelioHttpClient(config, { fetchImpl }));
  const server = createServer(api);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** The text of a tool result (the tools return one JSON text block). */
export function resultText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("");
}
