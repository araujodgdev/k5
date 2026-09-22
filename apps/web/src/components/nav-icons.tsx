import { Bell, FolderLock, House, CalendarDays, MessageSquareText } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { LumeMark } from "./lume-mark";
import type { NavSlug } from "@/lib/navigation";

export const navIcons: Record<NavSlug, ComponentType<SVGProps<SVGSVGElement>>> = {
  feedback: MessageSquareText,
  "command-center": House,
  agents: LumeMark,
  vault: FolderLock,
  agenda: CalendarDays,
  notifications: Bell,
};
