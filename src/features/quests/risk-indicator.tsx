import { Badge } from "@/components/ui/primitives";
import { useQuestRisk } from "@/features/quests/queries";
import { useUiStore } from "@/features/shell/ui-store";
import { useT } from "@/lib/i18n/use-t";

/** The level of risk of the recent writes on the account, in the page header. Red as soon as it is not low. */
export function RiskIndicator() {
  const { t } = useT();
  const { data } = useQuestRisk();
  const navigate = useUiStore((state) => state.navigate);
  if (!data) return null;

  const hint = `${t("quests.risk.hint", { count: data.writes })} · ${t("quests.risk.seeHistory")}`;
  const low = data.level === "low";

  return (
    <button
      type="button"
      title={hint}
      onClick={() => {
        navigate("profile");
      }}
      className="hit-40 rounded-md outline-offset-2 transition-[scale] duration-150 ease-out active:scale-[0.96]"
    >
      <Badge tone={low ? "success" : "danger"}>
        {low ? t("quests.risk.low") : `${t("quests.risk.ban")} · ${t("quests.risk.hint", { count: data.writes })}`}
      </Badge>
    </button>
  );
}

/** Says what the red badge means and what to do, only while the risk is not low. */
export function RiskNotice() {
  const { t } = useT();
  const { data } = useQuestRisk();
  if (!data || data.level === "low") return null;

  return (
    <p role="status" className="rounded-card bg-danger-soft p-4 text-[13px] text-danger">
      {t(`quests.risk.explain.${data.level}`, { count: data.writes })}
    </p>
  );
}
