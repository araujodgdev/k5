import { Calculator, CalendarDays, CreditCard, FolderLock, House, Mail, Megaphone, MessageCircle, MessagesSquare, Plug, Search, Wallet } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { LumeMark } from "./lume-mark";
import type { NavSlug } from "@/lib/navigation";

export const navIcons: Record<NavSlug, ComponentType<SVGProps<SVGSVGElement>>> = {
  "command-center": House,
  agents: LumeMark,
  vault: FolderLock,
  research: Search,
  agenda: CalendarDays,
  honorarios: Wallet,
  calc: Calculator,
  email: Mail,
  messages: MessagesSquare,
  whatsapp: MessageCircle,
  ads: Megaphone,
  integrations: Plug,
  billing: CreditCard,
};
