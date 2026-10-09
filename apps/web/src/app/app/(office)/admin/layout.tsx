import { notFound } from "next/navigation";
import { requirePlatformPage } from "@/lib/platform";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!await requirePlatformPage()) notFound();
  return children;
}
