import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { AppToaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/query";

export function Providers({ children }: { children: ReactNode }) {
  // Created once per mount, not at module level, so tests get a fresh cache.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400} skipDelayDuration={200}>
        {children}
      </TooltipProvider>
      <AppToaster />
    </QueryClientProvider>
  );
}
