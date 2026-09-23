export const appNavigation = [
  { slug: "command-center", label: "Início", short: "Início" },
  { slug: "agents", label: "Lume", short: "Lume" },
  { slug: "vault", label: "Cofre", short: "Cofre" },
  { slug: "research", label: "Pesquisa", short: "Pesquisa" },
  { slug: "agenda", label: "Tarefas e Agenda", short: "Agenda" },
  { slug: "email", label: "E-mails", short: "E-mails" },
  { slug: "notifications", label: "Notificações", short: "Avisos" },
  { slug: "integrations", label: "Integrações", short: "Integrações" },
  { slug: "feedback", label: "Feedback", short: "Feedback" },
] as const;

export type NavSlug = (typeof appNavigation)[number]["slug"];

/** Sections shown directly in the mobile tab bar; the rest live under "Mais". */
export const mobileTabs: NavSlug[] = ["command-center", "agents", "vault", "agenda"];
