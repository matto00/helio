import { Plus } from "lucide-react";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { recentHistoryStore } from "../../features/commandPalette/model/recentHistoryStore";
import { fetchScheduledItems } from "../../features/pipelines/state/scheduledItemsSlice";
import {
  fetchPipelines,
  setCreatePipelineModalOpen,
} from "../../features/pipelines/state/pipelinesSlice";
import { fetchSources, setAddSourceModalOpen } from "../../features/sources/state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import { IconButton } from "../../shared/ui/IconButton";
import { ICON_SIZE } from "../../shared/ui/iconSize";
import { formatNextRun } from "./formatNextRun";

/** At most this many rows per group (the recent-visits store itself keeps 10 across kinds). */
const MAX_ROWS = 8;

type ScheduledKind = "pipelines" | "sources";

interface ScheduledContextListProps {
  kind: ScheduledKind;
}

interface Row {
  id: string;
  name: string;
  meta: string | null;
  to: string;
}

const COPY: Record<
  ScheduledKind,
  { base: string; recentKind: "pipeline" | "source"; addLabel: string; viewAll: string }
> = {
  pipelines: {
    base: "/pipelines",
    recentKind: "pipeline",
    addLabel: "New pipeline",
    viewAll: "View all pipelines",
  },
  sources: {
    base: "/sources",
    recentKind: "source",
    addLabel: "Add source",
    viewAll: "View all sources",
  },
};

function RowList({
  title,
  rows,
  activeId,
  emptyText,
  action,
}: {
  action?: ReactNode;
  title: string;
  rows: Row[];
  activeId: string | null;
  emptyText: string;
}) {
  return (
    <section className="context-list__section" aria-label={title}>
      <h3 className="context-list__section-title">
        <span>{title}</span>
        {action}
      </h3>
      {rows.length === 0 ? (
        <p className="context-list__empty">{emptyText}</p>
      ) : (
        <ul className="context-list__rows">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                to={row.to}
                className="context-list__row"
                aria-current={row.id === activeId ? "page" : undefined}
              >
                <span className="context-list__row-name">{row.name}</span>
                {row.meta !== null && <span className="context-list__row-meta">{row.meta}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The Pipelines and Sources context lists (owner rulings 2026-10-13): a compact Recent group and a Scheduled group
 *  with each item's next run, never a copy of the section's full table. Both come from one shared
 *  `GET /api/pipeline-schedules` request (sources: the soonest run among the scheduled pipelines they feed). */
export function ScheduledContextList({ kind }: ScheduledContextListProps) {
  const dispatch = useAppDispatch();
  const { id: routeId } = useParams<{ id: string }>();
  const copy = COPY[kind];
  const scheduled = useAppSelector((state) => state.scheduledItems);
  const recent = useSyncExternalStore(recentHistoryStore.subscribe, recentHistoryStore.getEntries);

  const sources = useAppSelector((state) => state.sources);
  const pipelines = useAppSelector((state) => state.pipelines);
  const sourcesStatus = sources.status;
  const pipelinesStatus = pipelines.status;

  useEffect(() => {
    void dispatch(fetchScheduledItems());
  }, [dispatch]);

  // The breadcrumb and detail pages resolve the open item's name from these collections, which the retired sidebar
  // list used to load. Only the collection for this section, only when never loaded.
  useEffect(() => {
    if (kind === "sources" && sourcesStatus === "idle") void dispatch(fetchSources());
    if (kind === "pipelines" && pipelinesStatus === "idle") void dispatch(fetchPipelines());
  }, [dispatch, kind, sourcesStatus, pipelinesStatus]);

  // Recent comes from the visit history, but only items that still exist are shown, named from the loaded
  // collection (a deleted item must not linger, and never as a raw id). Until the collection has loaded, an entry
  // is shown only if it carries the title it was recorded with.
  const collection = kind === "pipelines" ? pipelines : sources;
  const collectionLoaded = collection.status === "succeeded";
  const nameById = new Map(collection.items.map((item) => [item.id, item.name]));
  const recentRows: Row[] = recent
    .filter((entry) => entry.kind === copy.recentKind)
    .flatMap((entry): Row[] => {
      const name = collectionLoaded
        ? nameById.get(entry.id)
        : (nameById.get(entry.id) ?? entry.title);
      return name === undefined
        ? []
        : [{ id: entry.id, name, meta: null, to: `${copy.base}/${entry.id}` }];
    })
    .slice(0, MAX_ROWS);

  const scheduledRows: Row[] = (
    kind === "pipelines"
      ? scheduled.items.map((item) => ({
          id: item.pipelineId,
          name: item.pipelineName,
          meta: formatNextRun(item.nextRunAt),
          to: `${copy.base}/${item.pipelineId}`,
        }))
      : scheduled.sources.map((item) => {
          const next = formatNextRun(item.nextRunAt);
          return {
            id: item.sourceId,
            name: item.sourceName,
            meta: next === null ? item.pipelineName : `next ${next} · ${item.pipelineName}`,
            to: `${copy.base}/${item.sourceId}`,
          };
        })
  ).slice(0, MAX_ROWS);

  // Pipelines meta reads "next <time>" too, so the two lists speak the same way.
  const decorated = scheduledRows.map((row) =>
    kind === "pipelines" && row.meta !== null ? { ...row, meta: `next ${row.meta}` } : row,
  );

  // At most one row per list is current: the Scheduled row when the open item is scheduled, otherwise its Recent row.
  const openId = routeId ?? null;
  const openIsScheduled = decorated.some((row) => row.id === openId);

  const scheduledEmpty =
    scheduled.status === "failed"
      ? "Couldn't load scheduled items."
      : scheduled.status === "succeeded"
        ? "Nothing scheduled."
        : "Loading…";

  return (
    <>
      <RowList
        title="Recent"
        action={
          <IconButton
            icon={<Plus size={ICON_SIZE.sm} />}
            variant="secondary"
            size="xs"
            aria-label={copy.addLabel}
            onClick={() =>
              dispatch(
                kind === "pipelines"
                  ? setCreatePipelineModalOpen(true)
                  : setAddSourceModalOpen(true),
              )
            }
          />
        }
        rows={recentRows}
        activeId={openIsScheduled ? null : openId}
        emptyText={`No recent ${kind}.`}
      />
      <RowList title="Scheduled" rows={decorated} activeId={openId} emptyText={scheduledEmpty} />
      <div className="context-list__footer">
        <Link to={copy.base} className="context-list__link">
          {copy.viewAll}
        </Link>
      </div>
    </>
  );
}
