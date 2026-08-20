import { useEffect } from "react";

import "./TypeRegistryPage.css";
import { fetchDataTypes } from "../state/dataTypesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ERROR_KIND_ICON } from "../../../shared/chrome/InlineError";
import { TypeRegistryBrowser } from "./TypeRegistryBrowser";

export function TypeRegistryPage() {
  const dispatch = useAppDispatch();
  const { status, error, errorKind } = useAppSelector((state) => state.dataTypes);

  useEffect(() => {
    void dispatch(fetchDataTypes());
  }, [dispatch]);

  // Computed outside the `status === "failed"`-narrowed JSX branch below.
  const isRetryingTypes = status === "loading";
  const TypesErrorIcon = ERROR_KIND_ICON[errorKind ?? "error"];

  return (
    <div className="type-registry-page">
      {status === "loading" && <p className="type-registry-page__loading">Loading types…</p>}
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
      {(status === "succeeded" || status === "idle") && <TypeRegistryBrowser />}
    </div>
  );
}
