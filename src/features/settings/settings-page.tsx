import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { toast } from "sonner";

import { CheckIcon, ClipboardPasteIcon, CopyIcon, DownloadIcon, ExternalLinkIcon, FolderOpenIcon, HeartIcon, RefreshCwIcon, Trash2Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { NumberStepper } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Section, SettingRow, Spinner } from "@/components/ui/primitives";
import { SwapIcon } from "@/components/ui/swap-icon";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { useCatalog, useRefreshCatalog } from "@/features/catalog/queries";
import { useImportLibrary } from "@/features/games/queries";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import { useCheckForUpdate } from "@/features/update/queries";
import { useUpdateStore } from "@/features/update/update-store";
import { AUTHOR_HANDLE, AUTHOR_URL } from "@/lib/links";
import { useFlash } from "@/lib/use-flash";
import { ipc } from "@/lib/ipc";
import type { Language, RunnerWindow, Theme } from "@/types/domain";

import { useAppInfo, useCleanStorage, useSettings, useStorageInfo, useUpdateSettings } from "./queries";

const ORIGINAL_PROJECT_URL = "https://github.com/markterence/discord-quest-completer";
const MIN_MINUTES = 1;
const MAX_MINUTES = 480;

function AppearanceSection() {
  const { t } = useT();
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  if (!settings) return null;

  return (
    <Section title={t("settings.appearance")} delay={0}>
      <SettingRow title={t("settings.theme")}>
        <Segmented<Theme>
          label={t("settings.theme")}
          value={settings.theme}
          onChange={(theme) => {
            update.mutate({ theme });
          }}
          options={[
            { value: "system", label: t("settings.theme.system") },
            { value: "light", label: t("settings.theme.light") },
            { value: "dark", label: t("settings.theme.dark") },
          ]}
        />
      </SettingRow>
      <SettingRow title={t("settings.language")}>
        <Segmented<Language>
          label={t("settings.language")}
          value={settings.language}
          onChange={(language) => {
            update.mutate({ language });
          }}
          options={[
            { value: "auto", label: t("settings.language.auto") },
            { value: "fr", label: "Français" },
            { value: "en", label: "English" },
          ]}
        />
      </SettingRow>
    </Section>
  );
}

function QuestsSection() {
  const { t } = useT();
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  if (!settings) return null;

  return (
    <Section title={t("settings.quests")} delay={1}>
      <SettingRow title={t("settings.duration")} hint={t("settings.durationHint")}>
        <NumberStepper
          label={t("settings.duration")}
          unit={t("common.minutesShort")}
          min={MIN_MINUTES}
          max={MAX_MINUTES}
          value={settings.questDurationMinutes}
          onCommit={(questDurationMinutes) => {
            update.mutate({ questDurationMinutes });
          }}
        />
      </SettingRow>
      <SettingRow title={t("settings.notify")} hint={t("settings.notifyHint")} htmlFor="setting-notify">
        <Switch
          id="setting-notify"
          checked={settings.notifyOnComplete}
          onCheckedChange={(notifyOnComplete) => {
            update.mutate({ notifyOnComplete });
          }}
        />
      </SettingRow>
      <SettingRow
        title={t("settings.notifyNewQuests")}
        hint={t("settings.notifyNewQuestsHint")}
        htmlFor="setting-notify-new-quests"
      >
        <Switch
          id="setting-notify-new-quests"
          checked={settings.notifyNewQuests}
          onCheckedChange={(notifyNewQuests) => {
            update.mutate({ notifyNewQuests });
          }}
        />
      </SettingRow>
      <SettingRow
        title={t("settings.waitForDetection")}
        hint={t("settings.waitForDetectionHint")}
        htmlFor="setting-wait-detection"
      >
        <Switch
          id="setting-wait-detection"
          checked={settings.waitForDetection}
          onCheckedChange={(waitForDetection) => {
            update.mutate({ waitForDetection });
          }}
        />
      </SettingRow>
      <SettingRow
        title={t("settings.autoUpdates")}
        hint={t("settings.autoUpdatesHint")}
        htmlFor="setting-auto-updates"
      >
        <Switch
          id="setting-auto-updates"
          checked={settings.autoCheckUpdates}
          onCheckedChange={(autoCheckUpdates) => {
            update.mutate({ autoCheckUpdates });
          }}
        />
      </SettingRow>
      <SettingRow title={t("settings.autoStop")} hint={t("settings.autoStopHint")} htmlFor="setting-auto-stop">
        <Switch
          id="setting-auto-stop"
          checked={settings.autoStopOnComplete}
          onCheckedChange={(autoStopOnComplete) => {
            update.mutate({ autoStopOnComplete });
          }}
        />
      </SettingRow>
    </Section>
  );
}

function BehaviorSection() {
  const { t } = useT();
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  if (!settings) return null;

  return (
    <Section title={t("settings.behavior")} delay={2}>
      <SettingRow title={t("settings.runnerWindow")} hint={t("settings.runnerWindowHint")}>
        <Segmented<RunnerWindow>
          label={t("settings.runnerWindow")}
          value={settings.runnerWindow}
          onChange={(runnerWindow) => {
            update.mutate({ runnerWindow });
          }}
          options={[
            { value: "normal", label: t("settings.runnerWindow.normal") },
            { value: "minimized", label: t("settings.runnerWindow.minimized") },
            { value: "hidden", label: t("settings.runnerWindow.hidden") },
          ]}
        />
      </SettingRow>
      <SettingRow title={t("settings.closeToTray")} hint={t("settings.closeToTrayHint")} htmlFor="setting-tray">
        <Switch
          id="setting-tray"
          checked={settings.closeToTray}
          onCheckedChange={(closeToTray) => {
            update.mutate({ closeToTray });
          }}
        />
      </SettingRow>
      <SettingRow
        title={t("settings.launchAtStartup")}
        hint={t("settings.launchAtStartupHint")}
        htmlFor="setting-startup"
      >
        <Switch
          id="setting-startup"
          checked={settings.launchAtStartup}
          onCheckedChange={(launchAtStartup) => {
            update.mutate({ launchAtStartup });
          }}
        />
      </SettingRow>
    </Section>
  );
}

/** Copy the library as JSON, or paste one back in. */
function LibraryTransferRow() {
  const { t } = useT();
  const importLibrary = useImportLibrary();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const [exported, flashExported] = useFlash();

  const copyExport = () => {
    void ipc
      .exportLibrary()
      .then((json) => navigator.clipboard.writeText(json))
      .then(() => {
        toast.success(t("settings.exportDone"));
        flashExported();
      });
  };

  const close = () => {
    setOpen(false);
    setText("");
  };

  return (
    <SettingRow title={t("settings.transfer")} hint={t("settings.transferHint")}>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={copyExport}>
          <SwapIcon
            swapped={exported}
            from={<CopyIcon size={16} />}
            to={<CheckIcon size={16} />}
          />
          {t("settings.export")}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setOpen(true);
          }}
        >
          <ClipboardPasteIcon />
          {t("settings.import")}
        </Button>
      </div>

      <Modal open={open} onOpenChange={(next) => (next ? setOpen(true) : close())} title={t("settings.importTitle")} description={t("settings.importBody")}>
        <div className="px-6 pt-4">
          <textarea
            autoFocus
            value={text}
            spellCheck={false}
            placeholder={t("settings.importPlaceholder")}
            aria-label={t("settings.importTitle")}
            onChange={(event) => {
              setText(event.target.value);
            }}
            className="h-40 w-full resize-none rounded-control bg-sunken p-3 font-mono text-xs shadow-field outline-none placeholder:text-subtle focus-visible:shadow-[0_0_0_2px_var(--accent-text)]"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2 px-6 pb-6">
          <Button variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={text.trim() === "" || importLibrary.isPending}
            onClick={() => {
              importLibrary.mutate(text, {
                onSuccess: (report) => {
                  toast.success(
                    t("settings.importDone", {
                      added: report.added,
                      present: report.alreadyPresent,
                      unknown: report.unknown,
                    }),
                  );
                  close();
                },
              });
            }}
          >
            {importLibrary.isPending ? <Spinner /> : <ClipboardPasteIcon />}
            {t("settings.importConfirm")}
          </Button>
        </div>
      </Modal>
    </SettingRow>
  );
}

function DataSection() {
  const { t, locale } = useT();
  const storage = useStorageInfo();
  const catalog = useCatalog();
  const refresh = useRefreshCatalog();
  const clean = useCleanStorage();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Section title={t("settings.data")} delay={3}>
      <SettingRow
        title={t("settings.gamesFolder")}
        hint={storage.data ? `${t("settings.storageUsage", { count: storage.data.gameCount, size: formatBytes(storage.data.totalBytes, locale) })}. ${t("settings.gamesFolderHint")}` : t("settings.gamesFolderHint")}
      >
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              void ipc.openGamesFolder();
            }}
          >
            <FolderOpenIcon size={16} />
            {t("common.openFolder")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={!storage.data || storage.data.gameCount === 0}
            onClick={() => {
              setConfirmOpen(true);
            }}
          >
            <Trash2Icon />
            {t("settings.clean")}
          </Button>
        </div>
      </SettingRow>

      <LibraryTransferRow />

      <SettingRow
        title={t("settings.gameList")}
        hint={
          catalog.data
            ? t("settings.gameListCount", { count: new Intl.NumberFormat(locale).format(catalog.data.games.length) })
            : t("common.loading")
        }
      >
        <Button
          size="sm"
          disabled={refresh.isPending}
          onClick={() => {
            refresh.mutate();
          }}
        >
          {refresh.isPending ? <Spinner /> : <RefreshCwIcon />}
          {t("common.refresh")}
        </Button>
      </SettingRow>

      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("settings.cleanConfirm")}
        description={t("settings.cleanConfirmBody")}
      >
        <div className="mt-6 flex justify-end gap-2 px-6 pb-6">
          <Button
            variant="ghost"
            onClick={() => {
              setConfirmOpen(false);
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={clean.isPending}
            onClick={() => {
              clean.mutate(undefined, {
                onSuccess: (report) => {
                  setConfirmOpen(false);
                  toast.success(
                    t("settings.cleanDone", {
                      count: report.removedGames,
                      size: formatBytes(report.freedBytes, locale),
                    }),
                  );
                },
              });
            }}
          >
            <Trash2Icon />
            {t("settings.clean")}
          </Button>
        </div>
      </Modal>
    </Section>
  );
}

/** Looks for a newer version on demand, and opens the update when there is one. */
function UpdateRow() {
  const { t } = useT();
  const info = useUpdateStore((state) => state.info);
  const phase = useUpdateStore((state) => state.phase);
  const setDialogOpen = useUpdateStore((state) => state.setDialogOpen);
  const check = useCheckForUpdate();
  const checking = phase === "checking";

  return (
    <SettingRow
      title={t("settings.updates")}
      hint={info ? t("update.badge", { version: info.version }) : t("settings.updatesHint")}
    >
      {info ? (
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setDialogOpen(true);
          }}
        >
          <DownloadIcon />
          {t("update.cta")}
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={checking}
          onClick={() => {
            check.mutate();
          }}
        >
          {checking ? <Spinner /> : <RefreshCwIcon />}
          {t("settings.checkUpdates")}
        </Button>
      )}
    </SettingRow>
  );
}

function AboutSection() {
  const { t } = useT();
  const { data: info } = useAppInfo();

  return (
    <Section title={t("settings.about")} delay={4}>
      <div className="flex items-center gap-4 px-3.5 py-3">
        <img src="/logo.png" alt="" width={44} height={44} draggable={false} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold tracking-tight">{t("app.name")}</p>
          <p className={cn("text-[13px] text-muted", !info && "invisible")}>
            {t("settings.version", { version: info?.version ?? "0.0.0" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              void openUrl(AUTHOR_URL);
            }}
          >
            <HeartIcon />
            {t("settings.madeBy", { author: `@${AUTHOR_HANDLE}` })}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void openUrl(ORIGINAL_PROJECT_URL);
            }}
          >
            <ExternalLinkIcon size={16} />
            {t("settings.sourceCode")}
          </Button>
        </div>
      </div>
      <UpdateRow />
      <p className="px-3.5 pb-1 text-[13px] text-muted">{t("settings.credits")}</p>
      <p className="px-3.5 pb-3.5 pt-1.5 text-xs leading-relaxed text-subtle">{t("settings.disclaimer")}</p>
    </Section>
  );
}

export default function SettingsPage() {
  const { t } = useT();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 pb-10 pt-7">
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <AppearanceSection />
        <QuestsSection />
        <BehaviorSection />
        <DataSection />
        <AboutSection />
      </div>
    </div>
  );
}
