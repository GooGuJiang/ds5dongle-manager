import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";

interface ToggleControlProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

export function ToggleControl({ label, description, value, onChange }: ToggleControlProps) {
  const { t } = useTranslation();

  return (
    <div className="control-row toggle-row">
      <span>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <Switch
        checked={value}
        onCheckedChange={onChange}
        className="justify-self-end"
        title={value ? t("toggle.enabled") : t("toggle.disabled")}
      />
    </div>
  );
}
