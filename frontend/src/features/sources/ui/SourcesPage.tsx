import { useEffect } from "react";

import "./SourcesPage.css";
import { faDatabase, faPlus } from "@fortawesome/free-solid-svg-icons";
import { fetchDataTypes } from "../../dataTypes/state/dataTypesSlice";
import { fetchSources, setAddSourceModalOpen } from "../state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { AddSourceModal } from "./AddSourceModal";
import { SourceDetailPanel } from "./SourceDetailPanel";
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
    selectedSourceId,
    addModalOpen,
  } = useAppSelector((state) => state.sources);
  const dataTypesStatus = useAppSelector((state) => state.dataTypes.status);

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
  }, [dispatch, sourcesStatus, dataTypesStatus]);

  // Derive the effective selection so the panel is never blank: explicit user
  // choice from the sidebar wins; otherwise fall back to the first item.
  const selected = sources.find((s) => s.id === selectedSourceId) ?? sources[0] ?? null;

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
            (selected !== null ? (
              <SourceDetailPanel source={selected} />
            ) : (
              // F-102/F-174: this "Add source" CTA is fully functional on mobile even though a
              // non-empty source list is view-only there by design — deliberately blessed, not an
              // oversight. It's the one intended mobile bootstrap path (mirrors F-003's identical
              // carve-out for the zero-dashboards case in PanelList.tsx): a user with zero sources
              // must have a way to add their first one from a phone, same as any other empty state's
              // CTA in this app.
              <EmptyState
                variant="main"
                icon={faDatabase}
                title="Connect a data source"
                description="Pull in data from PostgreSQL, MySQL, CSV, or static input. Helio infers a schema you can then shape into a bindable type with a pipeline."
                cta={{
                  label: "Add source",
                  icon: faPlus,
                  onClick: () => dispatch(setAddSourceModalOpen(true)),
                }}
              />
            ))
        }
      </div>

      {addModalOpen && <AddSourceModal onClose={() => dispatch(setAddSourceModalOpen(false))} />}
    </div>
  );
}
