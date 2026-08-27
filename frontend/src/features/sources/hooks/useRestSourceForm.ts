// HEL-827: lifts all REST source form field state out of AddSourceModal.tsx
// (design.md Decision 5) and owns the single shared REST-config composer
// (design.md Decision 1a) used by all three call sites that build a REST
// config: RestApiForm's TestConnectionAffordance, AddSourceModal.handlePreview,
// and AddSourceModal.handleSubmit/handleCreate.

import { useMemo, useState } from "react";

import type { Connector } from "../../connectors/types/connector";
import type { RestApiConfigBody } from "../services/dataSourceService";

export interface KeyValueEntry {
  key: string;
  value: string;
}

const HTTP_METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH"];
const BODIED_METHODS = new Set(["POST", "PUT", "PATCH"]);
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Extracts every distinct `{{name}}` placeholder appearing across the given
 *  strings, in first-seen order. */
export function detectTemplateParameterNames(sources: string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const source of sources) {
    if (!source) continue;
    PLACEHOLDER_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER_PATTERN.exec(source)) !== null) {
      const name = match[1];
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

function toRecord(entries: KeyValueEntry[]): Record<string, string> | undefined {
  const trimmed = entries.filter((e) => e.key.trim() !== "");
  if (trimmed.length === 0) return undefined;
  const record: Record<string, string> = {};
  // Last-write-wins on duplicate keys — the UI itself never silently drops a
  // duplicate row (design.md Decision 2 non-blocking flag); this collapse is
  // the same lossy step the server already performs, done once here instead
  // of independently at each of the three call sites.
  for (const entry of trimmed) {
    record[entry.key.trim()] = entry.value;
  }
  return record;
}

export { HTTP_METHOD_OPTIONS, BODIED_METHODS };

export function useRestSourceForm() {
  const [connector, setConnector] = useState<Connector | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [method, setMethod] = useState("GET");
  const [queryParams, setQueryParams] = useState<KeyValueEntry[]>([]);
  const [headers, setHeaders] = useState<KeyValueEntry[]>([]);
  const [rootSelector, setRootSelector] = useState("");
  const [body, setBody] = useState("");
  const [bodyContentType, setBodyContentType] = useState("");
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});

  const supportsBody = BODIED_METHODS.has(method);

  const templateParameterNames = useMemo(
    () =>
      detectTemplateParameterNames([
        endpoint,
        ...queryParams.map((q) => q.value),
        ...headers.map((h) => h.value),
        body,
      ]),
    [endpoint, queryParams, headers, body],
  );

  function setParameterValue(name: string, value: string) {
    setParameterValues((prev) => ({ ...prev, [name]: value }));
  }

  function reset() {
    setConnector(null);
    setEndpoint("");
    setMethod("GET");
    setQueryParams([]);
    setHeaders([]);
    setRootSelector("");
    setBody("");
    setBodyContentType("");
    setParameterValues({});
  }

  /** design.md Decision 1a — the single shared REST-config composer. Used by
   *  RestApiForm's TestConnectionAffordance, AddSourceModal.handlePreview,
   *  and AddSourceModal.handleSubmit/handleCreate, so every save path emits
   *  the same, current shape. Never emits a bare `url` — a Connector is
   *  required before this is called (Requirement: "UI stops emitting the
   *  bare-URL create path"). */
  function buildRestSourceConfig(): RestApiConfigBody {
    const resolvedParameters =
      templateParameterNames.length > 0
        ? templateParameterNames.reduce<Record<string, string>>((acc, name) => {
            acc[name] = parameterValues[name] ?? "";
            return acc;
          }, {})
        : undefined;

    return {
      ...(connector ? { connectorId: connector.id } : {}),
      endpoint: endpoint.trim(),
      method,
      ...(toRecord(queryParams) ? { queryParams: toRecord(queryParams) } : {}),
      ...(toRecord(headers) ? { headers: toRecord(headers) } : {}),
      ...(rootSelector.trim() ? { rootSelector: rootSelector.trim() } : {}),
      ...(supportsBody && body.trim() ? { body: body.trim() } : {}),
      ...(supportsBody && body.trim() && bodyContentType.trim()
        ? { bodyContentType: bodyContentType.trim() }
        : {}),
      ...(resolvedParameters ? { parameters: resolvedParameters } : {}),
    };
  }

  return {
    connector,
    setConnector,
    endpoint,
    setEndpoint,
    method,
    setMethod,
    queryParams,
    setQueryParams,
    headers,
    setHeaders,
    rootSelector,
    setRootSelector,
    body,
    setBody,
    bodyContentType,
    setBodyContentType,
    parameterValues,
    setParameterValue,
    templateParameterNames,
    supportsBody,
    reset,
    buildRestSourceConfig,
  };
}

export type UseRestSourceFormReturn = ReturnType<typeof useRestSourceForm>;
