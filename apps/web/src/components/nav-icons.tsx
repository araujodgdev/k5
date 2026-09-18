import { Blocks, Bot, Command, FileSearch, FolderLock, Search, type LucideIcon } from "lucide-react";
import type { NavSlug } from "@/lib/navigation";

export const navIcons: Record<NavSlug, LucideIcon> = {
  "command-center": Command,
  agents: Bot,
  spaces: Blocks,
  vault: FolderLock,
  "contract-intelligence": FileSearch,
  research: Search,
};
