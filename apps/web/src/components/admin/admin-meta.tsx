import { CanvasMeta } from "@/components/shell/shell-context";

/** Names the canvas tab and tells the Lume which part of the administration is open. */
export function AdminMeta({ title }: { title: string }) {
  const full = `Administração · ${title}`;
  return <CanvasMeta title={full} subject={{ kind: "module", slug: "admin", title: full }} />;
}
