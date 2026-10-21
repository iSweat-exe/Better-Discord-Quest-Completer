import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ShoppingBag } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { CheckIcon, CopyIcon, ExternalLinkIcon, RefreshCwIcon, SearchIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DisclosureChevron } from "@/components/ui/disclosure-chevron";
import { TextInput } from "@/components/ui/field";
import { OrbIcon } from "@/components/ui/orb-icon";
import { Badge, EmptyState, Spinner } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { SwapIcon } from "@/components/ui/swap-icon";
import { OrbsBalance } from "@/features/quests/orbs-balance";
import { useOrbsBalance, useOrbsShop, useQuestsConnection } from "@/features/quests/queries";
import { TokenGate } from "@/features/quests/token-gate";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-t";
import { SHOP_URL } from "@/lib/links";
import { queryKeys } from "@/lib/query";
import { useFlash } from "@/lib/use-flash";
import type { ShopCategory, ShopProduct, ShopProductKind } from "@/types/domain";

type KindFilter = "all" | "avatarDecoration" | "profileEffect" | "nameplate" | "bundle";
type Sort = "default" | "priceAsc" | "priceDesc";

const KIND_FILTERS: Record<Exclude<KindFilter, "all">, readonly ShopProductKind[]> = {
  avatarDecoration: ["avatarDecoration"],
  profileEffect: ["profileEffect"],
  nameplate: ["nameplate"],
  bundle: ["bundle"],
};

function ProductCard({ product, balance }: { product: ShopProduct; balance: number | undefined }) {
  const { t, locale } = useT();
  const { orbPrice } = product;
  const missing = orbPrice !== null && balance !== undefined && balance < orbPrice ? orbPrice - balance : 0;
  const affordable = orbPrice !== null && balance !== undefined && missing === 0;

  return (
    <li className="group flex flex-col overflow-hidden rounded-card bg-surface shadow-card transition-transform duration-200 ease-out hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      {/* A fixed square stage: tall effects and wide nameplates are contained, never stretch the card. */}
      <div
        className="relative aspect-square overflow-hidden bg-sunken bg-[radial-gradient(circle_at_50%_45%,var(--accent-soft),transparent_72%)]"
        // Without an image, Discord's own colors for the item carry the card.
        style={
          product.imageUrl === null && product.colors.length > 0
            ? { backgroundImage: `linear-gradient(145deg, ${product.colors.join(", ")})` }
            : undefined
        }
      >
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className={cn(
              "absolute inset-0 size-full object-contain transition-transform duration-300 ease-out group-hover:scale-105 motion-reduce:transition-none",
              product.kind === "nameplate" ? "p-1" : "p-4",
            )}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <OrbIcon className="size-14 drop-shadow-lg" />
          </div>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <Badge className="bg-bg/80 backdrop-blur-sm">{t(`shop.kind.${product.kind}` satisfies MessageKey)}</Badge>
          {product.bundleSize !== null ? (
            <Badge tone="accent" className="backdrop-blur-sm">
              {t("shop.bundleSize", { count: product.bundleSize })}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-5 tracking-tight" title={product.name}>
          {product.name}
        </h3>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          {orbPrice === null ? (
            <span className="text-[13px] text-subtle">{t("shop.noOrbPrice")}</span>
          ) : (
            <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
              <OrbIcon className="size-4 shrink-0" />
              {formatNumber(orbPrice, locale)}
            </span>
          )}
          {affordable ? (
            <Badge tone="success">{t("shop.affordable")}</Badge>
          ) : missing > 0 ? (
            <span className="text-xs tabular-nums text-subtle">
              {t("shop.missing", { amount: formatNumber(missing, locale) })}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ShopBoard() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const shop = useOrbsShop();
  const { data: balance } = useOrbsBalance();
  const [kind, setKind] = useState<KindFilter>("all");
  const [sort, setSort] = useState<Sort>("default");
  const [query, setQuery] = useState("");
  const [affordableOnly, setAffordableOnly] = useState(false);
  const [rawCopied, flashRawCopied] = useFlash();

  const categoryList = shop.data?.categories;
  const categories = useMemo<ShopCategory[]>(() => {
    const needle = query.trim().toLowerCase();
    const kinds = kind === "all" ? null : KIND_FILTERS[kind];

    const keep = (product: ShopProduct) =>
      (kinds === null || kinds.includes(product.kind)) &&
      (needle === "" || product.name.toLowerCase().includes(needle)) &&
      (!affordableOnly || balance === undefined || (product.orbPrice !== null && product.orbPrice <= balance));

    const price = (product: ShopProduct) => product.orbPrice ?? Number.POSITIVE_INFINITY;
    const order = (a: ShopProduct, b: ShopProduct) =>
      sort === "priceAsc" ? price(a) - price(b) : sort === "priceDesc" ? (price(b) === price(a) ? 0 : price(b) - price(a)) : 0;

    return (categoryList ?? [])
      .map((category) => ({ ...category, products: category.products.filter(keep).toSorted(order) }))
      .filter((category) => category.products.length > 0);
  }, [categoryList, kind, sort, query, affordableOnly, balance]);

  const total = categories.reduce((sum, category) => sum + category.products.length, 0);
  const unresolvedJson = shop.data?.unresolvedJson ?? "";

  const copyUnresolved = () => {
    void navigator.clipboard.writeText(unresolvedJson).then(() => {
      toast.success(t("shop.rawCopied"));
      flashRawCopied();
    });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-8 pb-10 pt-7">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("shop.title")}</h1>
            <p className="mt-1 text-sm text-muted">{t("shop.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <OrbsBalance />
            <Button
              size="sm"
              disabled={shop.isFetching}
              onClick={() => {
                void shop.refetch();
                void queryClient.invalidateQueries({ queryKey: queryKeys.orbsBalance });
              }}
            >
              <RefreshCwIcon size={16} className={cn(shop.isFetching && "animate-spin")} />
              {t("quests.refresh")}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void openUrl(SHOP_URL);
              }}
            >
              <ExternalLinkIcon size={16} />
              {t("shop.openInDiscord")}
            </Button>
          </div>
        </header>

        {shop.isPending ? (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Spinner /> {t("common.loading")}
          </p>
        ) : shop.isError ? (
          <div className="rounded-card bg-surface shadow-card">
            <EmptyState
              icon={<ShoppingBag />}
              title={t("shop.loadFailed")}
              action={
                <Button
                  onClick={() => {
                    void shop.refetch();
                  }}
                >
                  {t("common.retry")}
                </Button>
              }
            >
              {errorMessage(shop.error, t)}
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 -mx-2 flex flex-col gap-3 rounded-card bg-bg/90 px-2 py-2 backdrop-blur-md">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-52 flex-1">
                  <SearchIcon
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
                  />
                  <TextInput
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                    }}
                    placeholder={t("shop.search")}
                    aria-label={t("shop.search")}
                    className="pl-9"
                  />
                </div>
                <Segmented<Sort>
                  label={t("shop.sort")}
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: "default", label: t("shop.sort.default") },
                    { value: "priceAsc", label: t("shop.sort.priceAsc") },
                    { value: "priceDesc", label: t("shop.sort.priceDesc") },
                  ]}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented<KindFilter>
                  label={t("shop.title")}
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: "all", label: t("shop.filter.all") },
                    { value: "avatarDecoration", label: t("shop.kind.avatarDecoration") },
                    { value: "profileEffect", label: t("shop.kind.profileEffect") },
                    { value: "nameplate", label: t("shop.kind.nameplate") },
                    { value: "bundle", label: t("shop.kind.bundle") },
                  ]}
                />
                <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
                  <Switch checked={affordableOnly} onCheckedChange={setAffordableOnly} disabled={balance === undefined} />
                  {t("shop.filter.affordable")}
                </label>
              </div>
            </div>

            {categories.length === 0 ? (
              <div className="rounded-card bg-surface shadow-card">
                <EmptyState icon={<ShoppingBag />} title={t("shop.empty")} />
              </div>
            ) : (
              categories.map((category) => (
                <section key={category.skuId} className="flex flex-col gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                      {category.name}
                      {category.orbsExclusive ? <Badge tone="accent">{t("shop.orbsOnly")}</Badge> : null}
                    </h2>
                    {category.summary ? <p className="mt-0.5 text-[13px] text-muted">{category.summary}</p> : null}
                  </div>
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
                    {category.products.map((product) => (
                      <ProductCard key={product.skuId} product={product} balance={balance} />
                    ))}
                  </ul>
                </section>
              ))
            )}

            <p className="text-xs text-subtle">{t("shop.count", { count: total })}</p>

            {unresolvedJson !== "" ? (
              <details className="group text-[13px] text-muted">
                <summary className="flex cursor-pointer list-none select-none items-center gap-1.5 rounded-lg py-1 hover:text-fg">
                  <DisclosureChevron />
                  {t("shop.missingImages")}
                </summary>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Button size="sm" onClick={copyUnresolved}>
                    <SwapIcon swapped={rawCopied} from={<CopyIcon size={16} />} to={<CheckIcon size={16} />} />
                    {t("shop.copyRaw")}
                  </Button>
                  <p className="min-w-0 flex-1 text-xs text-subtle">{t("shop.copyRawHint")}</p>
                </div>
              </details>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export default function ShopPage() {
  const connection = useQuestsConnection();

  if (connection.isPending) {
    return (
      <div className="grid h-full place-items-center text-muted">
        <Spinner className="size-5" />
      </div>
    );
  }
  return connection.data ? <ShopBoard /> : <TokenGate />;
}
