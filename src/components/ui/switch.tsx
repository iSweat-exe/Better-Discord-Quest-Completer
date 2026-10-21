import * as RadixSwitch from "@radix-ui/react-switch";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/** A 40×24 track; the surrounding `SettingRow` label extends the hit area. */
export function Switch({ className, ...props }: ComponentProps<typeof RadixSwitch.Root>) {
  return (
    <RadixSwitch.Root
      className={cn(
        "relative h-6 w-10 shrink-0 rounded-full bg-line-strong shadow-[inset_0_1px_2px_oklch(0_0_0/0.15)]",
        "transition-colors duration-150 ease-out data-[state=checked]:bg-accent",
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb
        className={cn(
          "block size-5 translate-x-0.5 rounded-full bg-white shadow-[0_1px_3px_oklch(0_0_0/0.35)]",
          "transition-[translate] duration-150 ease-out data-[state=checked]:translate-x-[18px]",
        )}
      />
    </RadixSwitch.Root>
  );
}
