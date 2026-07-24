import { useState } from "react";

import "./SqlTab.css";
import { DataGrid, TextField, Textarea } from "../../../shared/ui/index";
import type { ColumnDef } from "../../../shared/ui/index";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { inferSqlSource } from "../state/sourcesSlice";
import type { InferredField } from "../types/dataSource";
import type { SqlSourceConfig } from "../services/dataSourceService";
import { TestConnectionAffordance } from "./TestConnectionAffordance";

const INFERRED_FIELD_COLUMNS: ColumnDef[] = [
  { key: "name", header: "Field name" },
  { key: "dataType", header: "Type" },
  { key: "nullable", header: "Nullable", render: (_row, value) => (value ? "yes" : "no") },
];

type Dialect = "postgresql" | "mysql";

const DEFAULT_PORTS: Record<Dialect, number> = {
  postgresql: 5432,
  mysql: 3306,
};

interface SqlTabProps {
  /** Called when schema has been inferred and the user wants to save the source. */
  onSave: (name: string, config: SqlSourceConfig, inferredFields: InferredField[]) => void;
  isSaving: boolean;
  name: string;
}

export function SqlTab({ onSave, isSaving, name }: SqlTabProps) {
  const dispatch = useAppDispatch();

  const [dialect, setDialect] = useState<Dialect>("postgresql");
  const [host, setHost] = useState("");
  const [port, setPort] = useState<number>(DEFAULT_PORTS.postgresql);
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");

  const [isTesting, setIsTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [inferredFields, setInferredFields] = useState<InferredField[] | null>(null);

  function handleDialectChange(next: Dialect) {
    setDialect(next);
    setPort(DEFAULT_PORTS[next]);
  }

  function buildConfig(): SqlSourceConfig {
    return { dialect, host, port, database, user: username, password, query };
  }

  async function handleTestConnection() {
    setIsTesting(true);
    setTestError(null);
    setInferredFields(null);

    const result = await dispatch(inferSqlSource(buildConfig()));

    if (inferSqlSource.fulfilled.match(result)) {
      setInferredFields(result.payload);
    } else {
      const msg =
        typeof result.payload === "string"
          ? result.payload
          : "Failed to connect to the database. Check your settings and try again.";
      setTestError(msg);
    }

    setIsTesting(false);
  }

  function handleSave() {
    onSave(name, buildConfig(), inferredFields ?? []);
  }

  return (
    <div className="sql-tab">
      <div className="add-source-modal__field">
        <span className="add-source-modal__label">Dialect</span>
        <div className="add-source-modal__type-toggle" role="group" aria-label="Database dialect">
          <button
            type="button"
            className={
              dialect === "postgresql"
                ? "add-source-modal__type-btn add-source-modal__type-btn--active"
                : "add-source-modal__type-btn"
            }
            onClick={() => handleDialectChange("postgresql")}
          >
            PostgreSQL
          </button>
          <button
            type="button"
            className={
              dialect === "mysql"
                ? "add-source-modal__type-btn add-source-modal__type-btn--active"
                : "add-source-modal__type-btn"
            }
            onClick={() => handleDialectChange("mysql")}
          >
            MySQL
          </button>
        </div>
      </div>

      <div className="add-source-modal__field">
        <label className="add-source-modal__label" htmlFor="sql-host">
          Host
        </label>
        <TextField
          id="sql-host"
          type="text"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="localhost"
        />
      </div>

      <div className="add-source-modal__field">
        <label className="add-source-modal__label" htmlFor="sql-port">
          Port
        </label>
        <TextField
          id="sql-port"
          type="number"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
        />
      </div>

      <div className="add-source-modal__field">
        <label className="add-source-modal__label" htmlFor="sql-database">
          Database
        </label>
        <TextField
          id="sql-database"
          type="text"
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
          placeholder="my_database"
        />
      </div>

      <div className="add-source-modal__field">
        <label className="add-source-modal__label" htmlFor="sql-username">
          Username
        </label>
        <TextField
          id="sql-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="db_user"
        />
      </div>

      <div className="add-source-modal__field">
        <label className="add-source-modal__label" htmlFor="sql-password">
          Password
        </label>
        <TextField
          id="sql-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="add-source-modal__field">
        <label className="add-source-modal__label" htmlFor="sql-query">
          Query
        </label>
        <Textarea
          id="sql-query"
          mono
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="SELECT * FROM my_table LIMIT 100"
          rows={4}
        />
      </div>

      <div className="add-source-modal__actions add-source-modal__actions--between">
        <div className="sql-tab__actions-group">
          <button
            type="button"
            className="add-source-modal__btn add-source-modal__btn--secondary"
            onClick={() => void handleTestConnection()}
            disabled={isTesting || isSaving}
          >
            {isTesting ? "Testing…" : "Infer schema"}
          </button>

          <TestConnectionAffordance type="sql" buildConfig={buildConfig} />
        </div>

        <button
          type="button"
          className="add-source-modal__btn add-source-modal__btn--primary"
          onClick={handleSave}
          disabled={isSaving || isTesting || inferredFields === null}
        >
          {isSaving ? "Creating…" : "Create source"}
        </button>
      </div>

      {testError && (
        <p className="add-source-modal__error" role="alert">
          {testError}
        </p>
      )}

      {inferredFields !== null && inferredFields.length > 0 && (
        <div className="sql-tab__schema-preview">
          <p className="add-source-modal__preview-hint">
            Connection successful — {inferredFields.length} field
            {inferredFields.length !== 1 ? "s" : ""} inferred:
          </p>
          <DataGrid
            variant="preview"
            rows={inferredFields as unknown as Record<string, unknown>[]}
            columns={INFERRED_FIELD_COLUMNS}
          />
        </div>
      )}

      {inferredFields !== null && inferredFields.length === 0 && (
        <p className="add-source-modal__empty">Connection succeeded but no fields were detected.</p>
      )}
    </div>
  );
}
