import { useEffect } from "react";

import "./TypeRegistryPage.css";
import { fetchDataTypes, selectPipelineOutputDataTypes } from "../state/dataTypesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { PageContentSkeleton } from "../../../shared/ui/PageContentSkeleton";
import { ERROR_KIND_ICON } from "../../../shared/chrome/InlineError";
import { TypeRegistryBrowser } from "./TypeRegistryBrowser";

export function TypeRegistryPage() {
  const dispatch = useAppDispatch();
  const { status, error, errorKind } = useAppSelector((state) => state.dataTypes);
  // Same derived selector `TypeRegistryBrowser` itself renders from, so the
  // skeleton's "is there anything to show yet" check matches what will
  // actually appear (HEL-528 design.md D3, task 4.2).
  const items = useAppSelector(selectPipelineOutputDataTypes);

  useEffect(() => {
    void dispatch(fetchDataTypes());
  }, [dispatch]);

  // Computed outside the `status === "failed"`-narrowed JSX branch below.
  const isRetryingTypes = status === "loading";
  const TypesErrorIcon = ERROR_KIND_ICON[errorKind ?? "error"];
  // HEL-528 design.md D3/D11 — widened to `idle` too: the mount effect above
  // dispatches after paint, so a loading-only gate would paint an empty
  // `TypeRegistryBrowser` first for one frame.
  const showTypesSkeleton = (status === "idle" || status === "loading") && items.length === 0;

  return (
    <div className="type-registry-page">
      {showTypesSkeleton && <PageContentSkeleton />}
      {status === "failed" && error && (
        <EmptyState
          intent="error"
          icon={<TypesErrorIcon />}
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
                  label: isRetryingTypes ? "Retrying…" : "Retry",
                  onClick: () => dispatch(fetchDataTypes()),
                  disabled: isRetryingTypes,
                }
          }
        />
      )}
      {
        // HEL-528 design.md D4 — was `(succeeded || idle)`, which never
        // matched a "loading" refetch and unmounted the browser entirely
        // once types already existed (the same "content vanishes
        // mid-refetch" class of bug this ticket exists to close).
        !showTypesSkeleton && status !== "failed" && <TypeRegistryBrowser />
      }
    </div>
  );
}
