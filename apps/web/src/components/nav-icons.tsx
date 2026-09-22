import { Bell, Bot, FolderLock, House, CalendarDays, MessageSquareText, type LucideIcon } from "lucide-react";
import type { NavSlug } from "@/lib/navigation";

export const navIcons: Record<NavSlug, LucideIcon> = {
  feedback: MessageSquareText,
  "command-center": House,
  agents: Bot,
  vault: FolderLock,
  agenda: CalendarDays,
  notifications: Bell,
};
