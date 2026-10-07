import {
  Bell, Briefcase, Calculator, Calendar, CircleHelp, FileText, Folder, Gavel, Globe, Mail, MessageCircle, MessageSquare,
  MessagesSquare, NotebookPen, Quote, Scale, Shield, SlidersHorizontal, Sparkles, User, Users, Wallet, type LucideIcon,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import type { ToolModule } from "@/lib/chat-status";
import type { CanvasSubject } from "@/components/shell/shell-context";
import { placeOf } from "@/components/shell/places";

/** The icon each module shows on its plan step and approval card. */
export const MODULE_ICONS: Record<ToolModule, LucideIcon> = {
  vault: Folder, knowledge: Folder, runs: FileText, artifacts: FileText, conversations: MessagesSquare, memory: NotebookPen,
  citations: Quote, ui: Sparkles, session: User, platform: Shield, judicial: Gavel, agenda: Calendar, research: Scale,
  google: Mail, whatsapp: MessageCircle, honorarios: Wallet, calc: Calculator, collaboration: Users, messages: MessageSquare,
  notifications: Bell, agent_settings: SlidersHorizontal, help: CircleHelp, web: Globe,
};

type SubjectChip = { label: string; icon: ComponentType<SVGProps<SVGSVGElement>> };

/** The composer's chip: what the canvas shows, so the person knows what "isto" means to the Lume. */
export function subjectChip(subject: CanvasSubject): SubjectChip {
  switch (subject.kind) {
    case "case": return { label: subject.title, icon: Folder };
    case "document": return { label: subject.title, icon: FileText };
    case "module": return { label: subject.title, icon: placeOf(`/app/${subject.slug.replace(":", "/")}`).icon };
    default: return { label: "Escritório", icon: Briefcase };
  }
}
