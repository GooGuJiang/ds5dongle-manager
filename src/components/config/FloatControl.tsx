import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ConfigValidationIssue } from "../../protocol/config";

interface FloatControlProps {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayScale?: number;
  displayOffset?: number;
  displayMin?: number;
  displayMax?: number;
  displayStep?: number;
  valueToDisplay?: (value: number) => number;
  displayToValue?: (value: number) => number;
  fractionDigits?: number;
  issue?: ConfigValidationIssue;
  onChange: (value: number) => void;
}

export function FloatControl({
  label,
  description,
  value,
  min,
  max,
  step,
  displayScale = 1,
  displayOffset = 0,
  displayMin,
  displayMax,
  displayStep,
  valueToDisplay,
  displayToValue,
  fractionDigits = 2,
  issue,
  onChange,
}: FloatControlProps) {
  const { t } = useTranslation();
  const toDisplay = useCallback(
    (next: number) => (valueToDisplay ? valueToDisplay(next) : (next + displayOffset) * displayScale),
    [displayOffset, displayScale, valueToDisplay],
  );
  const toValue = useCallback(
    (next: number) => (displayToValue ? displayToValue(next) : next / displayScale - displayOffset),
    [displayOffset, displayScale, displayToValue],
  );
  const [localValue, setLocalValue] = useState(() => toDisplay(value));
  const [inputText, setInputText] = useState(() => toDisplay(value).toFixed(fractionDigits));
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const nextDisplay = toDisplay(value);
    setLocalValue(nextDisplay);
    setInputText(nextDisplay.toFixed(fractionDigits));
  }, [fractionDigits, toDisplay, value]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const commitChange = (next: number, immediate = false) => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const commit = () => onChange(toValue(next));
    if (immediate) {
      commit();
      return;
    }

    debounceTimerRef.current = window.setTimeout(commit, 120);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.currentTarget.value);
    setInputText(event.currentTarget.value);
    if (Number.isFinite(next)) {
      setLocalValue(next);
      commitChange(next);
    }
  };

  const handleSliderChange = ([next]: number[]) => {
    if (Number.isFinite(next)) {
      setLocalValue(next);
      setInputText(next.toFixed(fractionDigits));
    }
  };

  return (
    <label className={`control-row ${issue ? "invalid" : ""}`}>
      <span>
        <strong>{label}</strong>
        {description && <em>{description}</em>}
        {issue && <small>{t(`validation.${issue.field}`)}</small>}
      </span>
      <div className="range-inputs">
        <Slider
          min={displayMin ?? toDisplay(min)}
          max={displayMax ?? toDisplay(max)}
          step={displayStep ?? step * displayScale}
          value={[localValue]}
          onValueChange={handleSliderChange}
          onValueCommit={([next]) => Number.isFinite(next) && commitChange(next, true)}
        />
        <Input
          type="number"
          min={displayMin ?? toDisplay(min)}
          max={displayMax ?? toDisplay(max)}
          step={displayStep ?? step * displayScale}
          value={inputText}
          onChange={handleChange}
          aria-invalid={Boolean(issue)}
          className="font-bold"
        />
      </div>
    </label>
  );
}
