import { Bot, FolderLock, House, Search, type LucideIcon } from "lucide-react";
import type { NavSlug } from "@/lib/navigation";

export const navIcons: Record<NavSlug, LucideIcon> = {
  "command-center": House,
  agents: Bot,
  vault: FolderLock,
  research: Search,
};
