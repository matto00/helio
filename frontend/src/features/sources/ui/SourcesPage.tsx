import { useEffect } from "react";
import { Database } from "lucide-react";

import "./SourcesPage.css";
import { fetchDataTypes } from "../../dataTypes/state/dataTypesSlice";
import { fetchPipelines } from "../../pipelines/state/pipelinesSlice";
import { selectPipelineNamesBySourceId } from "../../pipelines/state/pipelinesSlice";
import { useAddSourceAction } from "../hooks/useAddSourceAction";
import { fetchSources, setAddSourceModalOpen } from "../state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { AddSourceModal } from "./AddSourceModal";
import { SourceListTable } from "./SourceListTable";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { PageContentSkeleton } from "../../../shared/ui/PageContentSkeleton";
import { ERROR_KIND_ICON } from "../../../shared/chrome/InlineError";

export function SourcesPage() {
  const dispatch = useAppDispatch();
  const {
    items: sources,
    status: sourcesStatus,
    error: sourcesError,
    errorKind: sourcesErrorKind,
    addModalOpen,
  } = useAppSelector((state) => state.sources);
  const dataTypesStatus = useAppSelector((state) => state.dataTypes.status);
  const pipelinesStatus = useAppSelector((state) => state.pipelines.status);
  const pipelineNamesBySourceId = useAppSelector(selectPipelineNamesBySourceId);
  const addSourceAction = useAddSourceAction();

  useEffect(() => {
    // F-072: guard both dispatches on `idle` (mirroring SidebarBody's fetch
    // pattern). The sidebar's "sources" section mounts alongside this page
    // and already dispatches `fetchSources()` itself, so an unconditional
    // dispatch here raced it into a genuine duplicate GET /api/data-sources
    // on cold mount; guarding also stops both fetches from refiring
    // pointlessly on every later revisit of /sources.
    if (sourcesStatus === "idle") {
      void dispatch(fetchSources());
    }
    // Schema preview needs the inferred DataType for the selected source.
    if (dataTypesStatus === "idle") {
      void dispatch(fetchDataTypes());
    }
    // The overview's "Used by" column resolves each source's reading
    // pipelines. Same `idle` guard — the sidebar's sources section already
    // fetches pipelines for its delete-confirm warning.
    if (pipelinesStatus === "idle") {
      void dispatch(fetchPipelines());
    }
  }, [dispatch, sourcesStatus, dataTypesStatus, pipelinesStatus]);

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
    <div className="sources-page">
      <header className="sources-page__header">
        <h1 className="page-title">Data Sources</h1>
      </header>

      <div className="sources-page__section">
        {showSourcesSkeleton && <PageContentSkeleton />}
        {sourcesStatus === "failed" && sourcesError && (
          <EmptyState
            intent="error"
            icon={<SourcesErrorIcon />}
            title="Couldn't load sources"
            description={
              sourcesErrorKind === "not-found"
                ? "We couldn't find these sources. They may have been deleted, or you may not have access to them."
                : sourcesErrorKind === "forbidden"
                  ? "You don't have access to these sources."
                  : sourcesError
            }
            cta={
              sourcesErrorKind === "forbidden" || sourcesErrorKind === "not-found"
                ? undefined
                : {
                    label: isRetryingSources ? "Retrying…" : "Retry",
                    onClick: () => dispatch(fetchSources()),
                    disabled: isRetryingSources,
                  }
            }
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
                  sources={sources}
                  pipelineNamesBySourceId={pipelineNamesBySourceId}
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
                description="Pull in data from PostgreSQL, MySQL, CSV, or static input. Helio infers a schema you can then shape into a bindable type with a pipeline."
                cta={addSourceAction.cta}
              />
            ))
        }
      </div>

      {addModalOpen && <AddSourceModal onClose={() => dispatch(setAddSourceModalOpen(false))} />}
    </div>
  );
}
