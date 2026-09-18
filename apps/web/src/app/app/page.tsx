import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/session";

export default async function AppPage() {
  await requireWorkspace();
  redirect("/app/command-center");
}
