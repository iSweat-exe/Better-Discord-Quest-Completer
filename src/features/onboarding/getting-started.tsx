import { useEffect, useMemo } from "react";
import { toast } from "sonner";

import { CheckIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useLibrary } from "@/features/games/queries";
import { useQuestsConnection } from "@/features/quests/queries";
import { useUiStore } from "@/features/shell/ui-store";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";

import { useOnboardingStore } from "./onboarding-store";
import { checklist, isChecklistComplete, type ChecklistItemId } from "./steps";

/** Where each item leads: the place to do it. */
function act(id: ChecklistItemId) {
  const ui = useUiStore.getState();
  switch (id) {
    case "add":
      ui.navigate("games");
      ui.setSearchOpen(true);
      break;
    case "quests":
      ui.navigate("quests");
      break;
    default:
      ui.navigate("games");
  }
}

/**
 * "First steps" in the sidebar: the few actions that lead to the moment the app
 * proves itself (Discord showing the game), ticked by themselves as they happen.
 * It never blocks anything, can be hidden, and leaves once it is done.
 */
export function GettingStarted() {
  const { t } = useT();
  const hidden = useOnboardingStore((state) => state.checklistHidden);
  const celebrated = useOnboardingStore((state) => state.checklistCelebrated);
  const launched = useOnboardingStore((state) => state.launchedOnce);
  const detected = useOnboardingStore((state) => state.detectedOnce);
  const hide = useOnboardingStore((state) => state.hideChecklist);
  const celebrate = useOnboardingStore((state) => state.celebrate);
  const { data: library } = useLibrary();
  const { data: connected = false } = useQuestsConnection();

  const items = useMemo(
    () =>
      checklist({
        libraryCount: library?.length ?? 0,
        launched: launched || (library ?? []).some((entry) => entry.lastPlayedAt !== null),
        detected,
        connected,
      }),
    [library, launched, detected, connected],
  );
  const complete = isChecklistComplete(items);

  useEffect(() => {
    if (complete && !celebrated) {
      celebrate();
      toast.success(t("start.doneToast"), { description: t("start.doneBody") });
    }
  }, [complete, celebrated, celebrate, t]);

  if (hidden || complete || library === undefined) return null;

  const required = items.filter((item) => !item.optional);
  const done = required.filter((item) => item.done).length;

  return (
    <section aria-labelledby="start-title" className="mb-2 rounded-card bg-surface p-3 shadow-card">
      <div className="flex items-center gap-2">
        <h2 id="start-title" className="flex-1 text-[13px] font-semibold">
          {t("start.title")}
        </h2>
        <span className="text-xs tabular-nums text-subtle">{t("start.count", { done, total: required.length })}</span>
        <Button variant="ghost" size="iconSm" aria-label={t("start.hide")} className="-mr-1 size-6" onClick={hide}>
          <XIcon size={12} />
        </Button>
      </div>
      <ProgressBar value={done / required.length} label={t("start.title")} className="mt-2" />
      <ul className="mt-2 flex flex-col">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              disabled={item.done}
              onClick={() => {
                act(item.id);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs",
                item.done ? "text-subtle line-through decoration-subtle/60" : "text-fg hover:bg-raised",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-4 shrink-0 place-items-center rounded-full",
                  item.done ? "bg-success text-on-accent" : "ring-1 ring-inset ring-line",
                )}
              >
                {item.done ? <CheckIcon size={10} /> : null}
              </span>
              <span className="min-w-0 flex-1">
                {t(item.label)}
                {item.optional ? <span className="text-subtle"> · {t("start.optional")}</span> : null}
              </span>
              <span className="sr-only">{item.done ? t("start.doneItem") : t("start.todoItem")}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
