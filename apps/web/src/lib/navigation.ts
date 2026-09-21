export const appNavigation = [
  { slug: "command-center", label: "Início", short: "Início" },
  { slug: "agents", label: "Agentes", short: "Agentes" },
  { slug: "vault", label: "Cofre", short: "Cofre" },
  { slug: "research", label: "Pesquisa", short: "Pesquisa" },
] as const;

export type NavSlug = (typeof appNavigation)[number]["slug"];

/** Sections shown directly in the mobile tab bar; the rest live under "Mais". */
export const mobileTabs: NavSlug[] = ["command-center", "agents", "vault", "research"];
