import { Bell, FolderLock, House, CalendarDays, Mail, Plug, Search } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { LumeMark } from "./lume-mark";
import type { NavSlug } from "@/lib/navigation";

/** Module colour for the icon; neutral sections stay ink. See DESIGN.md, "Cor e módulos". */
export const navTone: Record<NavSlug, string> = {
  "command-center": "", agents: "text-module-lume", vault: "text-module-vault", research: "text-module-research",
  agenda: "text-module-agenda", email: "", notifications: "", integrations: "",
};

export const navIcons: Record<NavSlug, ComponentType<SVGProps<SVGSVGElement>>> = {
  "command-center": House,
  agents: LumeMark,
  vault: FolderLock,
  research: Search,
  agenda: CalendarDays,
  email: Mail,
  notifications: Bell,
  integrations: Plug,
};
