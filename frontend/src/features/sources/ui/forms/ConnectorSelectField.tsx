// HEL-827 design.md Decision 1: Connector picker for the REST source form.
// Lists existing Connectors (connectorsSlice) and offers "Create new
// Connector", launching CreateConnectorModal inline (modal-over-modal — see
// design.md Decision 1) and selecting the returned Connector via its
// `onCreated` callback (design.md Decision 1 / tasks 2.2).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import { Select } from "../../../../shared/ui/Select";
import { fetchConnectors } from "../../../connectors/state/connectorsSlice";
import { CreateConnectorModal } from "../../../connectors/ui/CreateConnectorModal";
import type { Connector } from "../../../connectors/types/connector";
import "./ConnectorSelectField.css";

const CREATE_NEW_VALUE = "__create_new__";

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

  const options = [
    ...connectors.map((c) => ({ value: c.id, label: `${c.name} (${c.kind})` })),
    { value: CREATE_NEW_VALUE, label: "+ Create new Connector" },
  ];

  function handleSelect(value: string) {
    if (value === CREATE_NEW_VALUE) {
      setCreateOpen(true);
      return;
    }
    const selected = connectors.find((c) => c.id === value) ?? null;
    onChange(selected);
  }

  return (
    <div className="connector-select-field">
      <span className="connector-select-field__label">Connector</span>
      <Select
        value={connector?.id ?? ""}
        options={options}
        onChange={handleSelect}
        placeholder="Select a Connector…"
        ariaLabel="Connector"
      />
      {connector ? (
        <p className="connector-select-field__note">
          Requests use <strong>{connector.name}</strong> ({connector.kind}) — its saved credential
          is applied automatically; there is no separate auth field here.
        </p>
      ) : (
        <p className="connector-select-field__note">
          A Connector must be selected before this source can be tested or saved.
        </p>
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
