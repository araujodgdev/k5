import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!await getSession()) redirect("/sign-in");
  return children;
}
