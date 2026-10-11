/**
 * HEL-1306 seam test, frontend half. `shared-test-fixtures/chart-reference-marks.json` is also read by the
 * backend `OutputReferenceMarksSeamSpec`: the config the editor builds from `editorState` must equal
 * `validConfig` (which the real routes accept), `validConfig` must satisfy all three Output request
 * schemas, and every `schemaRejects` case must be rejected by all three. A key renamed or a rule changed on
 * one side fails a suite.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import { sanitizeReferenceMarks } from "../../../../utils/referenceMarks";
import { buildOutputConfig, type BuildOutputConfigParams } from "./buildOutputConfig";
import { buildBaselineConfig, buildConfigPatch, openingParams } from "./configPatch";
import { draftsToMarks, type BandDraft, type LineDraft } from "./referenceMarksDraft";

interface Fixture {
  editorState: { referenceLines: LineDraft[]; referenceBands: BandDraft[] };
  validConfig: Record<string, unknown>;
  schemaRejects: { name: string; config: Record<string, unknown> }[];
  schemaAccepts: { name: string; config: Record<string, unknown> }[];
}

const ROOT = resolve(__dirname, "../../../../../../");
const fixture = JSON.parse(
  readFileSync(resolve(ROOT, "shared-test-fixtures/chart-reference-marks.json"), "utf8"),
) as Fixture;

const SCHEMAS = [
  ["create-output-request", "schemas/outputs/create-output-request.schema.json"],
  ["update-output-request", "schemas/outputs/update-output-request.schema.json"],
  [
    "create-pipeline-transactional-output-request",
    "schemas/pipelines/create-pipeline-transactional-output-request.schema.json",
  ],
] as const;

function compileConfigValidator(file: string) {
  const schema = JSON.parse(readFileSync(resolve(ROOT, file), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const validate = ajv.compile(schema.properties.config);
  return (config: unknown) => validate(config);
}

function editorBuilt(): Record<string, unknown> {
  const marks = draftsToMarks(
    fixture.editorState.referenceLines,
    fixture.editorState.referenceBands,
  );
  if (!marks) throw new Error("fixture editorState is invalid");
  const params: BuildOutputConfigParams = {
    ...openingParams("chart", { chartType: "bar" }, []),
    referenceLines: marks.lines,
    referenceBands: marks.bands,
  };
  return buildOutputConfig(params);
}

describe("chart-reference-marks seam fixture (shared with the backend OutputReferenceMarksSeamSpec)", () => {
  it("the editor builds exactly validConfig's keys from editorState", () => {
    const built = editorBuilt();
    expect({
      chartType: built.chartType,
      referenceLines: built.referenceLines,
      referenceBands: built.referenceBands,
    }).toEqual(fixture.validConfig);
  });

  it("an edit Save of that state PATCHes exactly the reference keys against an untouched Output", () => {
    const stored = { chartType: "bar" };
    const patch = buildConfigPatch(
      "chart",
      editorBuilt(),
      buildBaselineConfig("chart", stored, []),
      stored,
    );
    expect(patch).toEqual({
      referenceLines: fixture.validConfig.referenceLines,
      referenceBands: fixture.validConfig.referenceBands,
    });
  });

  it("an untouched Output carrying the fixture marks PATCHes neither key", () => {
    const stored = fixture.validConfig;
    const built = buildOutputConfig(openingParams("chart", stored, []));
    expect(buildConfigPatch("chart", built, buildBaselineConfig("chart", stored, []), stored)).toBe(
      null,
    );
  });

  it("the renderer's read keeps validConfig's marks whole", () => {
    expect(
      sanitizeReferenceMarks(
        fixture.validConfig.referenceLines,
        fixture.validConfig.referenceBands,
      ),
    ).toEqual({
      lines: fixture.validConfig.referenceLines,
      bands: fixture.validConfig.referenceBands,
    });
  });

  it.each(fixture.schemaAccepts.map((c) => [c.name, c.config] as const))(
    "the renderer's read keeps the accepted case whole: %s",
    (_case, config) => {
      const lines = config.referenceLines as unknown[];
      expect(sanitizeReferenceMarks(lines, undefined).lines).toEqual(lines);
    },
  );

  describe.each(SCHEMAS)("%s", (_name, file) => {
    const validate = compileConfigValidator(file);

    it("accepts validConfig and the editor's own output", () => {
      expect(validate(fixture.validConfig)).toBe(true);
      expect(validate(editorBuilt())).toBe(true);
    });

    it.each(fixture.schemaAccepts.map((c) => [c.name, c.config] as const))(
      "accepts %s",
      (_case, config) => {
        expect(validate(config)).toBe(true);
      },
    );

    it.each(fixture.schemaRejects.map((c) => [c.name, c.config] as const))(
      "rejects %s",
      (_case, config) => {
        expect(validate(config)).toBe(false);
      },
    );
  });
});
