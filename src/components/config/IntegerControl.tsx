import { ChangeEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ConfigValidationIssue } from "../../protocol/config";

interface IntegerControlProps {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  issue?: ConfigValidationIssue;
  onChange: (value: number) => void;
}

export function IntegerControl({ label, description, value, min, max, issue, onChange }: IntegerControlProps) {
  const { t } = useTranslation();
  const [localValue, setLocalValue] = useState(value);
  const [inputText, setInputText] = useState(String(value));
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setLocalValue(value);
    setInputText(String(value));
  }, [value]);

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

    const rounded = Math.round(next);
    if (immediate) {
      onChange(rounded);
      return;
    }

    debounceTimerRef.current = window.setTimeout(() => onChange(rounded), 120);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.currentTarget.value);
    setInputText(event.currentTarget.value);
    if (Number.isFinite(next)) {
      setLocalValue(Math.round(next));
      commitChange(next, true);
    }
  };

  const handleSliderChange = ([next]: number[]) => {
    if (Number.isFinite(next)) {
      setLocalValue(Math.round(next));
      commitChange(next);
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
          min={min}
          max={max}
          step={1}
          value={[localValue]}
          onValueChange={handleSliderChange}
          onValueCommit={([next]) => Number.isFinite(next) && commitChange(next)}
        />
        <Input
          type="number"
          min={min}
          max={max}
          step={1}
          value={inputText}
          onChange={handleChange}
          aria-invalid={Boolean(issue)}
          className="font-bold"
        />
      </div>
    </label>
  );
}
