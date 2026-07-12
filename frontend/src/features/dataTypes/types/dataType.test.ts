import { isUnstructuredDataType } from "./dataType";
import type { DataType } from "./dataType";

function buildDataType(overrides: Partial<DataType> = {}): DataType {
  return {
    id: "type-1",
    name: "Documents",
    sourceId: "source-1",
    version: 1,
    fields: [],
    computedFields: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("isUnstructuredDataType", () => {
  it("returns true when a field has a string-body content type", () => {
    const dt = buildDataType({
      fields: [
        { name: "title", displayName: "Title", dataType: "string", nullable: false },
        { name: "body", displayName: "Body", dataType: "string-body", nullable: false },
      ],
    });

    expect(isUnstructuredDataType(dt)).toBe(true);
  });

  it("returns true when a field has a binary-ref content type", () => {
    const dt = buildDataType({
      fields: [{ name: "image", displayName: "Image", dataType: "binary-ref", nullable: false }],
    });

    expect(isUnstructuredDataType(dt)).toBe(true);
  });

  it("returns false when all fields are structured", () => {
    const dt = buildDataType({
      fields: [
        { name: "name", displayName: "Name", dataType: "string", nullable: false },
        { name: "count", displayName: "Count", dataType: "integer", nullable: false },
        { name: "active", displayName: "Active", dataType: "boolean", nullable: false },
      ],
    });

    expect(isUnstructuredDataType(dt)).toBe(false);
  });

  it("ignores computedFields — a content-typed computed field does not count", () => {
    const dt = buildDataType({
      fields: [{ name: "name", displayName: "Name", dataType: "string", nullable: false }],
      computedFields: [
        {
          name: "summary",
          displayName: "Summary",
          expression: "name",
          dataType: "string-body",
        },
      ],
    });

    expect(isUnstructuredDataType(dt)).toBe(false);
  });
});
