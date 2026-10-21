import { useState, type ReactNode } from "react";

import { CheckIcon, CircleHelpIcon, EyeIcon, EyeOffIcon, KeyRoundIcon, ShieldAlertIcon, ShieldCheckIcon, TriangleAlertIcon, TrophyIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DisclosureChevron } from "@/components/ui/disclosure-chevron";
import { Field, TextInput } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Badge, Spinner } from "@/components/ui/primitives";
import { SwapIcon } from "@/components/ui/swap-icon";
import { cn } from "@/lib/cn";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-t";

import { useConnectQuests } from "./queries";

const HELP_STEPS = [
  "token.help.step1",
  "token.help.step2",
  "token.help.step3",
  "token.help.step4",
  "token.help.step5",
] as const satisfies readonly MessageKey[];

/** Step-by-step guide for people who have never looked for their token. */
function TokenHelp() {
  const { t } = useT();

  return (
    <details className="group rounded-inner bg-sunken text-[13px]">
      <summary className="flex cursor-pointer select-none items-center gap-2 rounded-inner px-3.5 py-3 font-medium hover:text-accent-text">
        <CircleHelpIcon size={16} />
        {t("token.help.title")}
        <DisclosureChevron className="ml-auto" />
      </summary>

      <div className="space-y-3 px-3.5 pb-3.5">
        <p className="text-muted">{t("token.help.intro")}</p>

        <ol className="space-y-2">
          {HELP_STEPS.map((step, index) => (
            <li key={step} className="flex items-start gap-2.5 leading-snug">
              <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold tabular-nums text-accent-text">
                {index + 1}
              </span>
              <span>{t(step)}</span>
            </li>
          ))}
        </ol>

        <ul className="space-y-1.5 rounded-lg bg-warning-soft p-3 text-warning">
          {(["token.help.warn1", "token.help.warn2"] as const).map((warning) => (
            <li key={warning} className="flex items-start gap-2 leading-snug">
              <TriangleAlertIcon size={16} className="mt-0.5 shrink-0" />
              <span>{t(warning)}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function TokenDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useT();
  const connect = useConnectQuests();
  const [token, setToken] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [visible, setVisible] = useState(false);

  // Nothing about the token outlives the dialog: not the field, not the mutation.
  const close = () => {
    setToken("");
    setAcknowledged(false);
    setVisible(false);
    connect.reset();
    onOpenChange(false);
  };

  const ready = token.trim() !== "" && acknowledged && !connect.isPending;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={t("token.title")}
      description={t("token.body")}
      className="w-[min(92vw,580px)] max-h-[88vh] overflow-y-auto"
    >
      <form
        className="flex flex-col gap-4 px-6 pb-6 pt-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) connect.mutate(token, { onSuccess: close });
        }}
      >
        <TokenHelp />

        <Field label={t("token.label")}>
          {(field) => (
            <div className="relative">
              <TextInput
                {...field}
                autoFocus
                type={visible ? "text" : "password"}
                value={token}
                className="pr-11 font-mono"
                onChange={(event) => {
                  setToken(event.target.value);
                }}
              />
              <Button
                variant="ghost"
                size="iconSm"
                aria-label={visible ? t("token.hide") : t("token.show")}
                className="absolute right-1 top-1/2 -translate-y-1/2"
                onClick={() => {
                  setVisible((current) => !current);
                }}
              >
                <SwapIcon
                  swapped={visible}
                  from={<EyeIcon size={16} />}
                  to={<EyeOffIcon size={16} />}
                />
              </Button>
            </div>
          )}
        </Field>

        <label className="flex cursor-pointer items-start gap-3 rounded-inner bg-warning-soft p-3.5 text-[13px] leading-snug text-warning">
          <input
            type="checkbox"
            checked={acknowledged}
            className="mt-0.5 size-4 shrink-0 accent-accent"
            onChange={(event) => {
              setAcknowledged(event.target.checked);
            }}
          />
          {t("token.ack")}
        </label>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!ready}>
            {connect.isPending ? <Spinner /> : <KeyRoundIcon />}
            {connect.isPending ? t("token.checking") : t("token.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Panel({
  icon,
  title,
  tone = "neutral",
  children,
}: {
  icon: ReactNode;
  title: string;
  tone?: "neutral" | "warning";
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-card p-5 shadow-card",
        tone === "warning" ? "bg-warning-soft" : "bg-surface",
      )}
    >
      <h2
        className={cn(
          "mb-2 flex items-center gap-2 text-sm font-semibold tracking-tight [&_svg]:size-[18px]",
          tone === "warning" && "text-warning",
        )}
      >
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function BulletList({ items, kind }: { items: readonly MessageKey[]; kind: "do" | "never" }) {
  const { t } = useT();

  return (
    <ul className="space-y-2 text-[13px] leading-snug">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5">
          {kind === "do" ? (
            <CheckIcon size={16} className="mt-0.5 shrink-0 [&_svg]:stroke-2 text-success" />
          ) : (
            <XIcon size={16} className="mt-0.5 shrink-0 [&_svg]:stroke-2 text-danger" />
          )}
          <span>{t(item)}</span>
        </li>
      ))}
    </ul>
  );
}

const DOES = ["gate.does1", "gate.does2", "gate.does3"] as const;
const NEVER = ["gate.never1", "gate.never2", "gate.never3"] as const;

/** Explains why Discord quests need the account token, and asks for it. */
export function TokenGate() {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-8 pb-10 pt-7">
        <header>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{t("quests.title")}</h1>
            <Badge>{t("quests.optional")}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">{t("gate.intro")}</p>
        </header>

        <Panel icon={<TrophyIcon />} title={t("gate.why.title")}>
          <p className="text-[13px] leading-relaxed text-muted">{t("gate.why.body")}</p>
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2">
          <Panel icon={<ShieldCheckIcon className="text-success" />} title={t("gate.does.title")}>
            <BulletList items={DOES} kind="do" />
          </Panel>
          <Panel icon={<ShieldAlertIcon className="text-danger" />} title={t("gate.never.title")}>
            <BulletList items={NEVER} kind="never" />
          </Panel>
        </div>

        <Panel icon={<ShieldAlertIcon />} title={t("gate.risks.title")} tone="warning">
          <p className="text-[13px] leading-relaxed">{t("gate.risks.body")}</p>
          <p className="mt-2 text-[13px] font-medium">{t("gate.risks.advice")}</p>
        </Panel>

        <div className="flex justify-end pt-1">
          <Button
            variant="primary"
            onClick={() => {
              setOpen(true);
            }}
          >
            <KeyRoundIcon />
            {t("gate.cta")}
          </Button>
        </div>
      </div>

      <TokenDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
