import { ChevronRightIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * The arrow of a `<details>` summary: it turns down when the block opens. The
 * `<details>` must carry the `group` class.
 */
export function DisclosureChevron({ className }: { className?: string }) {
  return (
    <ChevronRightIcon
      aria-hidden="true"
      size={14}
      className={cn("transition-transform duration-200 ease-out group-open:rotate-90", className)}
    />
  );
}
