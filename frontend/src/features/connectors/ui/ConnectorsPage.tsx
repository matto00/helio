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
import { useToast } from "../../toasts/hooks/useToast";
import { ConfirmInline, EmptyState, StatusChip } from "../../../shared/ui/index";
import { InlineError } from "../../../shared/chrome/InlineError";
import { TestConnectionAffordance } from "../../sources/ui/TestConnectionAffordance";
import { clearDeleteConflict, deleteConnector, fetchConnectors } from "../state/connectorsSlice";
import type { Connector } from "../types/connector";
import { CreateConnectorModal } from "./CreateConnectorModal";
import { EditConnectorModal } from "./EditConnectorModal";
import "./ConnectorsPage.css";

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

export function ConnectorsPage() {
  const dispatch = useAppDispatch();
  const { push: pushToast } = useToast();
  const { items, status, error, deleteConflict } = useAppSelector((state) => state.connectors);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingConnector, setEditingConnector] = useState<Connector | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  return (
    <div className="connectors-page">
      <header className="connectors-page__header">
        <div>
          <h1 className="connectors-page__title">Connectors</h1>
          <p className="connectors-page__subtitle">
            Saved, reusable credentialed hosts that data sources can reference.
          </p>
        </div>
        {items.length > 0 && (
          <button
            type="button"
            className="connectors-page__btn connectors-page__btn--primary"
            onClick={() => setCreateOpen(true)}
          >
            Add connector
          </button>
        )}
      </header>

      {status === "failed" && <InlineError error={error} variant="banner" />}

      {status === "succeeded" && items.length === 0 ? (
        <div className="connectors-page__empty">
          <EmptyState
            icon={<Link2 />}
            title="No connectors yet"
            description="Add a connector to save a credentialed host that data sources can reuse."
            cta={{ label: "Add connector", onClick: () => setCreateOpen(true) }}
          />
        </div>
      ) : (
        <table className="connectors-page__table">
          <thead>
            <tr>
              <th className="connectors-page__th">Name</th>
              <th className="connectors-page__th">Kind</th>
              <th className="connectors-page__th">Base URL</th>
              <th className="connectors-page__th">Credential</th>
              <th className="connectors-page__th">Dependents</th>
              <th className="connectors-page__th connectors-page__th--actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((connector) => {
              const isConfirmingDelete = confirmDeleteId === connector.id;
              const conflict = deleteConflict[connector.id];
              const isImplicit = connector.config.implicit === true;
              return (
                <Fragment key={connector.id}>
                  <tr className="connectors-page__row">
                    <td className="connectors-page__td">
                      <div className="connectors-page__name-cell">
                        {connector.name}
                        {isImplicit && (
                          <StatusChip intent="neutral" dashed>
                            Auto-created
                          </StatusChip>
                        )}
                      </div>
                    </td>
                    <td className="connectors-page__td">{connector.kind}</td>
                    <td className="connectors-page__td connectors-page__td--mono">
                      {connector.baseUrl}
                    </td>
                    <td className="connectors-page__td">{authTypeLabel(connector)}</td>
                    <td className="connectors-page__td">
                      {connector.dependentCount} source{connector.dependentCount === 1 ? "" : "s"}
                    </td>
                    <td className="connectors-page__td connectors-page__td--actions">
                      {isConfirmingDelete ? (
                        <ConfirmInline
                          confirmAriaLabel={`Confirm delete ${connector.name}`}
                          onConfirm={() => void handleDelete(connector)}
                          onCancel={() => setConfirmDeleteId(null)}
                        />
                      ) : (
                        <div className="connectors-page__row-actions">
                          <TestConnectionAffordance
                            type="rest_api"
                            buildConfig={() => ({ connectorId: connector.id })}
                            buttonClassName="connectors-page__btn connectors-page__btn--secondary"
                          />
                          <button
                            type="button"
                            className="connectors-page__btn connectors-page__btn--secondary"
                            onClick={() => setEditingConnector(connector)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="connectors-page__btn connectors-page__btn--danger"
                            aria-label={`Delete ${connector.name}`}
                            // HEL-824 skeptic-final-1.md change request 4:
                            // `ConnectorEntityService.delete` returns 409
                            // unconditionally whenever `dependentCount > 0` --
                            // there is no force-delete path. Offering a
                            // confirm that can never succeed is a false
                            // affordance, so Delete is disabled up front
                            // instead of promising an "anyway" override that
                            // doesn't exist.
                            disabled={connector.dependentCount > 0}
                            title={
                              connector.dependentCount > 0
                                ? "Remove or repoint the dependent source(s) before deleting this connector."
                                : undefined
                            }
                            onClick={() => {
                              dispatch(clearDeleteConflict(connector.id));
                              setConfirmDeleteId(connector.id);
                            }}
                          >
                            Delete
                          </button>
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
                      <td className="connectors-page__td connectors-page__td--conflict" colSpan={6}>
                        <InlineError error={conflict} variant="banner" />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {createOpen && <CreateConnectorModal onClose={() => setCreateOpen(false)} />}
      {editingConnector && (
        <EditConnectorModal
          connector={editingConnector}
          onClose={() => setEditingConnector(null)}
        />
      )}
    </div>
  );
}
