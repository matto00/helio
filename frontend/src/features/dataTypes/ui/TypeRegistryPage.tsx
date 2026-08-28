import { useEffect } from "react";

import "./TypeRegistryPage.css";
import { fetchDataTypes, selectPipelineOutputDataTypes } from "../state/dataTypesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { PageContentSkeleton } from "../../../shared/ui/PageContentSkeleton";
import { ERROR_KIND_ICON } from "../../../shared/chrome/InlineError";
import { TypeListTable } from "./TypeListTable";
import { useCreatePipelineAction } from "../../pipelines/hooks/useCreatePipelineAction";
import {
  fetchPipelines,
  selectPipelineNameByOutputTypeId,
} from "../../pipelines/state/pipelinesSlice";
import { Layers } from "lucide-react";

export function TypeRegistryPage() {
  const dispatch = useAppDispatch();
  const { status, error, errorKind } = useAppSelector((state) => state.dataTypes);
  // Same derived selector the table below renders from, so the
  // skeleton's "is there anything to show yet" check matches what will
  // actually appear (HEL-528 design.md D3, task 4.2).
  const items = useAppSelector(selectPipelineOutputDataTypes);
  const pipelinesStatus = useAppSelector((state) => state.pipelines.status);
  const pipelineNameByTypeId = useAppSelector(selectPipelineNameByOutputTypeId);
  // A type exists only as a pipeline's output, so the section's one create
  // path is "New pipeline", never a (nonexistent) "add type" action.
  const createPipelineAction = useCreatePipelineAction();

  // Deliberately TWO effects, not one. `fetchDataTypes()` is unconditional
  // (it refetches on every visit), so folding it in beside the pipelines
  // fetch — whose guard needs `pipelinesStatus` in the dep array — would
  // re-dispatch it every time that status transitioned, refetching types on
  // an unrelated slice's activity.
  useEffect(() => {
    void dispatch(fetchDataTypes());
  }, [dispatch]);

  useEffect(() => {
    // The overview's "Produced by" column resolves each type's producing
    // pipeline. `idle`-guarded, matching SidebarBody's registry branch, which
    // already fetches pipelines for the same provenance mapping (HEL-270).
    if (pipelinesStatus === "idle") {
      void dispatch(fetchPipelines());
    }
  }, [dispatch, pipelinesStatus]);

  // Computed outside the `status === "failed"`-narrowed JSX branch below.
  const isRetryingTypes = status === "loading";
  const TypesErrorIcon = ERROR_KIND_ICON[errorKind ?? "error"];
  // HEL-528 design.md D3/D11 — widened to `idle` too: the mount effect above
  // dispatches after paint, so a loading-only gate would paint an empty
  // empty table first for one frame.
  const showTypesSkeleton = (status === "idle" || status === "loading") && items.length === 0;

  return (
    <div className="type-registry-page">
      <header className="type-registry-page__header">
        <h1 className="page-title">Data Types</h1>
      </header>

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
        !showTypesSkeleton &&
          status !== "failed" &&
          (items.length > 0 ? (
            <TypeListTable dataTypes={items} pipelineNameByTypeId={pipelineNameByTypeId} />
          ) : (
            <EmptyState
              variant="main"
              icon={<Layers />}
              title="No types defined"
              description="Types are created by pipelines. Create or run a pipeline to generate a type you can bind to panels."
              cta={createPipelineAction.cta}
            />
          ))
      }
    </div>
  );
}
