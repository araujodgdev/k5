export const appNavigation = [
  { slug: "command-center", label: "Central de comando", short: "Início" },
  { slug: "agents", label: "Agentes", short: "Agentes" },
  { slug: "spaces", label: "Espaços", short: "Espaços" },
  { slug: "vault", label: "Cofre", short: "Cofre" },
  { slug: "contract-intelligence", label: "Inteligência contratual", short: "Contratos" },
  { slug: "research", label: "Pesquisa", short: "Pesquisa" },
] as const;

export type NavSlug = (typeof appNavigation)[number]["slug"];

/** Sections shown directly in the mobile tab bar; the rest live under "Mais". */
export const mobileTabs: NavSlug[] = ["command-center", "agents", "vault", "research"];
