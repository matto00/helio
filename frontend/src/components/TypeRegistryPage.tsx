import { useEffect } from "react";

import "./TypeRegistryPage.css";
import { fetchDataTypes } from "../features/dataTypes/dataTypesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { TypeRegistryBrowser } from "./TypeRegistryBrowser";

export function TypeRegistryPage() {
  const dispatch = useAppDispatch();
  const { status, error } = useAppSelector((state) => state.dataTypes);

  useEffect(() => {
    void dispatch(fetchDataTypes());
  }, [dispatch]);

  return (
    <div className="type-registry-page">
      {status === "loading" && <p className="type-registry-page__loading">Loading types…</p>}
      {status === "failed" && error && (
        <p className="type-registry-page__error" role="alert">
          {error}
        </p>
      )}
      {(status === "succeeded" || status === "idle") && <TypeRegistryBrowser />}
    </div>
  );
}
