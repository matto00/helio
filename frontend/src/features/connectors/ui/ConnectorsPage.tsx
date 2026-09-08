// HEL-824: the Connectors page — list/create/edit/delete, credential entry
// and rotation UX, implicit-Connector presentation, dependent-blocked-delete
// UX, connection-test integration. Built from `shared/ui/` primitives per
// DESIGN.md Decision 4 — a plain table (mirrors `SourcesPage`'s own table
// shape), not `DataGrid` (the row shape — name/kind/host/masked
// credential/dependents/actions — doesn't fit a sortable/filterable grid any
// better than a plain table would).

import { Fragment, useEffect, useState } from "react";
import { Link2 } from "lucide-react";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { useIsNarrowerThan } from "../../../hooks/useIsNarrowerThan";
import { useToast } from "../../toasts/hooks/useToast";
import { ConfirmInline, EmptyState, StatusChip } from "../../../shared/ui/index";
import { InlineError } from "../../../shared/chrome/InlineError";
import { ActionsMenu, type ActionsMenuItem } from "../../../shared/chrome/ActionsMenu";
import { useSortedRows, type SortColumn } from "../../../shared/ui/useSortedRows";
import { SortableTable, type SortableTableColumn } from "../../../shared/ui/SortableTable";
import { PageContentSkeleton } from "../../../shared/ui/PageContentSkeleton";
import { PageHeader } from "../../../shared/ui/PageHeader";
import { PageShell } from "../../../shared/ui/PageShell";
import { PageStatus } from "../../../shared/ui/PageStatus";
import { formatRelativeTime } from "../../../utils/formatRelativeTime";
import { TestConnectionAffordance } from "../../sources/ui/TestConnectionAffordance";
import { testConnection } from "../../sources/services/dataSourceService";
import { clearDeleteConflict, deleteConnector, fetchConnectors } from "../state/connectorsSlice";
import type { Connector } from "../types/connector";
import { CreateConnectorModal } from "./CreateConnectorModal";
import { EditConnectorModal } from "./EditConnectorModal";
import "./ConnectorsPage.css";

// HEL-1022 (skeptic REFUTE finding 3): below this width the sticky Actions
// column plus a visible "Test connection" button ate 52% of the table's
// visible clientWidth at 430px, leaving Name and one truncated character of
// Kind. The human's ruling: fold "Test connection" into the `ActionsMenu`
// below this breakpoint (sticky cell shrinks to just the ~44px trigger); at
// and above it, "Test connection" stays a standalone visible button exactly
// as before. Matches the connector-table's own `min-width: 880px` intent --
// 1100px is comfortably above that, so the standalone button never actually
// competes for space up there.
const TEST_CONNECTION_MENU_BREAKPOINT_PX = 1100;

// HEL-955 design.md D10 / skeptic-final-1.md CR3: the owner-visible completion signal --
// design.md's own Risks section states the up-to-24-hour residual-risk acceptance holds "only
// because of D10's owner-visible completion signal", so it must actually be rendered, not merely
// stored/typed. Distinguishes an out-of-band anonymous completion from a named principal (the
// completing session's own user id) -- the whole point of the signal.
function completionLabel(connector: Connector): string | null {
  if (!connector.completedAt) return null;
  const when = new Date(connector.completedAt).toLocaleString();
  const by = connector.completedBy === "anonymous" ? "anonymously" : `by ${connector.completedBy}`;
  return `Completed ${by} · ${when}`;
}

function authTypeLabel(connector: Connector): string {
  switch (connector.config.authType) {
    case "bearer":
      return "Bearer token";
    case "api_key":
      return "API key";
    default:
      return "No auth";
  }
}

type SortKey = "name" | "kind" | "baseUrl" | "credential" | "dependents" | "updatedAt";

const SORT_COLUMNS: readonly SortColumn<Connector, SortKey>[] = [
  { key: "name", getValue: (c) => c.name },
  { key: "kind", getValue: (c) => c.kind },
  { key: "baseUrl", getValue: (c) => c.baseUrl },
  { key: "credential", getValue: (c) => authTypeLabel(c) },
  { key: "dependents", getValue: (c) => c.dependentCount },
  { key: "updatedAt", getValue: (c) => c.updatedAt },
];

// HEL-1022: the page's default sort key (`updatedAt desc`) must be a visible,
// sortable column, or nothing on first paint shows the user what order
// they're looking at, and sorting away from it leaves no way back. Matches
// `SourceListTable`'s "Updated" column exactly (same relative-time
// formatter, same trailing position).
const HEADER_COLUMNS: readonly SortableTableColumn<SortKey>[] = [
  { key: "name", header: "Name", className: "eyebrow connectors-page__th" },
  { key: "kind", header: "Kind", className: "eyebrow connectors-page__th" },
  { key: "baseUrl", header: "Base URL", className: "eyebrow connectors-page__th" },
  { key: "credential", header: "Credential", className: "eyebrow connectors-page__th" },
  { key: "dependents", header: "Dependents", className: "eyebrow connectors-page__th" },
  { key: "updatedAt", header: "Updated", className: "eyebrow connectors-page__th" },
];

export function ConnectorsPage() {
  const dispatch = useAppDispatch();
  const { push: pushToast } = useToast();
  const { items, status, error, deleteConflict } = useAppSelector((state) => state.connectors);

  // HEL-1022: defaults to most-recently-updated first, matching the
  // backend's own default ordering (`ConnectorRepository.findAll`) for
  // first paint.
  const {
    sortedRows: sortedItems,
    sortState,
    toggleSort,
  } = useSortedRows(items, SORT_COLUMNS, {
    key: "updatedAt",
    direction: "desc",
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editingConnector, setEditingConnector] = useState<Connector | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // HEL-1022: genuinely reactive (matchMedia + resize listener), not a
  // CSS-hidden duplicate -- exactly one of the standalone button / menu item
  // is ever mounted for a given width, so "Test connection" is never
  // reachable twice (or zero times) via keyboard/screen reader at any width.
  const isNarrow = useIsNarrowerThan(TEST_CONNECTION_MENU_BREAKPOINT_PX);

  // HEL-1022: the menu-item path for "Test connection" -- `TestConnectionAffordance`'s own
  // inline pending/success/error UI has nowhere to live once `ActionsMenu` closes the popover on
  // click (`handleItemClick` calls `close()` before `item.onClick()`), so this calls the same
  // `testConnection` service directly and surfaces the result via the existing toast channel
  // (already used for delete) instead. The standalone-button path (>= breakpoint) is untouched --
  // it keeps `TestConnectionAffordance`'s own inline UI exactly as it always has.
  async function handleTestConnectionFromMenu(connector: Connector) {
    try {
      const result = await testConnection("rest_api", { connectorId: connector.id });
      if (result.ok) {
        pushToast({ variant: "success", message: `Connection to "${connector.name}" succeeded.` });
      } else {
        pushToast({
          variant: "error",
          message: result.error ?? `Connection to "${connector.name}" failed.`,
        });
      }
    } catch {
      pushToast({ variant: "error", message: `Connection to "${connector.name}" failed.` });
    }
  }

  useEffect(() => {
    if (status === "idle") {
      void dispatch(fetchConnectors());
    }
  }, [status, dispatch]);

  async function handleDelete(connector: Connector) {
    const result = await dispatch(
      deleteConnector({ id: connector.id, dependentCount: connector.dependentCount }),
    );
    setConfirmDeleteId(null);
    if (deleteConnector.fulfilled.match(result)) {
      pushToast({ variant: "success", message: `Connector "${connector.name}" deleted.` });
    }
  }

  // HEL-1022: this page had no loading branch at all -- during the initial
  // fetch it fell through to the table with a still-empty `items` array,
  // rendering a headers-only table (or, worse, an empty-state flash) instead
  // of the same loading skeleton every other section overview shows. Mirrors
  // `PipelinesPage`/`SourcesPage`'s identical `idle || loading` + empty-items
  // gate (design.md D3/D11 — a `loading`-only gate misses the mount effect's
  // post-paint dispatch and flashes the empty state for one frame).
  const isRetryingConnectors = status === "loading";
  const showConnectorsSkeleton = (status === "idle" || status === "loading") && items.length === 0;

  return (
    <PageShell className="connectors-page">
      <PageHeader title="Connectors" />

      {showConnectorsSkeleton && (
        <PageStatus status="loading" variant="skeleton">
          <PageContentSkeleton />
        </PageStatus>
      )}

      {status === "failed" && (
        <PageStatus
          status="failed"
          title="Couldn't load connectors"
          message={error ?? undefined}
          onRetry={() => dispatch(fetchConnectors())}
          retrying={isRetryingConnectors}
        />
      )}

      {!showConnectorsSkeleton &&
        status !== "failed" &&
        (items.length === 0 ? (
          <div className="connectors-page__empty">
            <EmptyState
              icon={<Link2 />}
              title="No connectors yet"
              description="Add a connector to save a credentialed host that data sources can reuse."
              cta={{ label: "Add connector", onClick: () => setCreateOpen(true) }}
            />
          </div>
        ) : (
          <>
            <SortableTable
              tableClassName="connectors-page__table"
              columns={HEADER_COLUMNS}
              sortState={sortState}
              onSort={toggleSort}
              trailingHeaderCells={
                <th className="eyebrow connectors-page__th connectors-page__th--actions">
                  <span className="sr-only">Actions</span>
                </th>
              }
              scrollClassNames={{
                container: "connectors-page__scroll",
                left: "connectors-page__scroll--left",
                right: "connectors-page__scroll--right",
              }}
              // Keyboard-focusable scrollable region: a keyboard user who
              // can't drag a scrollbar can still Tab into the table and use
              // arrow keys to reach a narrow-viewport-only column (e.g.
              // Delete). See `SortableTable.scrollAriaLabel`'s own doc.
              scrollAriaLabel="Connectors table"
            >
              <tbody>
                {sortedItems.map((connector) => {
                  const isConfirmingDelete = confirmDeleteId === connector.id;
                  const conflict = deleteConflict[connector.id];
                  const isImplicit = connector.config.implicit === true;
                  const completion = completionLabel(connector);
                  return (
                    <Fragment key={connector.id}>
                      <tr className="connectors-page__row">
                        <td className="connectors-page__td">
                          <div className="connectors-page__name-cell">
                            {connector.name}
                            {connector.pending && (
                              <StatusChip intent="warning" dashed>
                                Pending completion
                              </StatusChip>
                            )}
                            {isImplicit && (
                              <StatusChip intent="neutral" dashed>
                                Auto-created
                              </StatusChip>
                            )}
                          </div>
                          {completion && (
                            <div
                              className="connectors-page__completion-signal"
                              data-testid={`completion-signal-${connector.id}`}
                            >
                              {completion}
                            </div>
                          )}
                        </td>
                        <td className="connectors-page__td">{connector.kind}</td>
                        <td className="connectors-page__td connectors-page__td--mono">
                          {connector.baseUrl}
                        </td>
                        <td className="connectors-page__td">{authTypeLabel(connector)}</td>
                        <td className="connectors-page__td">
                          {connector.dependentCount} source
                          {connector.dependentCount === 1 ? "" : "s"}
                        </td>
                        <td className="connectors-page__td">
                          {formatRelativeTime(connector.updatedAt)}
                        </td>
                        <td className="connectors-page__td connectors-page__td--actions">
                          {isConfirmingDelete ? (
                            // HEL-1022: the menu that triggered this has already closed (see
                            // `ActionsMenu.handleItemClick`, which calls `close()` before
                            // `item.onClick()`) -- the inline confirm has nowhere else to live
                            // once it does, so it swaps into this same cell exactly as it did
                            // before Edit/Delete moved into a menu. Chosen over a modal confirm
                            // because it's the LEAST behavior change: the row stays the visible
                            // anchor for "what am I confirming", matching `DashboardList`'s own
                            // ActionsMenu-triggered-inline-confirm precedent.
                            <ConfirmInline
                              confirmAriaLabel={`Confirm delete ${connector.name}`}
                              onConfirm={() => void handleDelete(connector)}
                              onCancel={() => setConfirmDeleteId(null)}
                            />
                          ) : (
                            <div className="connectors-page__row-actions">
                              {/* HEL-1022: standalone below `TEST_CONNECTION_MENU_BREAKPOINT_PX`
                                  ONLY at/above it -- exactly one of this button / the menu item
                                  below is ever mounted for the current width. */}
                              {!isNarrow && (
                                <TestConnectionAffordance
                                  type="rest_api"
                                  buildConfig={() => ({ connectorId: connector.id })}
                                  buttonClassName="connectors-page__btn connectors-page__btn--secondary"
                                />
                              )}
                              <ActionsMenu
                                label={`${connector.name} actions`}
                                items={[
                                  ...(isNarrow
                                    ? ([
                                        {
                                          label: "Test connection",
                                          onClick: () =>
                                            void handleTestConnectionFromMenu(connector),
                                        },
                                      ] satisfies ActionsMenuItem[])
                                    : []),
                                  {
                                    label: "Edit",
                                    onClick: () => setEditingConnector(connector),
                                  },
                                  {
                                    label: "Delete",
                                    danger: true,
                                    // HEL-824 skeptic-final-1.md change request 4:
                                    // `ConnectorEntityService.delete` returns 409
                                    // unconditionally whenever `dependentCount > 0` -- there
                                    // is no force-delete path. Offering a confirm that can
                                    // never succeed is a false affordance, so Delete is
                                    // disabled up front instead of promising an "anyway"
                                    // override that doesn't exist. `ActionsMenuItem` has no
                                    // `title` slot for the explanatory tooltip the old plain
                                    // `<button disabled title=...>` carried -- the disabled
                                    // state itself still communicates "unavailable"; the
                                    // longer explanation is a acceptable loss for the
                                    // popover's compactness, not a silent regression.
                                    disabled: connector.dependentCount > 0,
                                    onClick: () => {
                                      dispatch(clearDeleteConflict(connector.id));
                                      setConfirmDeleteId(connector.id);
                                    },
                                  },
                                ]}
                              />
                            </div>
                          )}
                        </td>
                      </tr>
                      {conflict && (
                        <tr className="connectors-page__row connectors-page__conflict-row">
                          {/* HEL-824 skeptic-final-1.md change request 2: a full-width row
                            beneath the connector's own row, outside the nowrap `--actions`
                            cell -- a `white-space: nowrap` ancestor forced this message onto
                            one unbreakable line that ran off-screen at every breakpoint
                            tested, at up to 734px overflow. This cell explicitly allows
                            wrapping (`--td--conflict`) and can never drive table width. */}
                          <td
                            className="connectors-page__td connectors-page__td--conflict"
                            colSpan={7}
                          >
                            <InlineError error={conflict} variant="banner" />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </SortableTable>

            {/* Below the list, matching Pipelines/Sources/Metrics. */}
            <div className="connectors-page__toolbar">
              <button
                type="button"
                className="connectors-page__btn connectors-page__btn--primary"
                onClick={() => setCreateOpen(true)}
              >
                Add connector
              </button>
            </div>
          </>
        ))}

      {createOpen && <CreateConnectorModal onClose={() => setCreateOpen(false)} />}
      {editingConnector && (
        <EditConnectorModal
          connector={editingConnector}
          onClose={() => setEditingConnector(null)}
        />
      )}
    </PageShell>
  );
}
