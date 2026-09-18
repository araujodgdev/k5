import { LoaderCircle } from "lucide-react";

export default function PlatformLoading() {
  return <p className="mx-auto flex max-w-5xl items-center gap-2 py-12 text-muted-foreground text-sm" role="status"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />Carregando…</p>;
}
