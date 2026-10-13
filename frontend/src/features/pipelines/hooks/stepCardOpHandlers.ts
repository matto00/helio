import type {
  AnalyzeWithAiConfigValue,
  ConvertFormatConfigValue,
  GenerateTextConfigValue,
} from "../state/stepNarrowing";
import type { AssertConfigValue } from "../ui/stepConfigs/AssertConfig";
import type { DedupeConfigValue } from "../ui/stepConfigs/DedupeConfig";
import type { FillNullConfigValue } from "../ui/stepConfigs/FillNullConfig";
import type { JoinConfigValue } from "../ui/stepConfigs/JoinConfig";
import type { LookupConfigValue } from "../ui/stepConfigs/LookupConfig";
import type { StringOpsConfigValue } from "../ui/stepConfigs/StringOpsConfig";
import type { UnionConfigValue } from "../ui/stepConfigs/UnionConfig";
import type { UnpivotConfigValue } from "../ui/stepConfigs/UnpivotConfig";
import type { UpsertSourceConfigValue } from "../ui/stepConfigs/UpsertSourceConfig";
import type { useStepCardEditorState } from "./useStepCardEditorState";
import type { useStepCardPersist } from "./useStepCardPersist";

type StepCardOpHandlersArgs = Pick<
  ReturnType<typeof useStepCardEditorState>,
  | "setUnpivotConfig"
  | "setDedupeConfig"
  | "setFillNullConfig"
  | "setStringOpsConfig"
  | "setUnionConfig"
  | "setLookupConfig"
  | "setJoinConfig"
  | "setAssertConfig"
  | "setUpsertSourceConfig"
  | "setConvertFormatConfig"
  | "setAnalyzeWithAiConfig"
  | "setGenerateTextConfig"
> &
  Pick<ReturnType<typeof useStepCardPersist>, "persist" | "emitOrPersist">;

export function buildStepCardOpHandlers({
  setUnpivotConfig,
  setDedupeConfig,
  setFillNullConfig,
  setStringOpsConfig,
  setUnionConfig,
  setLookupConfig,
  setJoinConfig,
  setAssertConfig,
  setUpsertSourceConfig,
  setConvertFormatConfig,
  setAnalyzeWithAiConfig,
  setGenerateTextConfig,
  persist,
  emitOrPersist,
}: StepCardOpHandlersArgs) {
  function onUnpivotChange(newConfig: UnpivotConfigValue) {
    setUnpivotConfig(newConfig);
    persist(newConfig);
  }

  function onDedupeChange(newConfig: DedupeConfigValue) {
    setDedupeConfig(newConfig);
    persist(newConfig);
  }

  function onFillNullChange(newConfig: FillNullConfigValue) {
    setFillNullConfig(newConfig);
    persist(newConfig, true);
  }

  function onStringOpsChange(newConfig: StringOpsConfigValue) {
    setStringOpsConfig(newConfig);
    // Each operation only reads a subset of the params — omit the ones the
    // selected operation doesn't use rather than persisting a stale value
    // left over from a previously-selected operation (mirrors
    // onWindowChange's usesField/usesOffset omission pattern in `stepCardFieldHandlers.ts`).
    const isConcat = newConfig.operation === "concat";
    const usesSeparator = newConfig.operation === "split" || isConcat;
    const usesIndex = newConfig.operation === "split";
    const usesPattern = newConfig.operation === "extractRegex";
    persist({
      operation: newConfig.operation,
      field: isConcat ? "" : newConfig.field,
      outputColumn: newConfig.outputColumn,
      pattern: usesPattern && newConfig.pattern ? newConfig.pattern : undefined,
      separator: usesSeparator && newConfig.separator ? newConfig.separator : undefined,
      index: usesIndex ? newConfig.index : undefined,
      fields: isConcat ? newConfig.fields : undefined,
    });
  }

  function onUnionChange(newConfig: UnionConfigValue) {
    setUnionConfig(newConfig);
    // HEL-912: the discriminated `secondary` arm (source OR lane) widens
    // straight through to the wire's `secondaryInput` -- the HEL-911
    // unconditional `{kind:"source"}` this replaced would silently
    // overwrite a stored lane reference on any subsequent edit.
    // HEL-1515: opts into `saveError` -- the backend now rejects a lane reference to a step that
    // depends on this one (400), and swallowing it would silently lose the edit.
    persist(
      {
        secondaryInput: newConfig.secondary,
        mode: newConfig.mode,
      },
      true,
    );
  }

  function onLookupChange(newConfig: LookupConfigValue) {
    setLookupConfig(newConfig);
    // HEL-912: same straight-through widening as onUnionChange above.
    persist(
      {
        secondaryInput: newConfig.secondary,
        sourceKey: newConfig.sourceKey,
        lookupKey: newConfig.lookupKey,
        columns: newConfig.columns,
      },
      true,
    );
  }

  function onJoinChange(newConfig: JoinConfigValue) {
    setJoinConfig(newConfig);
    // Exactly the wire key set {secondaryInput, joinKey, joinType} (HEL-958 D4).
    persist(
      {
        secondaryInput: newConfig.secondary,
        joinKey: newConfig.joinKey,
        joinType: newConfig.joinType,
      },
      true,
    );
  }

  function onAssertChange(newConfig: AssertConfigValue) {
    setAssertConfig(newConfig);
    persist(newConfig);
  }

  function onUpsertSourceChange(newConfig: UpsertSourceConfigValue) {
    setUpsertSourceConfig(newConfig);
    persist({ target: newConfig.target, mode: newConfig.mode }, true);
  }

  function onConvertFormatChange(newConfig: ConvertFormatConfigValue) {
    setConvertFormatConfig(newConfig);
    emitOrPersist({
      field: newConfig.field,
      from: newConfig.from,
      to: newConfig.to,
      outputField: newConfig.outputField ? newConfig.outputField : undefined,
    });
  }

  function onAnalyzeWithAiChange(newConfig: AnalyzeWithAiConfigValue) {
    setAnalyzeWithAiConfig(newConfig);
    emitOrPersist(newConfig);
  }

  function onGenerateTextChange(newConfig: GenerateTextConfigValue) {
    setGenerateTextConfig(newConfig);
    emitOrPersist(newConfig);
  }

  return {
    onUnpivotChange,
    onDedupeChange,
    onFillNullChange,
    onStringOpsChange,
    onUnionChange,
    onLookupChange,
    onJoinChange,
    onAssertChange,
    onUpsertSourceChange,
    onConvertFormatChange,
    onAnalyzeWithAiChange,
    onGenerateTextChange,
  };
}
