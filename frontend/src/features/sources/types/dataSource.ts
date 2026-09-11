// DataSource discriminated-union ADT (CS2c-2 wire shape).
//
// The backend exposes 4 source kinds, each with its own typed config; the
// wire shape carries a `type` discriminator and a per-subtype `config`
// payload (DatasetSource has no config field).
//
// Extracted from `./models.ts` so the panel + data-source + pipeline-step
// ADTs each live in their own file.

// HEL-1073: the API returns "dataset" on read; "static" is still accepted on
// write for one minor release as a legacy alias (backend `DataSourceKind.canonicalize`).
export type DataSourceKind = "csv" | "rest_api" | "sql" | "dataset" | "text" | "pdf" | "image";

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

/**
 * Exactly one of `url` (bare-URL branch) or `connectorId` (saved-Connector
 * branch) is present — the backend's own `RestApiConfigPayload` invariant
 * (HEL-824 Decision 1, enforced in `SourceService.createRest`).
 *
 * `url` was previously typed as a required `string`, which was wrong for
 * every connector-backed source: those serialize as
 * `{ connectorId, endpoint, method }` with no `url` at all, so the field
 * arrived `undefined` while TypeScript insisted it was a `string`. Nothing
 * dereferenced it unguarded, so the mistake stayed latent — the `/sources`
 * overview's Location column was the first consumer to read it and get blank
 * cells for real, connector-backed sources.
 */
export interface RestApiSourceConfig {
  url?: string;
  /** Saved-Connector branch; mutually exclusive with `url`. */
  connectorId?: string;
  /** Request path, read INSTEAD of `url` on the `connectorId` branch. */
  endpoint?: string;
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
  /** HEL-909: the source's inferred schema, moved onto the source payload
   *  itself now that the standalone DataType concept is retired. */
  inferredSchema: InferredField[];
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

export interface DatasetSource extends DataSourceBase {
  type: "dataset";
}

// HEL-215: plain text / Markdown connector. `sourceUrl` is present only for
// URL-ingested sources (refresh re-fetches); absent for uploads (refresh
// re-reads the stored file).
export interface TextSourceConfig {
  path: string;
  sourceUrl?: string;
}

export interface TextSource extends DataSourceBase {
  type: "text";
  config: TextSourceConfig;
}

// HEL-214: PDF connector. Same shape as TextSourceConfig — `sourceUrl` is
// present only for URL-ingested sources (refresh re-fetches); absent for
// uploads (refresh re-reads the stored file).
export interface PdfSourceConfig {
  path: string;
  sourceUrl?: string;
}

// HEL-216: image connector. Config shape is identical to `TextSourceConfig`
// — `sourceUrl` is present only for URL-ingested sources (refresh
// re-fetches); absent for uploads (refresh re-reads the stored file).
export interface ImageSourceConfig {
  path: string;
  sourceUrl?: string;
}

export interface PdfSource extends DataSourceBase {
  type: "pdf";
  config: PdfSourceConfig;
}

export interface ImageSource extends DataSourceBase {
  type: "image";
  config: ImageSourceConfig;
}

export type DataSource =
  | CsvSource
  | RestSource
  | SqlSource
  | DatasetSource
  | TextSource
  | PdfSource
  | ImageSource;

// Used by multiple consumers (SourceDetailPanel, refresh dispatcher) so we
// lift them out of the call sites.

export const isCsvSource = (s: DataSource): s is CsvSource => s.type === "csv";
export const isRestSource = (s: DataSource): s is RestSource => s.type === "rest_api";
export const isSqlSource = (s: DataSource): s is SqlSource => s.type === "sql";
export const isStaticSource = (s: DataSource): s is DatasetSource => s.type === "dataset";
export const isTextSource = (s: DataSource): s is TextSource => s.type === "text";
export const isPdfSource = (s: DataSource): s is PdfSource => s.type === "pdf";
export const isImageSource = (s: DataSource): s is ImageSource => s.type === "image";

// Extracted from `types/models.ts` in CS4 cycle 1.

export interface InferredField {
  name: string;
  displayName: string;
  dataType: string;
  nullable: boolean;
}

export type StaticColumnType = "string" | "integer" | "float" | "boolean";

// HEL-1076 design.md Decision 6: `required`/`default` are wire fields the backend now validates
// (`DatasetFieldDeclaration`) -- optional here since `StaticSourceForm` doesn't populate them yet
// (that's form-panel UX, epic 2); a caller that sets them (MCP, a future UI) is honored.
export interface StaticColumn {
  name: string;
  type: StaticColumnType;
  required?: boolean;
  default?: unknown;
}

export interface StaticSourcePayload {
  name: string;
  type: "dataset";
  columns: StaticColumn[];
  rows: unknown[][];
}

// HEL-1077: POST (append) / PUT (replace) /api/data-sources/:id/rows.

/** Request body for both row-write routes -- positional row arrays, one array per row, cell
 *  order matching the source's declared column order (never object-keyed). */
export interface RowWriteRequest {
  rows: unknown[][];
}

/** One affected row's identity/version. `updatedAt` is per-ROW (not just the source's) -- a
 *  future per-row edit/delete precondition binds to the row's own `updatedAt`. */
export interface RowWriteRow {
  id: string;
  seq: number;
  updatedAt: string;
}

/** Response body for both row-write routes. `rows` carries only the newly appended rows on
 *  POST, or the full new set on PUT. Row `data` is deliberately omitted -- fetch rows through
 *  the existing preview/read path. */
export interface RowWriteResponse {
  rows: RowWriteRow[];
  updatedAt: string;
}

/** HEL-1078: the single row a successful PATCH .../rows/:rowId edited -- unlike `RowWriteRow`,
 *  this DOES carry the row's full post-write `data`, since the caller submitted the full row and
 *  the response confirms exactly what was persisted. */
export interface RowResponseRow {
  id: string;
  seq: number;
  updatedAt: string;
  data: unknown[];
}

/** Response body for `PATCH /api/data-sources/:id/rows/:rowId` -- the edited row plus the
 *  source-level `updatedAt`. `DELETE .../rows/:rowId` returns `204` with no body. */
export interface RowResponse {
  row: RowResponseRow;
  sourceUpdatedAt: string;
}

// HEL-1121: GET /api/data-sources/:id/rows -- paged row listing with identity, for HEL-1080's
// grid to drive HEL-1078's PATCH/DELETE precondition header.

/** Response body for `GET /api/data-sources/:id/rows`. `rows` reuses `RowResponseRow` verbatim,
 *  ordered by ascending `seq`. `nextCursor` is genuinely ABSENT (not `undefined`-but-present, not
 *  `null`) when no further rows remain -- the backend omits the key entirely on the wire. */
export interface RowListResponse {
  rows: RowResponseRow[];
  nextCursor?: number;
  total: number;
}

// HEL-1122: GET /api/data-sources/:id/schema -- the declared field list a dataset source's row
// grid (HEL-1080) needs to render typed columns/editors, rather than inferring shape from row 0.

/** The full declared field-type set (design.md Decision 6) -- distinct from `StaticColumnType`
 *  above, which predates `StringBodyType`/`BinaryRefType` and is scoped to the create-source
 *  form's own (narrower) supported set. */
export type DatasetFieldType =
  | "string"
  | "integer"
  | "float"
  | "boolean"
  | "timestamp"
  | "string-body"
  | "binary-ref";

/** One declared field, mirroring the backend's `DatasetFieldResponse` field-for-field.
 *  `required` is always present (never omitted, even when `false`); `default` is genuinely
 *  absent (not `null`) when the field has no declared default. */
export interface DatasetFieldResponse {
  name: string;
  type: DatasetFieldType;
  required: boolean;
  default?: unknown;
}

export interface DatasetSchemaResponse {
  fields: DatasetFieldResponse[];
}

// HEL-1124: PATCH /api/data-sources/:id/schema -- full-replacement declared-schema write.
// `DatasetSchemaResponse` above (GET's shipped shape) is left completely untouched; these are
// new, distinct types (design.md Decision 6).

/** One field edit in the PATCH request body. `previousName` identifies a rename (omit for an
 *  added field or an unrenamed kept field). `default` is `null` for an explicit null default,
 *  a value for a supplied default, or the key omitted entirely for "no default supplied in
 *  this request" -- mirroring the backend's `Option[Option[JsValue]]` wire idiom. */
export interface DatasetFieldDeclarationPayload {
  name: string;
  previousName?: string;
  type: DatasetFieldType;
  required?: boolean;
  default?: unknown;
}

export interface UpdateDatasetSchemaRequest {
  fields: DatasetFieldDeclarationPayload[];
  /** Explicit, request-level opt-in required to drop a field with existing data. Defaults to
   *  `false` when omitted. */
  confirmDrop?: boolean;
}

/** 200 response -- a NEW, DISTINCT type from `DatasetSchemaResponse` (never touched by this
 *  ticket). `rowsMigrated` is `0` for a pure rename, else the full existing row count. */
export interface DatasetSchemaUpdateResponse {
  fields: DatasetFieldResponse[];
  rowsMigrated: number;
}

/** One rejected field's name and human-readable reason, inside a 409 `SchemaUpdateConflictResponse`. */
export interface SchemaFieldRejection {
  name: string;
  reason: string;
}

/** 409 response body when the edit is incompatible with the dataset's existing rows. */
export interface SchemaUpdateConflictResponse {
  rejectedFields: SchemaFieldRejection[];
  message: string;
}
