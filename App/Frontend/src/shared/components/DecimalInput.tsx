/**
 * DecimalInput — A controlled numeric input that uses type="text" with
 * inputMode="decimal" to avoid the browser's native number-input bugs
 * (e.g., destroying decimal points during typing).
 *
 * Internal state is a raw string. On blur, the raw string is parsed,
 * clamped, rounded, and committed via onChange. While focused, the
 * raw text is preserved as-is so the user can type freely.
 */
import { useState, useEffect, useRef } from "react";

// ── Types ──

interface DecimalInputProps {
  value: number;
  onChange: (value: number) => void;
  onBlur?: () => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  decimals?: number;      // default 2
  min?: number;
  max?: number;
  step?: number;          // accepted but not used on <input type="text">
  isCurrency?: boolean;   // default false
  width?: string;         // default "min-w-[10ch]"
  id?: string;
}

// ── Helpers ──

function formatNumber(value: number, decimals: number, isCurrency: boolean): string {
  if (isCurrency) {
    return value.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
  }
  return value.toFixed(decimals);
}

// ── Component ──

export default function DecimalInput({
  value,
  onChange,
  onBlur,
  disabled = false,
  className = "",
  placeholder,
  decimals = 2,
  min,
  max,
  step: _step,
  isCurrency = false,
  width = "min-w-[10ch]",
  id,
}: DecimalInputProps) {
  const [raw, setRaw] = useState("");
  const committedRef = useRef(false);

  // Sync from outside: when parent changes value and we didn't
  // trigger it ourselves, reset raw so the formatted display
  // reflects the new value.
  useEffect(() => {
    if (!committedRef.current) {
      setRaw("");
    }
    committedRef.current = false;
  }, [value, decimals, isCurrency]);

  const displayValue = raw || formatNumber(value, decimals, isCurrency);

  const handleFocus = () => {
    if (!raw) {
      setRaw(value.toFixed(decimals));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRaw(e.target.value);
  };

  const handleBlur = () => {
    committedRef.current = true;

    let final: number;
    const trimmed = raw.trim();

    if (trimmed === "" || trimmed === "-") {
      final = min ?? 0;
    } else {
      let toParse = trimmed;

      // Handle leading dot: ".5" → "0.5"
      if (toParse.startsWith(".")) {
        toParse = "0" + toParse;
      }
      // Handle negative with leading dot: "-.5" → "-0.5"
      if (toParse.startsWith("-.")) {
        toParse = "-0." + toParse.slice(2);
      }

      const parsed = Number(toParse);
      if (isNaN(parsed)) {
        // Invalid input (letters, etc.) — revert to last valid value
        setRaw("");
        onBlur?.();
        return;
      }

      final = parsed;
    }

    // Clamp
    if (min !== undefined && final < min) final = min;
    if (max !== undefined && final > max) final = max;

    // Round
    const factor = Math.pow(10, decimals);
    final = Math.round(final * factor) / factor;

    // Format display for the committed value
    setRaw(formatNumber(final, decimals, isCurrency));

    onChange(final);
    onBlur?.();
  };

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
      disabled={disabled}
      placeholder={placeholder}
      className={`border px-2 py-1 rounded ${width} ${
        disabled ? "bg-gray-200 text-gray-400" : ""
      } ${className}`}
    />
  );
}
