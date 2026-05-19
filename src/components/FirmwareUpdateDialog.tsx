import { ExternalLink } from "lucide-react";
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
import type { FirmwareUpdateCheckResult } from "@/lib/firmwareRelease";

interface FirmwareUpdateDialogProps {
  open: boolean;
  result: FirmwareUpdateCheckResult | null;
  onOpenChange: (open: boolean) => void;
}

export function FirmwareUpdateDialog({ open, result, onOpenChange }: FirmwareUpdateDialogProps) {
  const { i18n, t } = useTranslation();

  if (!result?.updateAvailable) {
    return null;
  }

  const firmwareAssets = result.latestRelease.assets.filter((asset) => asset.name.toLowerCase().endsWith(".uf2"));
  const localizedNotes = selectLocalizedNotes(result, i18n.language);
  const releaseNotes = localizedNotes ? localizedNotes.summary : compactReleaseNotes(result.latestRelease.body);
  const latestCommit = result.latestRelease.commitSha?.slice(0, 7);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="firmware-update-dialog sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{localizedNotes?.title || t("firmwareUpdate.title")}</DialogTitle>
          <DialogDescription>
            {t("firmwareUpdate.description", {
              current: result.currentVersion,
              latest: result.latestRelease.tagName,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="firmware-update-body">
          <dl className="firmware-update-version-grid">
            <div>
              <dt>{t("firmwareUpdate.currentVersion")}</dt>
              <dd>{result.currentVersion}</dd>
            </div>
            <div>
              <dt>{t("firmwareUpdate.latestVersion")}</dt>
              <dd>{result.latestRelease.tagName}</dd>
            </div>
            {latestCommit && (
              <div>
                <dt>{t("firmwareUpdate.latestCommit")}</dt>
                <dd>{latestCommit}</dd>
              </div>
            )}
          </dl>

          {releaseNotes && (
            <section className="firmware-update-notes" aria-label={t("firmwareUpdate.releaseNotes")}> 
              <h3>{t("firmwareUpdate.releaseNotes")}</h3>
              <pre>{releaseNotes}</pre>
            </section>
          )}

          {localizedNotes && localizedNotes.highlights.length > 0 && (
            <section className="firmware-update-notes" aria-label={t("firmwareUpdate.highlights")}> 
              <h3>{t("firmwareUpdate.highlights")}</h3>
              <ul className="firmware-update-highlights">
                {localizedNotes.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            </section>
          )}

          {localizedNotes?.upgradeNotice && (
            <p className="firmware-update-notice">{localizedNotes.upgradeNotice}</p>
          )}

          {firmwareAssets.length > 0 && (
            <section className="firmware-update-assets" aria-label={t("firmwareUpdate.assets")}> 
              <h3>{t("firmwareUpdate.assets")}</h3>
              <div className="firmware-update-asset-list">
                {firmwareAssets.map((asset) => (
                  <Button key={asset.downloadUrl} asChild variant="secondary" size="sm">
                    <a href={asset.downloadUrl} target="_blank" rel="noopener noreferrer">
                      {asset.name}
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  </Button>
                ))}
              </div>
            </section>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("firmwareUpdate.later")}
            </Button>
          </DialogClose>
          <Button asChild>
            <a href={result.latestRelease.htmlUrl} target="_blank" rel="noopener noreferrer">
              {t("firmwareUpdate.openRelease")}
              <ExternalLink size={15} aria-hidden="true" />
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function selectLocalizedNotes(result: FirmwareUpdateCheckResult, language: string) {
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
