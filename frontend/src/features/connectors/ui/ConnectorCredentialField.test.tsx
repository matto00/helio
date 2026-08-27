// ConnectorCredentialField tests (HEL-824 design.md Decision 3): auth-type
// switching shows/hides the credential input and api_key fields, "create"
// mode allows changing auth type, "rotate" mode fixes it and never shows
// api_key sub-fields (rotation carries no auth-type change — only the
// credential value is submitted).

import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  ConnectorCredentialField,
  emptyConnectorCredentialFieldValue,
} from "./ConnectorCredentialField";
import type { ConnectorCredentialFieldValue } from "./ConnectorCredentialField";

function Harness({
  initial,
  mode,
}: {
  initial: ConnectorCredentialFieldValue;
  mode: "create" | "rotate";
}) {
  const [value, setValue] = useState(initial);
  return <ConnectorCredentialField value={value} onChange={setValue} mode={mode} idPrefix="test" />;
}

describe("ConnectorCredentialField", () => {
  it("no-auth: renders no credential input", () => {
    render(<Harness initial={emptyConnectorCredentialFieldValue()} mode="create" />);
    expect(screen.queryByLabelText(/token value|key value/i)).not.toBeInTheDocument();
  });

  it("create mode + bearer: shows the credential input with shown-once hint", () => {
    render(
      <Harness
        initial={{ ...emptyConnectorCredentialFieldValue(), authType: "bearer" }}
        mode="create"
      />,
    );
    expect(screen.getByLabelText("Bearer token value")).toBeInTheDocument();
    expect(screen.getByText(/won't be displayed again/i)).toBeInTheDocument();
  });

  it("create mode + api_key: shows the key name/placement fields", () => {
    render(
      <Harness
        initial={{ ...emptyConnectorCredentialFieldValue(), authType: "api_key" }}
        mode="create"
      />,
    );
    expect(screen.getByLabelText("API key parameter name")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "API key placement" })).toBeInTheDocument();
    expect(screen.getByLabelText("API key value")).toBeInTheDocument();
  });

  it("create mode: switching auth type via the selector updates the rendered fields", () => {
    render(<Harness initial={emptyConnectorCredentialFieldValue()} mode="create" />);
    expect(screen.queryByLabelText(/token value/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "Authentication type" }));
    fireEvent.click(screen.getByRole("option", { name: "Bearer token" }));

    expect(screen.getByLabelText("Bearer token value")).toBeInTheDocument();
  });

  it("rotate mode: auth type is fixed (read-only), api_key sub-fields never render even for api_key auth", () => {
    render(
      <Harness
        initial={{ ...emptyConnectorCredentialFieldValue(), authType: "api_key" }}
        mode="rotate"
      />,
    );
    expect(screen.queryByRole("combobox", { name: "Authentication type" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("API key parameter name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("New API key value")).toBeInTheDocument();
    expect(screen.getByText(/permanently deleted/i)).toBeInTheDocument();
  });
});
