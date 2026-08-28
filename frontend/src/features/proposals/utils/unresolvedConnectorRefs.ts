// HEL-829 tasks.md 2.2 — detection helper for the in-chat credential capture
// flow (design.md Decision 3). PURE, unit-tested; never throws on
// malformed/absent input — a broken/foreign proposal degrades to "no
// unresolved reference" rather than crashing the review page.

import type { Connector } from "../../connectors/types/connector";
import type { PipelineProposal } from "../../pipelines/types/pipelineProposal";
import type { CombinedProposal } from "../types/combinedProposal";

/** Mirrors the backend's `ProposalRestApiConfig`/`NewConnectorDraft`
 *  (`PipelineProposalProtocol.scala`) — the client-side shape narrowed out of
 *  the loose `proposal.source.config: Record<string, unknown>` bag (design.md
 *  Decision 3's round-2 CR-5 wire-key correction: there is no typed
 *  `restConfig` field on the client, only `source.config` selected by
 *  `source.type === "rest_api"`). */
export interface NewConnectorDraftClient {
  name: string;
  baseUrl: string;
  authType: string;
  apiKeyName?: string;
  apiKeyPlacement?: string;
  retrievalInstructions: string;
}

export interface ProposalRestApiConfigClient {
  connectorId?: string;
  url?: string;
  newConnector?: NewConnectorDraftClient;
}

/** One unresolved connector reference a review page must render a
 *  `InlineConnectorSetup` section for. `key` is a stable identity for
 *  React + for locating which step to patch once resolved. */
export interface UnresolvedConnectorRef {
  key: string;
  /** Present for a `newConnector` draft — the model-authored setup info. */
  draft?: NewConnectorDraftClient;
  /** Present for a bare `connectorId` that doesn't resolve against the
   *  currently-loaded connector list (e.g. deleted since proposal generation). */
  danglingConnectorId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function narrowNewConnectorDraft(value: unknown): NewConnectorDraftClient | undefined {
  if (!isRecord(value)) return undefined;
  const { name, baseUrl, authType, retrievalInstructions, apiKeyName, apiKeyPlacement } = value;
  if (
    typeof name !== "string" ||
    typeof baseUrl !== "string" ||
    typeof authType !== "string" ||
    typeof retrievalInstructions !== "string"
  ) {
    return undefined;
  }
  return {
    name,
    baseUrl,
    authType,
    retrievalInstructions,
    apiKeyName: typeof apiKeyName === "string" ? apiKeyName : undefined,
    apiKeyPlacement: typeof apiKeyPlacement === "string" ? apiKeyPlacement : undefined,
  };
}

/** Runtime shape check (not just a TS cast) over the untyped wire `config`
 *  bag — degrades to `null` on anything malformed rather than throwing
 *  (design.md Decision 3). */
export function narrowRestApiConfigClient(
  config: Record<string, unknown> | undefined,
): ProposalRestApiConfigClient | null {
  if (!isRecord(config)) return null;
  const result: ProposalRestApiConfigClient = {};
  if (typeof config.connectorId === "string") result.connectorId = config.connectorId;
  if (typeof config.url === "string") result.url = config.url;
  const draft = narrowNewConnectorDraft(config.newConnector);
  if (draft) result.newConnector = draft;
  return result;
}

/** One `PipelineProposal`'s single inline REST source, resolved against the
 *  given `key` prefix. A step whose `config.url` is set is the legacy
 *  bare-URL path — excluded, no inline-setup UI (design.md Decision 3). */
function detectForPipelineSource(
  proposal: PipelineProposal,
  connectors: Connector[],
  key: string,
): UnresolvedConnectorRef[] {
  if (proposal.source.type !== "rest_api") return [];
  const config = narrowRestApiConfigClient(proposal.source.config);
  if (!config) return [];
  if (config.url) return [];
  if (config.newConnector) return [{ key, draft: config.newConnector }];
  if (config.connectorId && !connectors.some((c) => c.id === config.connectorId)) {
    return [{ key, danglingConnectorId: config.connectorId }];
  }
  return [];
}

/** Given a `PipelineProposal` and the current connector list, returns every
 *  unresolved REST-source connector reference (design.md Decision 3, task
 *  2.2). */
export function detectUnresolvedConnectorRefs(
  proposal: PipelineProposal,
  connectors: Connector[],
): UnresolvedConnectorRef[] {
  return detectForPipelineSource(proposal, connectors, "pipeline-source");
}

/** Same detection over a `CombinedProposal`'s nested pipeline half — the
 *  dashboard half has no source/connector-bearing field on its type at all
 *  (design.md Decision 3), so this is a no-op extension, not a separate scan. */
export function detectUnresolvedConnectorRefsForCombined(
  proposal: CombinedProposal,
  connectors: Connector[],
): UnresolvedConnectorRef[] {
  return detectForPipelineSource(proposal.pipeline, connectors, "combined-pipeline-source");
}

/** Patches a `PipelineProposal`'s local copy so the resolved step's
 *  `config.newConnector`/dangling `config.connectorId` is replaced with the
 *  now-real `connectorId`, clearing `newConnector`/`url` — the resulting
 *  `config` is, structurally, an ordinary `connectorId`-only config
 *  (design.md Decision 2's "resolving before Apply"). Every OTHER field on
 *  `config` (`endpoint`/`method`/`queryParams`/`headers`/...) is preserved
 *  untouched. Never mutates the input — returns a new object. */
export function resolvePipelineConnectorRef(
  proposal: PipelineProposal,
  connectorId: string,
): PipelineProposal {
  const { newConnector: _newConnector, url: _url, ...restConfig } = proposal.source.config ?? {};
  return {
    ...proposal,
    source: {
      ...proposal.source,
      config: { ...restConfig, connectorId },
    },
  };
}

/** Same patch, applied to a `CombinedProposal`'s nested pipeline half. */
export function resolveCombinedConnectorRef(
  proposal: CombinedProposal,
  connectorId: string,
): CombinedProposal {
  return {
    ...proposal,
    pipeline: resolvePipelineConnectorRef(proposal.pipeline, connectorId),
  };
}
