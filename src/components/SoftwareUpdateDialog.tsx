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
import {
  selectRecommendedSoftwareAssets,
  type SoftwareSystemInfo,
  type SoftwareUpdateCheckResult,
} from "@/lib/softwareRelease";

interface SoftwareUpdateDialogProps {
  open: boolean;
  result: SoftwareUpdateCheckResult | null;
  systemInfo: SoftwareSystemInfo | null;
  onOpenChange: (open: boolean) => void;
}

export function SoftwareUpdateDialog({ open, result, systemInfo, onOpenChange }: SoftwareUpdateDialogProps) {
  const { i18n, t } = useTranslation();

  if (!result?.updateAvailable) {
    return null;
  }

  const localizedNotes = selectLocalizedNotes(result, i18n.language);
  const releaseNotes = localizedNotes ? localizedNotes.summary : compactReleaseNotes(result.latestRelease.body);
  const latestCommit = result.latestRelease.commitSha?.slice(0, 7);
  const recommendedAssets = selectRecommendedSoftwareAssets(result.latestRelease.assets, systemInfo);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="software-update-dialog sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{localizedNotes?.title || t("softwareUpdate.title")}</DialogTitle>
          <DialogDescription>
            {t("softwareUpdate.description", {
              current: result.currentVersion,
              latest: result.latestRelease.tagName,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="software-update-body">
          <dl className="software-update-version-grid">
            <div>
              <dt>{t("softwareUpdate.currentVersion")}</dt>
              <dd>{result.currentVersion}</dd>
            </div>
            <div>
              <dt>{t("softwareUpdate.latestVersion")}</dt>
              <dd>{result.latestRelease.tagName}</dd>
            </div>
            {latestCommit && (
              <div>
                <dt>{t("softwareUpdate.latestCommit")}</dt>
                <dd>{latestCommit}</dd>
              </div>
            )}
          </dl>

          {releaseNotes && (
            <section className="software-update-notes" aria-label={t("softwareUpdate.releaseNotes")}>
              <h3>{t("softwareUpdate.releaseNotes")}</h3>
              <pre>{releaseNotes}</pre>
            </section>
          )}

          {localizedNotes && localizedNotes.highlights.length > 0 && (
            <section className="software-update-notes" aria-label={t("softwareUpdate.highlights")}>
              <h3>{t("softwareUpdate.highlights")}</h3>
              <ul className="software-update-highlights">
                {localizedNotes.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            </section>
          )}

          {localizedNotes?.upgradeNotice && (
            <p className="software-update-notice">{localizedNotes.upgradeNotice}</p>
          )}

          {recommendedAssets.length > 0 && (
            <section className="software-update-assets" aria-label={t("softwareUpdate.assets")}>
              <h3>{t("softwareUpdate.assets", { os: t(`softwareUpdate.os.${normalizeOs(systemInfo?.os)}`) })}</h3>
              <div className="software-update-asset-list">
                {recommendedAssets.map((asset) => (
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

          {recommendedAssets.length === 0 && (
            <p className="software-update-notice">{t("softwareUpdate.noAssets")}</p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("softwareUpdate.later")}
            </Button>
          </DialogClose>
          <Button asChild>
            <a href={result.latestRelease.htmlUrl} target="_blank" rel="noopener noreferrer">
              {t("softwareUpdate.openRelease")}
              <ExternalLink size={15} aria-hidden="true" />
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function selectLocalizedNotes(result: SoftwareUpdateCheckResult, language: string) {
  const notes = result.latestRelease.localizedNotes;

  if (!notes) {
    return null;
  }

  return language.toLowerCase().startsWith("zh") ? notes.zh_CN : notes.en_US;
}

function normalizeOs(os: string | undefined): "windows" | "macos" | "linux" | "unknown" {
  if (os === "windows" || os === "macos" || os === "linux") {
    return os;
  }

  return "unknown";
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
