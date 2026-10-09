import { AdminCanvas } from '@/components/admin/admin-canvas';
import { officePage } from '@/components/lume/canvas-leaf';
import { redirect } from "next/navigation";

/** AI is configured once for the platform; the per-office page leads to the IA tab. */
function ClientAiPage() { return redirect("/app/admin/ai"); }

export default officePage('/app/admin/clients/[officeId]/ai', ClientAiPage, AdminCanvas);
