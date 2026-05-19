import { useTranslation } from "react-i18next";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SwitchProgressDialogProps {
  open: boolean;
  title: string;
  description?: string;
  progress: number;
}

export function SwitchProgressDialog({
  open,
  title,
  description,
  progress,
}: SwitchProgressDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <Progress value={progress} className="w-full [&_[data-slot=progress-indicator]]:transition-none" />
          <p className="text-sm text-muted-foreground text-center">
            {t("config.switchingProgress", { progress: Math.round(progress) })}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
