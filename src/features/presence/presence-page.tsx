import { RadioIcon, TriangleAlertIcon } from "@/components/icons";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { GameIcon } from "@/components/ui/game-icon";
import { Modal } from "@/components/ui/modal";
import { Badge, EmptyState, Section } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import { useLibrary } from "@/features/games/queries";
import { useUiStore } from "@/features/shell/ui-store";
import { useT } from "@/lib/i18n/use-t";
import type { MessageKey } from "@/lib/i18n";
import type { PresenceKind } from "@/types/domain";

import { useClearPresence, usePresenceStatus, usePublishPresence } from "./queries";

const KINDS: readonly PresenceKind[] = ["playing", "listening", "watching", "competing"];
const MAX_TEXT = 128;
const MIN_TEXT = 2;

export default function PresencePage() {
  const { t } = useT();
  const { data: library = [] } = useLibrary();
  const { data: status } = usePresenceStatus();
  const publish = usePublishPresence();
  const clear = useClearPresence();

  const riskAccepted = useUiStore((state) => state.presenceRiskAccepted);
  const acceptRisk = useUiStore((state) => state.acceptPresenceRisk);

  const [pickedGameId, setPickedGameId] = useState<string | null>(null);
  const [kind, setKind] = useState<PresenceKind>("playing");
  const [details, setDetails] = useState("");
  const [state, setState] = useState("");
  const [elapsed, setElapsed] = useState("");
  const [riskOpen, setRiskOpen] = useState(false);

  // Derived: the picked game if it still exists, else the live one, else the first.
  const gameId =
    library.find((entry) => entry.game.id === pickedGameId)?.game.id ??
    status?.gameId ??
    library[0]?.game.id ??
    "";
  const connected = status?.connected ?? false;

  const lengthError = (value: string) => {
    const length = value.trim().length;
    return length > 0 && length < MIN_TEXT ? t("presence.minLength") : undefined;
  };
  const detailsError = lengthError(details);
  const stateError = lengthError(state);
  const invalid = !gameId || Boolean(detailsError) || Boolean(stateError);

  const submit = () => {
    const minutes = Number.parseInt(elapsed, 10);
    publish.mutate(
      {
        gameId,
        kind,
        ...(details.trim() ? { details: details.trim() } : {}),
        ...(state.trim() ? { state: state.trim() } : {}),
        ...(Number.isNaN(minutes) ? {} : { elapsedMinutes: minutes }),
      },
      {
        onSuccess: () => {
          toast.success(t("presence.published"));
        },
      },
    );
  };

  const onSubmit = () => {
    if (riskAccepted) submit();
    else setRiskOpen(true);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 pb-10 pt-7">
        <header>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{t("presence.title")}</h1>
            <Badge tone="warning">{t("presence.experimental")}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">{t("presence.subtitle")}</p>
        </header>

        {library.length === 0 ? (
          <div className="rounded-card bg-surface shadow-card">
            <EmptyState icon={<RadioIcon />} title={t("presence.title")}>
              {t("presence.emptyLibrary")}
            </EmptyState>
          </div>
        ) : (
          <>
            <div
              role="status"
              className="flex items-center gap-3 rounded-card bg-surface px-5 py-4 shadow-card"
            >
              <span
                aria-hidden="true"
                className={connected ? "size-2.5 rounded-full bg-success" : "size-2.5 rounded-full bg-line-strong"}
              />
              <p className="flex-1 text-sm font-medium">
                {connected && status?.gameName
                  ? t("presence.status.on", { game: status.gameName })
                  : t("presence.status.off")}
              </p>
              {connected ? (
                <Button
                  size="sm"
                  disabled={clear.isPending}
                  onClick={() => {
                    clear.mutate(undefined, {
                      onSuccess: () => {
                        toast.success(t("presence.cleared"));
                      },
                    });
                  }}
                >
                  {t("presence.clear")}
                </Button>
              ) : null}
            </div>

            <Section title={t("presence.game")}>
              <form
                className="flex flex-col gap-4 p-3.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!invalid) onSubmit();
                }}
              >
                <Field label={t("presence.game")}>
                  {(field) => (
                    <div className="flex items-center gap-3">
                      {(() => {
                        const current = library.find((entry) => entry.game.id === gameId)?.game;
                        return current ? (
                          <GameIcon gameId={current.id} name={current.name} iconHash={current.iconHash} size={40} />
                        ) : null;
                      })()}
                      <div className="min-w-0 flex-1">
                        <Select
                          {...field}
                          value={gameId}
                          onChange={(event) => {
                            setPickedGameId(event.target.value);
                          }}
                        >
                          {library.map((entry) => (
                            <option key={entry.game.id} value={entry.game.id}>
                              {entry.game.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  )}
                </Field>

                <div>
                  <p className="mb-1.5 text-sm font-medium">{t("presence.kind")}</p>
                  <Segmented<PresenceKind>
                    label={t("presence.kind")}
                    value={kind}
                    onChange={setKind}
                    options={KINDS.map((value) => ({
                      value,
                      label: t(`presence.kind.${value}` satisfies MessageKey),
                    }))}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("presence.details")} optional={t("presence.optional")} error={detailsError}>
                    {(field) => (
                      <TextInput
                        {...field}
                        value={details}
                        maxLength={MAX_TEXT}
                        onChange={(event) => {
                          setDetails(event.target.value);
                        }}
                      />
                    )}
                  </Field>
                  <Field label={t("presence.state")} optional={t("presence.optional")} error={stateError}>
                    {(field) => (
                      <TextInput
                        {...field}
                        value={state}
                        maxLength={MAX_TEXT}
                        onChange={(event) => {
                          setState(event.target.value);
                        }}
                      />
                    )}
                  </Field>
                </div>

                <Field label={t("presence.elapsed")} optional={t("presence.optional")}>
                  {(field) => (
                    <div className="flex items-center gap-2">
                      <TextInput
                        {...field}
                        inputMode="numeric"
                        placeholder="0"
                        value={elapsed}
                        className="w-28 tabular-nums"
                        onChange={(event) => {
                          setElapsed(event.target.value.replace(/\D/g, "").slice(0, 4));
                        }}
                      />
                      <span className="text-sm text-muted">{t("common.minutesShort")}</span>
                    </div>
                  )}
                </Field>

                <div className="flex justify-end pt-1">
                  <Button type="submit" variant="primary" disabled={invalid || publish.isPending}>
                    <RadioIcon />
                    {connected ? t("presence.update") : t("presence.publish")}
                  </Button>
                </div>
              </form>
            </Section>
          </>
        )}
      </div>

      <Modal
        open={riskOpen}
        onOpenChange={setRiskOpen}
        title={t("presence.risk.title")}
        description={t("presence.risk.body")}
      >
        <div className="mt-2 flex items-start gap-3 px-6 pt-3 text-sm text-warning">
          <TriangleAlertIcon size={18} className="mt-0.5 shrink-0" />
        </div>
        <div className="mt-2 flex justify-end gap-2 px-6 pb-6">
          <Button
            variant="ghost"
            onClick={() => {
              setRiskOpen(false);
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              acceptRisk();
              setRiskOpen(false);
              submit();
            }}
          >
            {t("presence.risk.confirm")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
