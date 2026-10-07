import { LoaderCircle } from "lucide-react";

export default function AdminLoading() {
  return (
    <p role="status" className="flex items-center gap-2 py-10 text-[13.5px] text-muted-foreground">
      <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />Carregando…
    </p>
  );
}
