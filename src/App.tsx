import { Providers } from "@/app/providers";
import { AppShell } from "@/features/shell/app-shell";
import { Bootstrap } from "@/features/shell/bootstrap";

export function App() {
  return (
    <Providers>
      <Bootstrap />
      <AppShell />
    </Providers>
  );
}
