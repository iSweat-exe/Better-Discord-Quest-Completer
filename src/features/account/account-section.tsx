import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ShieldCheckIcon, ShieldAlertIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-t";
import type { AccountDetails, Premium, ProfileEdit } from "@/types/domain";

import { ConfirmWriteDialog } from "./confirm-write-dialog";
import { useAccount, useEditProfile } from "./queries";

/** Discord's limits, also checked by the backend. */
const DISPLAY_NAME_MAX = 32;
const PRONOUNS_MAX = 40;
const BIO_MAX = 190;

const PREMIUM_LABELS = {
  none: "account.premium.none",
  classic: "account.premium.classic",
  nitro: "account.premium.nitro",
  basic: "account.premium.basic",
} as const satisfies Record<Premium, MessageKey>;

const UNKNOWN = "–";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-surface p-4">
      <p className="text-[13px] text-muted">{label}</p>
      <div className="mt-1.5 flex min-h-6 items-center gap-1.5 text-sm font-medium [&_svg]:size-4">{children}</div>
    </div>
  );
}

interface Draft {
  displayName: string;
  pronouns: string;
  bio: string;
}

function draftOf(account: AccountDetails): Draft {
  return { displayName: account.displayName ?? "", pronouns: account.pronouns, bio: account.bio };
}

/** Only the fields that really change are sent. */
function changesOf(account: AccountDetails, draft: Draft): ProfileEdit {
  const before = draftOf(account);
  const edit: ProfileEdit = {};
  if (draft.displayName.trim() !== before.displayName) edit.displayName = draft.displayName.trim();
  if (draft.pronouns.trim() !== before.pronouns) edit.pronouns = draft.pronouns.trim();
  if (draft.bio.trim() !== before.bio) edit.bio = draft.bio.trim();
  return edit;
}

/** One line of the confirmation: before → after. */
function Change({ label, before, after }: { label: string; before: string; after: string }) {
  const { t } = useT();
  const empty = <span className="italic text-subtle">{t("account.edit.empty")}</span>;
  return (
    <div className="border-b border-line py-2.5 last:border-b-0">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-subtle line-through">{before || empty}</p>
      <p className="mt-0.5 whitespace-pre-wrap break-words font-medium">{after || empty}</p>
    </div>
  );
}

function EditProfile({ account }: { account: AccountDetails }) {
  const { t } = useT();
  const editProfile = useEditProfile();
  const [step, setStep] = useState<"closed" | "edit" | "confirm">("closed");
  const [draft, setDraft] = useState<Draft>(() => draftOf(account));

  const changes = changesOf(account, draft);
  const hasChanges = Object.keys(changes).length > 0;
  const tooLong =
    draft.displayName.trim().length > DISPLAY_NAME_MAX || draft.pronouns.trim().length > PRONOUNS_MAX || draft.bio.trim().length > BIO_MAX;

  const close = () => {
    setStep("closed");
  };
  const set = (key: keyof Draft) => (value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const counter = (value: string, max: number) => t("account.edit.counter", { count: value.trim().length, max });

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setDraft(draftOf(account));
          setStep("edit");
        }}
      >
        {t("account.edit.open")}
      </Button>

      <Modal
        open={step === "edit"}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={t("account.edit.title")}
        description={t("account.edit.body")}
        className="w-[min(92vw,520px)]"
      >
        <form
          className="flex flex-col gap-4 px-6 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (hasChanges && !tooLong) setStep("confirm");
          }}
        >
          <Field
            label={t("account.field.displayName")}
            hint={draft.displayName.trim() ? counter(draft.displayName, DISPLAY_NAME_MAX) : t("account.edit.displayNameEmpty", { username: account.username })}
            error={draft.displayName.trim().length > DISPLAY_NAME_MAX ? counter(draft.displayName, DISPLAY_NAME_MAX) : undefined}
          >
            {(props) => (
              <TextInput {...props} value={draft.displayName} placeholder={account.username} onChange={(event) => { set("displayName")(event.target.value); }} />
            )}
          </Field>
          <Field
            label={t("account.field.pronouns")}
            hint={counter(draft.pronouns, PRONOUNS_MAX)}
            error={draft.pronouns.trim().length > PRONOUNS_MAX ? counter(draft.pronouns, PRONOUNS_MAX) : undefined}
          >
            {(props) => <TextInput {...props} value={draft.pronouns} onChange={(event) => { set("pronouns")(event.target.value); }} />}
          </Field>
          <Field
            label={t("account.field.bio")}
            hint={counter(draft.bio, BIO_MAX)}
            error={draft.bio.trim().length > BIO_MAX ? counter(draft.bio, BIO_MAX) : undefined}
          >
            {(props) => (
              <textarea
                {...props}
                value={draft.bio}
                spellCheck
                onChange={(event) => {
                  set("bio")(event.target.value);
                }}
                className="h-28 w-full resize-none rounded-control bg-surface p-3 text-sm shadow-field outline-none placeholder:text-subtle focus-visible:shadow-[0_0_0_2px_var(--accent-text)] aria-[invalid=true]:shadow-[0_0_0_2px_var(--danger)]"
              />
            )}
          </Field>
          <div className="mb-6 mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!hasChanges || tooLong}>
              {t("account.edit.review")}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmWriteDialog
        open={step === "confirm"}
        title={t("account.edit.confirmTitle")}
        confirmLabel={t("account.edit.confirm")}
        pending={editProfile.isPending}
        onCancel={() => {
          setStep("edit");
        }}
        onConfirm={() => {
          editProfile.mutate(changes, {
            onSuccess: () => {
              close();
              toast.success(t("account.edit.done"));
            },
          });
        }}
      >
        <p className="text-muted">{t("account.edit.confirmBody")}</p>
        <div className="mt-2 rounded-inner bg-sunken px-3">
          {changes.displayName !== undefined ? (
            <Change label={t("account.field.displayName")} before={account.displayName ?? ""} after={changes.displayName} />
          ) : null}
          {changes.pronouns !== undefined ? <Change label={t("account.field.pronouns")} before={account.pronouns} after={changes.pronouns} /> : null}
          {changes.bio !== undefined ? <Change label={t("account.field.bio")} before={account.bio} after={changes.bio} /> : null}
        </div>
      </ConfirmWriteDialog>
    </>
  );
}

/** The account as Discord knows it, and the profile fields the user can change from here. */
export function AccountSection() {
  const { t, locale } = useT();
  const { data: account, isError } = useAccount();

  if (isError && !account) {
    return <p className="rounded-card bg-surface px-4 py-5 text-sm text-muted shadow-card">{t("account.unavailable")}</p>;
  }

  const createdAt = account ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(account.createdAt) : UNKNOWN;

  return (
    <div className="overflow-hidden rounded-card bg-line shadow-card">
      <div className="flex items-start justify-between gap-4 bg-surface p-4">
        <div className="min-w-0">
          <p className="text-[13px] text-muted">{t("account.field.bio")}</p>
          <p className={cn("mt-1.5 whitespace-pre-wrap break-words text-sm", !account?.bio && "italic text-subtle")}>
            {account ? account.bio || t("account.bio.empty") : UNKNOWN}
          </p>
          {account?.pronouns ? <p className="mt-2 text-[13px] text-muted">{account.pronouns}</p> : null}
        </div>
        {account ? <EditProfile account={account} /> : null}
      </div>
      <div className="mt-px grid grid-cols-3 gap-px">
        <Detail label={t("account.field.premium")}>{account ? t(PREMIUM_LABELS[account.premium]) : UNKNOWN}</Detail>
        <Detail label={t("account.field.createdAt")}>{createdAt}</Detail>
        <Detail label={t("account.field.security")}>
          {account ? (
            account.mfaEnabled ? (
              <span className="flex items-center gap-1.5 text-success">
                <ShieldCheckIcon />
                {t("account.mfa.on")}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-warning">
                <ShieldAlertIcon />
                {t("account.mfa.off")}
              </span>
            )
          ) : (
            UNKNOWN
          )}
        </Detail>
      </div>
      {account && account.badges.length > 0 ? (
        <div className="mt-px flex flex-wrap gap-1.5 bg-surface p-4">
          {account.badges.map((badge) => (
            <Badge key={badge.id} title={badge.description}>
              {badge.description}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
