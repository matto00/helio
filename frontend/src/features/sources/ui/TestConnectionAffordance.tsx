// Shared "Test connection" affordance (HEL-480) — a lightweight, cheap
// pre-flight connectivity check backed by POST /api/sources/test, usable by
// any source form with a ConnectorDriver[Config]-backed connection to test (SQL,
// REST API today). Distinct from schema inference: it never populates a
// schema preview and never gates a downstream "Create source" action.

import { useState } from "react";

import "./TestConnectionAffordance.css";
import { InlineError } from "../../../shared/chrome/InlineError";
import { testConnection } from "../services/dataSourceService";
import type { RestApiConfigBody, SqlSourceConfig } from "../services/dataSourceService";

type ConnectionTestState = "idle" | "pending" | "success" | "error";

interface TestConnectionAffordanceProps {
  type: "sql" | "rest_api";
  buildConfig: () => SqlSourceConfig | RestApiConfigBody;
  disabled?: boolean;
  /** HEL-824 skeptic design-round-2 non-blocking note 5: `AddSourceModal`'s own chrome class
   *  by default, so existing callers are unaffected — pass a page-local class when reusing this
   *  affordance outside `/sources` (e.g. `/connectors`) rather than pulling in
   *  `add-source-modal__btn`'s sources-modal-specific styling. */
  buttonClassName?: string;
}

export function TestConnectionAffordance({
  type,
  buildConfig,
  disabled,
  buttonClassName = "add-source-modal__btn add-source-modal__btn--secondary",
}: TestConnectionAffordanceProps) {
  const [state, setState] = useState<ConnectionTestState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setState("pending");
    setError(null);

    try {
      const result = await testConnection(type, buildConfig());
      if (result.ok) {
        setState("success");
      } else {
        setState("error");
        setError(result.error ?? "Connection test failed.");
      }
    } catch {
      setState("error");
      setError("Connection test failed.");
    }
  }

  return (
    <div className="test-connection-affordance">
      <div className="test-connection-affordance__row">
        <button
          type="button"
          className={buttonClassName}
          onClick={() => void handleClick()}
          disabled={disabled || state === "pending"}
        >
          {state === "pending" ? "Testing…" : "Test connection"}
        </button>
        {state === "success" && (
          <span className="test-connection-affordance__success">✓ Connected</span>
        )}
      </div>
      {state === "error" && <InlineError error={error} />}
    </div>
  );
}
