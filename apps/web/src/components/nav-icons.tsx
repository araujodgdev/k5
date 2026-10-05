import { Calculator, CalendarDays, CreditCard, FolderLock, House, Mail, Megaphone, MessageCircle, MessagesSquare, Plug, Search, Wallet } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { LumeMark } from "./lume-mark";
import type { NavSlug } from "@/lib/navigation";

/** Module colour for the icon; neutral sections stay ink. See DESIGN.md, "Cor e módulos". */
export const navTone: Record<NavSlug, string> = {
  "command-center": "", agents: "text-module-lume", vault: "text-module-vault", research: "text-module-research",
  agenda: "text-module-agenda", honorarios: "", calc: "", email: "", messages: "", whatsapp: "", ads: "", integrations: "", billing: "",
};

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
