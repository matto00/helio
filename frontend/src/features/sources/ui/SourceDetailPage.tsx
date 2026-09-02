import { useEffect } from "react";
import { useParams } from "react-router-dom";

import { fetchSources } from "../state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { SourceDetailPanel } from "./SourceDetailPanel";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { PageContentSkeleton } from "../../../shared/ui/PageContentSkeleton";
import { ERROR_KIND_ICON } from "../../../shared/chrome/InlineError";

/**
 * `/sources/:id` — one source's detail, split out of `SourcesPage` when that
 * route became the section overview (it previously rendered the detail panel
 * directly and picked `sources[0]` when nothing was selected, so arriving at
 * `/sources` showed an arbitrary source with no way to tell which).
 *
 * The id comes from the URL rather than `state.sources.selectedSourceId`, so
 * the route is the single source of truth: a deep link, a browser refresh and
 * a sidebar click all resolve identically, and an unknown id is a real
 * not-found rather than a silent fallback to whatever happens to be first.
 */
export function SourceDetailPage() {
  const dispatch = useAppDispatch();
  const { id } = useParams<{ id: string }>();
  const {
    items: sources,
    status: sourcesStatus,
    error: sourcesError,
    errorKind: sourcesErrorKind,
  } = useAppSelector((state) => state.sources);

  useEffect(() => {
    // Guarded on `idle` (the SidebarBody fetch convention) so landing here
    // directly doesn't race the sidebar's own fetch into a duplicate GET.
    if (sourcesStatus === "idle") {
      void dispatch(fetchSources());
    }
  }, [dispatch, sourcesStatus]);

  const source = sources.find((s) => s.id === id) ?? null;
  const isRetrying = sourcesStatus === "loading";
  const ErrorIcon = ERROR_KIND_ICON[sourcesErrorKind ?? "error"];

  if (sourcesStatus === "failed" && sourcesError) {
    return (
      <div className="sources-page">
        <EmptyState
          intent="error"
          icon={<ErrorIcon />}
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
                  label: isRetrying ? "Retrying…" : "Retry",
                  onClick: () => dispatch(fetchSources()),
                  disabled: isRetrying,
                }
          }
        />
      </div>
    );
  }

  // Only "unknown id" once the list has actually resolved — while it is still
  // loading, an absent match means "not fetched yet", not "does not exist".
  if (source === null) {
    if (sourcesStatus === "idle" || sourcesStatus === "loading") {
      return (
        <div className="sources-page">
          <PageContentSkeleton />
        </div>
      );
    }
    return (
      <div className="sources-page">
        <EmptyState
          intent="error"
          icon={<ERROR_KIND_ICON.error />}
          title="Source not found"
          description="This source may have been deleted, or you may not have access to it."
        />
      </div>
    );
  }

  return (
    <div className="sources-page">
      <SourceDetailPanel source={source} />
    </div>
  );
}
