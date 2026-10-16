import { useEffect, useMemo, useRef, useState } from "react";

import { getPipelineById } from "../../pipelines/services/pipelineService";
import type { Output } from "../../pipelines/types/output";
import type { PipelineSummary } from "../../pipelines/types/pipelineStep";
import { subscribeToPipelineTerminal } from "../services/pipelineRunFanout";
import { fetchOutputMeta, getOutputMetaCached } from "../state/outputMetaCache";
import {
  deriveDashboardMeta,
  feedingOutputIds,
  feedingPipelineIds,
  type DashboardMeta,
} from "../state/dashboardMeta";
import type { Panel } from "../types/panel";

type OutputsById = Record<string, Output | undefined>;
type SummariesById = Record<string, PipelineSummary | undefined>;

function seedOutputs(ids: readonly string[]): OutputsById {
  const seeded: OutputsById = {};
  for (const id of ids) {
    const held = getOutputMetaCached(id);
    if (held) seeded[id] = held;
  }
  return seeded;
}

/** The dashboard meta row's facts (HEL-1576 design D2). Holds its OWN Output metadata and pipeline
 *  summaries in local state: `outputMetaCache` triggers no re-render and the pipelines slice can be
 *  session-old, so neither is read for freshness. A feeding pipeline's summary is read through
 *  `getPipelineById` on mount (and on a dashboard change), whenever a new feeding pipeline appears,
 *  and whenever its terminal run event fires; the Redux store is never read or written.
 *
 *  Do not mount this on the public shared-dashboard route: a viewer there cannot read pipelines. */
export function useDashboardMeta(
  dashboardId: string | null,
  panels: readonly Panel[],
): DashboardMeta {
  const outputIds = useMemo(() => feedingOutputIds(panels), [panels]);
  const outputKey = outputIds.join("|");

  const [outputs, setOutputs] = useState<OutputsById>(() => seedOutputs(outputIds));
  const [summaries, setSummaries] = useState<SummariesById>({});

  // Output metadata: fetch each feeding Output not yet held; ignore results after unmount or after
  // the panel set dropped that Output. A failed fetch leaves the Output out (its panel contributes
  // nothing).
  useEffect(() => {
    let cancelled = false;
    for (const id of outputIds) {
      const held = getOutputMetaCached(id);
      if (held) {
        setOutputs((prev) => (prev[id] === held ? prev : { ...prev, [id]: held }));
        continue;
      }
      fetchOutputMeta(id)
        .then((output) => {
          if (!cancelled) setOutputs((prev) => ({ ...prev, [id]: output }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
    // `outputIds` is stable for a given `outputKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputKey]);

  const pipelineIds = useMemo(() => feedingPipelineIds(panels, outputs), [panels, outputs]);
  const pipelineKey = pipelineIds.join("|");

  const feeding = useRef<ReadonlySet<string>>(new Set());
  const requestSeq = useRef(new Map<string, number>());
  const requested = useRef(new Set<string>());
  const requestedFor = useRef<string | null>(null);
  const unsubscribes = useRef(new Map<string, () => void>());

  useEffect(() => {
    const subs = unsubscribes.current;
    const asked = requested.current;
    return () => {
      feeding.current = new Set();
      for (const off of subs.values()) off();
      subs.clear();
      asked.clear();
    };
  }, []);

  useEffect(() => {
    feeding.current = new Set(pipelineIds);
    if (requestedFor.current !== dashboardId) {
      requestedFor.current = dashboardId;
      requested.current.clear();
    }

    const load = (id: string) => {
      const seq = (requestSeq.current.get(id) ?? 0) + 1;
      requestSeq.current.set(id, seq);
      // Dropped when the id left the feeding set (unmount empties it) or a later request superseded this one.
      const isCurrent = () => feeding.current.has(id) && requestSeq.current.get(id) === seq;
      getPipelineById(id).then(
        (summary) => {
          if (isCurrent()) setSummaries((prev) => ({ ...prev, [id]: summary }));
        },
        () => {
          // 403/404 or any failed read: omit this pipeline's facts rather than show a stale value.
          if (isCurrent()) {
            setSummaries((prev) => {
              if (!(id in prev)) return prev;
              const next = { ...prev };
              delete next[id];
              return next;
            });
          }
        },
      );
    };

    for (const id of pipelineIds) {
      if (!requested.current.has(id)) {
        requested.current.add(id);
        load(id);
      }
      if (!unsubscribes.current.has(id)) {
        unsubscribes.current.set(
          id,
          subscribeToPipelineTerminal(id, () => load(id)),
        );
      }
    }
    for (const [id, off] of [...unsubscribes.current]) {
      if (!feeding.current.has(id)) {
        off();
        unsubscribes.current.delete(id);
        requested.current.delete(id);
      }
    }
    // `pipelineIds` is stable for a given `pipelineKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineKey, dashboardId]);

  return useMemo(
    () => deriveDashboardMeta(panels, outputs, summaries),
    [panels, outputs, summaries],
  );
}
