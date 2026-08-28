import { useEffect } from "react";
import { useParams } from "react-router-dom";

import "./TypeRegistryPage.css";
import { fetchDataTypes, selectPipelineOutputDataTypes } from "../state/dataTypesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { TypeDetailPanel } from "./TypeDetailPanel";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { PageContentSkeleton } from "../../../shared/ui/PageContentSkeleton";
import { ERROR_KIND_ICON } from "../../../shared/chrome/InlineError";

/**
 * `/registry/:id` — one DataType's detail.
 *
 * Replaces `TypeRegistryBrowser`, which resolved the type from a Redux
 * selection with an `items[0]` fallback and then *force-navigated* the URL to
 * match (`navigate(..., { replace: true })`). That redirect is why `/registry`
 * could never show anything of its own: arriving there immediately rewrote the
 * URL to the first type. The route is the selection now, so the overview at
 * `/registry` stays put and a deep link resolves to exactly what it names.
 */
export function TypeDetailPage() {
  const dispatch = useAppDispatch();
  const { id } = useParams<{ id: string }>();
  const { status, error, errorKind } = useAppSelector((state) => state.dataTypes);
  const items = useAppSelector(selectPipelineOutputDataTypes);

  useEffect(() => {
    void dispatch(fetchDataTypes());
  }, [dispatch]);

  const isRetrying = status === "loading";
  const ErrorIcon = ERROR_KIND_ICON[errorKind ?? "error"];
  const dataType = items.find((dt) => dt.id === id) ?? null;

  if (status === "failed" && error) {
    return (
      <div className="type-registry-page">
        <EmptyState
          intent="error"
          icon={<ErrorIcon />}
          title="Couldn't load types"
          description={
            errorKind === "not-found"
              ? "We couldn't find these types. They may have been deleted, or you may not have access to them."
              : errorKind === "forbidden"
                ? "You don't have access to these types."
                : error
          }
          cta={
            errorKind === "forbidden" || errorKind === "not-found"
              ? undefined
              : {
                  label: isRetrying ? "Retrying…" : "Retry",
                  onClick: () => dispatch(fetchDataTypes()),
                  disabled: isRetrying,
                }
          }
        />
      </div>
    );
  }

  if (dataType === null) {
    // Absent while still loading means "not fetched yet", not "does not exist".
    if (status === "idle" || status === "loading") {
      return (
        <div className="type-registry-page">
          <PageContentSkeleton />
        </div>
      );
    }
    return (
      <div className="type-registry-page">
        <EmptyState
          intent="error"
          icon={<ERROR_KIND_ICON.error />}
          title="Type not found"
          description="This type may have been deleted, or you may not have access to it."
        />
      </div>
    );
  }

  return (
    <div className="type-registry-page">
      {/* F-001: keyed on the type's id so React remounts the panel (and
       * re-initializes its editable Name/Schema/Computed-fields form state)
       * when the route changes, rather than reusing the previous instance's
       * stale local state against a new `dataType` prop. */}
      <TypeDetailPanel key={dataType.id} dataType={dataType} />
    </div>
  );
}
