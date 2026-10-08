import { AdminCanvas } from '@/components/admin/admin-canvas';
import { officePage } from '@/components/lume/canvas-leaf';
import { redirect } from "next/navigation";

function AdminPage() { return redirect("/app/admin/feedback"); }

export default officePage('/app/admin', AdminPage, AdminCanvas);
