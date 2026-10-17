import { useEffect, useState } from "react";
import { Database } from "lucide-react";

import "./SourcesPage.css";
import { useAddSourceAction } from "../hooks/useAddSourceAction";
import {
  deleteSource,
  fetchSourceReferences,
  fetchSources,
  isSourceDeleteConflict,
  setAddSourceModalOpen,
  type SourceDeleteConflict,
} from "../state/sourcesSlice";
import { sourceDeleteWarning } from "../utils/sourceReferences";
import { SourceDeleteConflictNotice } from "./SourceDeleteConflictNotice";
import { ConfirmInline } from "../../../shared/ui/ConfirmInline";
import {
  focusAfterRowDeleted,
  focusOnMount,
  focusRowDelete,
  neighbourDeleteLabel,
} from "../../../shared/chrome/rowDeleteFocus";
import type { DataSource } from "../types/dataSource";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { AddSourceModal } from "./AddSourceModal";
import { SourceListTable } from "./SourceListTable";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { PageContentSkeleton } from "../../../shared/ui/PageContentSkeleton";
import { PageHeader } from "../../../shared/ui/PageHeader";
import { PageShell } from "../../../shared/ui/PageShell";
import { DataSectionTabs } from "../../../shared/chrome/DataSectionTabs";
import { PageStatus } from "../../../shared/ui/PageStatus";
import { ERROR_KIND_ICON, InlineError } from "../../../shared/chrome/InlineError";

export function SourcesPage() {
  const dispatch = useAppDispatch();
  const {
    items: sources,
    status: sourcesStatus,
    error: sourcesError,
    errorKind: sourcesErrorKind,
    addModalOpen,
    references,
    referencesStatus,
  } = useAppSelector((state) => state.sources);
  const addSourceAction = useAddSourceAction();
  // HEL-1574: Delete lives on the overview rows (owner ruling 2026-10-14), with the HEL-1258 reference warning in
  // the confirm and the HEL-989 conflict notice on a refused (409) delete. A successful delete stays on this page.
  const [deletingSource, setDeletingSource] = useState<DataSource | null>(null);
  const [deleteConflict, setDeleteConflict] = useState<{
    sourceId: string;
    sourceName: string;
    conflict: SourceDeleteConflict;
  } | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);

  async function confirmDelete(source: DataSource) {
    const neighbour = neighbourDeleteLabel(source.name);
    setDeletingSource(null);
    setDeleteConflict(null);
    setDeleteError(null);
    const result = await dispatch(deleteSource(source.id));
    if (!deleteSource.rejected.match(result)) {
      focusAfterRowDeleted(neighbour, ".sources-page");
    } else {
      // A refused delete leaves the row: focus returns to its Delete button, with the notice announced beside it.
      focusRowDelete(source.name);
      if (isSourceDeleteConflict(result.payload)) {
        setDeleteConflict({
          sourceId: source.id,
          sourceName: source.name,
          conflict: result.payload,
        });
      } else {
        setDeleteError({ id: source.id, message: `Failed to delete ${source.name}.` });
      }
    }
  }

  // The confirm, the 409 notice or a refusal render as a full-width row directly below the clicked row, so opening
  // it never moves the row under the pointer: the row's own Delete stays where it is (HEL-1574, AgentMemoryList).
  const rowExtra =
    deletingSource !== null
      ? {
          id: deletingSource.id,
          content: (
            <div
              role="group"
              tabIndex={-1}
              ref={focusOnMount}
              aria-label={`Confirm delete ${deletingSource.name}`}
            >
              <ConfirmInline
                label={`Delete ${deletingSource.name}? ${sourceDeleteWarning(references[deletingSource.id]) ?? ""}`.trim()}
                confirmLabel="Delete"
                ignoreRepeatClicks
                confirmAriaLabel={`Confirm delete ${deletingSource.name}`}
                onConfirm={() => void confirmDelete(deletingSource)}
                onCancel={() => {
                  const name = deletingSource.name;
                  setDeletingSource(null);
                  focusRowDelete(name);
                }}
              />
            </div>
          ),
        }
      : deleteConflict !== null
        ? {
            id: deleteConflict.sourceId,
            content: (
              <SourceDeleteConflictNotice
                sourceName={deleteConflict.sourceName}
                conflict={deleteConflict.conflict}
                onDismiss={() => setDeleteConflict(null)}
              />
            ),
          }
        : deleteError !== null
          ? {
              id: deleteError.id,
              content: <InlineError error={deleteError.message} variant="banner" />,
            }
          : undefined;

  useEffect(() => {
    // F-072: guard the dispatch on `idle` (mirroring SidebarBody's fetch
    // pattern). The sidebar's "sources" section mounts alongside this page
    // and already dispatches `fetchSources()` itself, so an unconditional
    // dispatch here raced it into a genuine duplicate GET /api/data-sources
    // on cold mount; guarding also stops both fetches from refiring
    // pointlessly on every later revisit of /sources.
    if (sourcesStatus === "idle") {
      void dispatch(fetchSources());
    }
  }, [dispatch, sourcesStatus]);

  // HEL-1258: the "Used by" column reads the server's reference summary. Refetched on every mount (not
  // `idle`-guarded): references change outside this page, and it is cheap. The thunk's own `condition`
  // collapses it with the sidebar's trigger on a cold load, so there is one GET, not two.
  useEffect(() => {
    void dispatch(fetchSourceReferences());
  }, [dispatch]);

  // HEL-554 D4/task 3.4 — mirrors `PanelList.tsx:193-197`'s identical
  // cleanup for `panelCreationModalOpen`. `addModalOpen` is a Redux flag, so
  // (unlike `useState`) it outlives this component: open the modal -> Ctrl/
  // Cmd+K -> navigate away -> `SourcesPage` unmounts with the flag still
  // `true` -> returning to `/sources` (including via HEL-554's onboarding
  // checklist, which navigates here rather than setting this flag itself —
  // D4) would open the modal unbidden. Safe under StrictMode's dev-only
  // double-invoke because `addModalOpen` starts `false` at every mount now
  // that nothing sets it before this page itself does (the `workspace-
  // create-actions` spec's own requirement — this page previously had no
  // cleanup at all).
  useEffect(() => {
    return () => {
      dispatch(setAddSourceModalOpen(false));
    };
  }, [dispatch]);

  // Computed outside the JSX conditional below so it isn't affected by the
  // `sourcesStatus === "failed"` narrowing inside that branch.
  const isRetryingSources = sourcesStatus === "loading";
  const SourcesErrorIcon = ERROR_KIND_ICON[sourcesErrorKind ?? "error"];
  // HEL-528 design.md D3/D11 — widened to `idle` too: the mount effect above
  // dispatches after paint, so a loading-only gate would paint the "Connect a
  // data source" hero first (the ~331px→15px collapse HEL-539's skeptic
  // traced and deferred here).
  const showSourcesSkeleton =
    (sourcesStatus === "idle" || sourcesStatus === "loading") && sources.length === 0;

  return (
    <PageShell className="sources-page">
      <DataSectionTabs />
      <PageHeader title="Data Sources" />

      <div className="sources-page__section">
        {showSourcesSkeleton && (
          <PageStatus status="loading" variant="skeleton">
            <PageContentSkeleton />
          </PageStatus>
        )}
        {sourcesStatus === "failed" && sourcesError && (
          <PageStatus
            status="failed"
            icon={<SourcesErrorIcon />}
            title="Couldn't load sources"
            message={
              sourcesErrorKind === "not-found"
                ? "We couldn't find these sources. They may have been deleted, or you may not have access to them."
                : sourcesErrorKind === "forbidden"
                  ? "You don't have access to these sources."
                  : sourcesError
            }
            onRetry={
              sourcesErrorKind === "forbidden" || sourcesErrorKind === "not-found"
                ? undefined
                : () => dispatch(fetchSources())
            }
            retrying={isRetryingSources}
          />
        )}
        {
          // HEL-528 design.md D4 — was `(succeeded || idle)`, which never
          // matched a "loading" refetch and so rendered NOTHING once items
          // already existed (unreachable today — no action re-dispatches
          // fetchSources() once loaded — but the same "content vanishes
          // mid-refetch" class of bug this ticket exists to close). Keeping
          // rendering the already-resolved content whenever the skeleton
          // isn't showing is the general form of that rule.
          !showSourcesSkeleton &&
            sourcesStatus !== "failed" &&
            (sources.length > 0 ? (
              <>
                <SourceListTable
                  rowExtra={rowExtra}
                  onRequestDelete={(source) => {
                    setDeleteConflict(null);
                    setDeleteError(null);
                    setDeletingSource(source);
                  }}
                  sources={sources}
                  references={references}
                  referencesLoaded={referencesStatus === "succeeded"}
                />
                {/* Below the list, matching Pipelines/Metrics/Connectors. */}
                <div className="sources-page__toolbar">
                  <button
                    type="button"
                    className="sources-page__create-btn"
                    onClick={addSourceAction.cta.onClick}
                    disabled={addSourceAction.cta.disabled}
                  >
                    Add source
                  </button>
                </div>
              </>
            ) : (
              // F-102/F-174: this "Add source" CTA is fully functional on mobile even though a
              // non-empty source list is view-only there by design — deliberately blessed, not an
              // oversight. It's the one intended mobile bootstrap path (mirrors F-003's identical
              // carve-out for the zero-dashboards case in PanelList.tsx): a user with zero sources
              // must have a way to add their first one from a phone, same as any other empty state's
              // CTA in this app.
              <EmptyState
                variant="main"
                icon={<Database />}
                title="Connect a data source"
                description="Pull in data from PostgreSQL, MySQL, CSV, or static input. Helio infers a schema you can then shape into Outputs with a pipeline."
                cta={addSourceAction.cta}
              />
            ))
        }
      </div>

      {addModalOpen && <AddSourceModal onClose={() => dispatch(setAddSourceModalOpen(false))} />}
    </PageShell>
  );
}
