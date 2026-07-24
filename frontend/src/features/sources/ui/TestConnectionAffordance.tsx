// Shared "Test connection" affordance (HEL-480) — a lightweight, cheap
// pre-flight connectivity check backed by POST /api/sources/test, usable by
// any source form with a Connector[Config]-backed connection to test (SQL,
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
}

export function TestConnectionAffordance({
  type,
  buildConfig,
  disabled,
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
          className="add-source-modal__btn add-source-modal__btn--secondary"
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
