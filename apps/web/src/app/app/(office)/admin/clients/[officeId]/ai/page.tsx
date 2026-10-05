import { redirect } from "next/navigation";

/** AI is configured once for the platform; the per-office page leads to the IA tab. */
export default function ClientAiPage() { redirect("/app/admin/ai"); }
