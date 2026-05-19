import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PwaUpdateCheckResult } from "@/lib/pwaRelease";

interface PwaUpdateDialogProps {
  open: boolean;
  result: PwaUpdateCheckResult | null;
  updating: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}

export function PwaUpdateDialog({ open, result, updating, onOpenChange, onUpdate }: PwaUpdateDialogProps) {
  const { i18n, t } = useTranslation();

  if (!result?.updateAvailable) {
    return null;
  }

  const localizedNotes = selectLocalizedNotes(result, i18n.language);
  const releaseNotes = localizedNotes ? localizedNotes.summary : compactReleaseNotes(result.latestRelease.body);
  const latestCommit = result.latestRelease.commitSha?.slice(0, 7);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pwa-update-dialog sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{localizedNotes?.title || t("pwaUpdate.title")}</DialogTitle>
          <DialogDescription>
            {t("pwaUpdate.description", {
              current: result.currentVersion,
              latest: result.latestRelease.tagName,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="pwa-update-body">
          <dl className="pwa-update-version-grid">
            <div>
              <dt>{t("pwaUpdate.currentVersion")}</dt>
              <dd>{result.currentVersion}</dd>
            </div>
            <div>
              <dt>{t("pwaUpdate.latestVersion")}</dt>
              <dd>{result.latestRelease.tagName}</dd>
            </div>
            {latestCommit && (
              <div>
                <dt>{t("pwaUpdate.latestCommit")}</dt>
                <dd>{latestCommit}</dd>
              </div>
            )}
          </dl>

          {releaseNotes && (
            <section className="pwa-update-notes" aria-label={t("pwaUpdate.releaseNotes")}>
              <h3>{t("pwaUpdate.releaseNotes")}</h3>
              <pre>{releaseNotes}</pre>
            </section>
          )}

          {localizedNotes && localizedNotes.highlights.length > 0 && (
            <section className="pwa-update-notes" aria-label={t("pwaUpdate.highlights")}>
              <h3>{t("pwaUpdate.highlights")}</h3>
              <ul className="pwa-update-highlights">
                {localizedNotes.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            </section>
          )}

          {localizedNotes?.upgradeNotice && (
            <p className="pwa-update-notice">{localizedNotes.upgradeNotice}</p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary" disabled={updating}>
              {t("pwaUpdate.later")}
            </Button>
          </DialogClose>
          <Button type="button" onClick={onUpdate} disabled={updating}>
            <RefreshCw size={15} aria-hidden="true" className={updating ? "animate-spin" : undefined} />
            {updating ? t("pwaUpdate.updating") : t("pwaUpdate.updateNow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function selectLocalizedNotes(result: PwaUpdateCheckResult, language: string) {
  const notes = result.latestRelease.localizedNotes;

  if (!notes) {
    return null;
  }

  return language.toLowerCase().startsWith("zh") ? notes.zh_CN : notes.en_US;
}

function compactReleaseNotes(body: string): string {
  return body
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => !/^full changelog:/i.test(line.trim()))
    .join("\n")
    .trim()
    .slice(0, 1200);
}
