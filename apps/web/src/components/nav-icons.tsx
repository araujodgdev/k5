import { Bell, FolderLock, House, CalendarDays, MessageSquareText } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { AgentMark } from "./agent-mark";
import type { NavSlug } from "@/lib/navigation";

export const navIcons: Record<NavSlug, ComponentType<SVGProps<SVGSVGElement>>> = {
  feedback: MessageSquareText,
  "command-center": House,
  agents: AgentMark,
  vault: FolderLock,
  agenda: CalendarDays,
  notifications: Bell,
};
