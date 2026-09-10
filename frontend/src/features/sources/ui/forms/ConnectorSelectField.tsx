// HEL-827 design.md Decision 1: Connector picker for the REST source form.
// Lists existing Connectors (connectorsSlice) and offers "Create new
// Connector", launching CreateConnectorModal inline (modal-over-modal — see
// design.md Decision 1) and selecting the returned Connector via its
// `onCreated` callback (design.md Decision 1 / tasks 2.2).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import { Select } from "../../../../shared/ui/Select";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { fetchConnectors } from "../../../connectors/state/connectorsSlice";
import { CreateConnectorModal } from "../../../connectors/ui/CreateConnectorModal";
import type { Connector } from "../../../connectors/types/connector";
import "./ConnectorSelectField.css";
import { Plug } from "lucide-react";

const CREATE_NEW_VALUE = "__create_new__";

// HEL-845 design.md Decision 5: the guarantee against binding a REST source to a
// mismatched-kind Connector lives server-side (SourceService.createRest / RestApiConnectorDriver
// .resolveConnector) — this filter is an affordance only, keeping the user out of a known-bad
// state before they can enter it. It enforces nothing on its own.
const REST_API_KIND = "rest_api";

interface ConnectorSelectFieldProps {
  connector: Connector | null;
  onChange: (connector: Connector | null) => void;
}

export function ConnectorSelectField({ connector, onChange }: ConnectorSelectFieldProps) {
  const dispatch = useAppDispatch();
  const connectors = useAppSelector((state) => state.connectors.items);
  const status = useAppSelector((state) => state.connectors.status);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (status === "idle") {
      void dispatch(fetchConnectors());
    }
  }, [status, dispatch]);

  const restConnectors = connectors.filter((c) => c.kind === REST_API_KIND);

  const options = [
    ...restConnectors.map((c) => ({ value: c.id, label: `${c.name} (${c.kind})` })),
    { value: CREATE_NEW_VALUE, label: "+ Create new Connector" },
  ];

  function handleSelect(value: string) {
    if (value === CREATE_NEW_VALUE) {
      setCreateOpen(true);
      return;
    }
    const selected = restConnectors.find((c) => c.id === value) ?? null;
    onChange(selected);
  }

  // Decision 5: an empty filtered list (no rest_api Connector exists yet) gets an explanatory
  // empty state rather than a bare control offering only "+ Create new Connector" — the
  // distinguishing test is that the explanation text is present, not merely that the option
  // list excludes non-matching kinds.
  const showEmptyState = status !== "loading" && restConnectors.length === 0;

  return (
    <div className="connector-select-field">
      <span className="connector-select-field__label">Connector</span>
      {showEmptyState ? (
        <EmptyState
          variant="sidebar"
          icon={<Plug />}
          title="No REST Connector yet"
          description="No REST Connector exists yet. Create one to authenticate this source's requests."
          cta={{ label: "+ Create new Connector", onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <>
          <Select
            value={connector?.id ?? ""}
            options={options}
            onChange={handleSelect}
            placeholder="Select a Connector…"
            ariaLabel="Connector"
          />
          {connector ? (
            <p className="connector-select-field__note">
              Requests use <strong>{connector.name}</strong> ({connector.kind}) — its saved
              credential is applied automatically; there is no separate auth field here.
            </p>
          ) : (
            <p className="connector-select-field__note">
              A Connector must be selected before this source can be tested or saved.
            </p>
          )}
        </>
      )}
      {createOpen &&
        // Portalled to <body>, not rendered inline: ConnectorSelectField
        // lives inside AddSourceModal's own `<form>` (the configure step),
        // and CreateConnectorModal renders its own `<form>` — nesting a
        // `<form>` inside a `<form>` is invalid HTML and silently breaks
        // submit semantics (React DOM validation warning, verified via a
        // minimal probe: rendering inline produced "validateDOMNesting(...):
        // <form> cannot appear as a descendant of <form>"). Portalling out of
        // the ancestor `<form>` avoids the nesting without changing
        // CreateConnectorModal itself, matching design.md Decision 1's
        // modal-over-modal handling.
        createPortal(
          <CreateConnectorModal
            onClose={() => setCreateOpen(false)}
            onCreated={(created) => onChange(created)}
          />,
          document.body,
        )}
    </div>
  );
}
