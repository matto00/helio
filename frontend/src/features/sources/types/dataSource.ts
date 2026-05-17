// DataSource discriminated-union ADT (CS2c-2 wire shape).
//
// The backend exposes 4 source kinds, each with its own typed config; the
// wire shape carries a `type` discriminator and a per-subtype `config`
// payload (StaticSource has no config field).
//
// Extracted from `./models.ts` so the panel + data-source + pipeline-step
// ADTs each live in their own file.

export type DataSourceKind = "csv" | "rest_api" | "sql" | "static";

export interface CsvSourceConfig {
  path: string;
}

export type RestApiMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface RestApiAuth {
  type: "none" | "bearer" | "api_key";
  token?: string;
  name?: string;
  value?: string;
  in?: "header" | "query";
}

export interface RestApiSourceConfig {
  url: string;
  method?: RestApiMethod;
  auth?: RestApiAuth;
  headers?: Record<string, string>;
}

export interface SqlSourceConfig {
  dialect: "postgresql" | "mysql";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  query: string;
}

interface DataSourceBase {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CsvSource extends DataSourceBase {
  type: "csv";
  config: CsvSourceConfig;
}

export interface RestSource extends DataSourceBase {
  type: "rest_api";
  config: RestApiSourceConfig;
}

export interface SqlSource extends DataSourceBase {
  type: "sql";
  config: SqlSourceConfig;
}

export interface StaticSource extends DataSourceBase {
  type: "static";
}

export type DataSource = CsvSource | RestSource | SqlSource | StaticSource;

// ── Type-narrowing helpers ───────────────────────────────────────────────────
// Used by 3+ consumers (DataSourceList, SourceDetailPanel, refresh dispatcher)
// so we lift them out of the call sites.

export const isCsvSource = (s: DataSource): s is CsvSource => s.type === "csv";
export const isRestSource = (s: DataSource): s is RestSource => s.type === "rest_api";
export const isSqlSource = (s: DataSource): s is SqlSource => s.type === "sql";
export const isStaticSource = (s: DataSource): s is StaticSource => s.type === "static";

// ── Source schema + static-source payload types ─────────────────────────────
// Extracted from `types/models.ts` in CS4 cycle 1.

export interface InferredField {
  name: string;
  displayName: string;
  dataType: string;
  nullable: boolean;
}

export type StaticColumnType = "string" | "integer" | "float" | "boolean";

export interface StaticColumn {
  name: string;
  type: StaticColumnType;
}

export interface StaticSourcePayload {
  name: string;
  type: "static";
  columns: StaticColumn[];
  rows: unknown[][];
}
