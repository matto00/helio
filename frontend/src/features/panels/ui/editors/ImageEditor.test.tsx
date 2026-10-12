// HEL-1464 — the Image fit label must target its combobox (its literal `htmlFor="image-fit"` pointed
// at no element), and two mounted editors must not share the target id.

import { renderWithStore } from "../../../../test/renderWithStore";
import { makeImagePanel } from "../../../../test/panelFixtures";
import {
  expectDistinctNonEmptyLabelIds,
  expectLabelTargetsControl,
} from "../../../../test/labelAssociation";
import { ImageEditor } from "./ImageEditor";

function renderEditor() {
  return renderWithStore(<ImageEditor panel={makeImagePanel()} onDirtyChange={jest.fn()} />);
}

describe("ImageEditor label association (HEL-1464)", () => {
  it("the Image fit label targets the image-fit combobox", () => {
    renderEditor();
    expectLabelTargetsControl("Image fit", "combobox", "Image fit");
  });

  it("two mounted editors never share the label target id", () => {
    renderEditor();
    renderEditor();
    expectDistinctNonEmptyLabelIds("Image fit");
  });
});
