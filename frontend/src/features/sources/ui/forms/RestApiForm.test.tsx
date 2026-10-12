// HEL-1464 — the Method label must target its combobox (its literal `htmlFor="source-method"`
// pointed at no element), and two mounted forms must not share the target id.

import { render } from "@testing-library/react";

import {
  expectDistinctNonEmptyLabelIds,
  expectLabelTargetsControl,
} from "../../../../test/labelAssociation";
import type { UseRestSourceFormReturn } from "../../hooks/useRestSourceForm";
import { RestApiForm } from "./RestApiForm";

jest.mock("./ConnectorSelectField", () => ({ ConnectorSelectField: () => null }));
jest.mock("./KeyValueListField", () => ({ KeyValueListField: () => null }));
jest.mock("./TemplateParametersField", () => ({ TemplateParametersField: () => null }));
jest.mock("../TestConnectionAffordance", () => ({ TestConnectionAffordance: () => null }));

function makeForm(): UseRestSourceFormReturn {
  return {
    connector: null,
    setConnector: jest.fn(),
    endpoint: "",
    setEndpoint: jest.fn(),
    method: "GET",
    setMethod: jest.fn(),
    queryParams: [],
    setQueryParams: jest.fn(),
    headers: [],
    setHeaders: jest.fn(),
    rootSelector: "",
    setRootSelector: jest.fn(),
    body: "",
    setBody: jest.fn(),
    bodyContentType: "",
    setBodyContentType: jest.fn(),
    parameterValues: {},
    setParameterValue: jest.fn(),
    templateParameterNames: [],
    supportsBody: false,
    buildRestSourceConfig: jest.fn(),
    reset: jest.fn(),
  };
}

describe("RestApiForm label association (HEL-1464)", () => {
  it("the Method label targets the method combobox", () => {
    render(<RestApiForm form={makeForm()} />);
    expectLabelTargetsControl("Method", "combobox", "Method");
  });

  it("two mounted forms never share the label target id", () => {
    render(<RestApiForm form={makeForm()} />);
    render(<RestApiForm form={makeForm()} />);
    expectDistinctNonEmptyLabelIds("Method");
  });
});
