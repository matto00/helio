import { type FormEvent, useEffect, useRef, useState } from "react";

import "./ComputedFieldForm.css";
import { validateExpression } from "../services/dataTypeService";
import type { ComputedField } from "../types/models";

interface ComputedFieldFormProps {
  /** ID of the DataType (used for server-side expression validation). */
  typeId: string;
  /** Initial values — undefined means "adding a new field". */
  initial?: ComputedField;
  onSave: (field: ComputedField) => void;
  onCancel: () => void;
}

const OUTPUT_TYPES = ["string", "integer", "float", "boolean"] as const;

export function ComputedFieldForm({ typeId, initial, onSave, onCancel }: ComputedFieldFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [expression, setExpression] = useState(initial?.expression ?? "");
  const [dataType, setDataType] = useState(initial?.dataType ?? "float");
  const [exprError, setExprError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Validate on expression change (debounced 400 ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!expression.trim()) {
      setExprError(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runValidation(expression);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expression, typeId]);

  async function runValidation(expr: string) {
    setIsValidating(true);
    try {
      const result = await validateExpression(typeId, expr);
      setExprError(result.valid ? null : (result.message ?? "Invalid expression"));
    } catch {
      // Network error — don't block save; let backend validate on save
      setExprError(null);
    } finally {
      setIsValidating(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!expression.trim()) {
      setExprError("Expression is required");
      return;
    }
    // Final server validation before saving
    if (typeId) {
      setIsValidating(true);
      try {
        const result = await validateExpression(typeId, expression);
        if (!result.valid) {
          setExprError(result.message ?? "Invalid expression");
          setIsValidating(false);
          return;
        }
      } catch {
        // allow save on network error
      } finally {
        setIsValidating(false);
      }
    }
    if (exprError) return;
    onSave({
      name: name.trim(),
      displayName: displayName.trim() || name.trim(),
      expression,
      dataType,
    });
  }

  return (
    <form
      className="computed-field-form"
      onSubmit={(e) => void handleSubmit(e)}
      aria-label="Computed field form"
    >
      <div className="computed-field-form__row">
        <label className="computed-field-form__label" htmlFor="cf-name">
          Field name
        </label>
        <input
          id="cf-name"
          className="computed-field-form__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. total"
          required
          aria-label="Computed field name"
        />
      </div>

      <div className="computed-field-form__row">
        <label className="computed-field-form__label" htmlFor="cf-display-name">
          Display name
        </label>
        <input
          id="cf-display-name"
          className="computed-field-form__input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Total"
          aria-label="Computed field display name"
        />
      </div>

      <div className="computed-field-form__row">
        <label className="computed-field-form__label" htmlFor="cf-expression">
          Expression
        </label>
        <input
          id="cf-expression"
          className="computed-field-form__input"
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          placeholder="e.g. price * quantity"
          required
          aria-label="Computed field expression"
          aria-describedby={exprError ? "cf-expr-error" : undefined}
          aria-invalid={exprError !== null}
        />
        {isValidating && <span className="computed-field-form__hint">Validating…</span>}
        {exprError && (
          <span id="cf-expr-error" className="computed-field-form__error" role="alert">
            {exprError}
          </span>
        )}
      </div>

      <div className="computed-field-form__row">
        <label className="computed-field-form__label" htmlFor="cf-output-type">
          Output type
        </label>
        <select
          id="cf-output-type"
          className="computed-field-form__select"
          value={dataType}
          onChange={(e) => setDataType(e.target.value)}
          aria-label="Computed field output type"
        >
          {OUTPUT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="computed-field-form__actions">
        <button
          type="submit"
          className="computed-field-form__btn computed-field-form__btn--save"
          disabled={isValidating || !!exprError}
          aria-label="Save computed field"
        >
          Save field
        </button>
        <button
          type="button"
          className="computed-field-form__btn computed-field-form__btn--cancel"
          onClick={onCancel}
          aria-label="Cancel computed field"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
