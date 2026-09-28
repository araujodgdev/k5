export const appNavigation = [
  { slug: "command-center", label: "Início", short: "Início" },
  { slug: "agents", label: "Lume", short: "Lume" },
  { slug: "vault", label: "Cofre", short: "Cofre" },
  { slug: "research", label: "Pesquisa", short: "Pesquisa" },
  { slug: "agenda", label: "Escritório", short: "Escritório" },
  { slug: "honorarios", label: "Honorários", short: "Honorários" },
  { slug: "email", label: "E-mails", short: "E-mails" },
  { slug: "messages", label: "Mensagens", short: "Mensagens" },
  { slug: "whatsapp", label: "WhatsApp", short: "WhatsApp" },
  { slug: "integrations", label: "Integrações", short: "Integrações" },
  { slug: "billing", label: "Plano", short: "Plano" },
] as const;

export type NavSlug = (typeof appNavigation)[number]["slug"];

export const officeSections = [
  { slug: 'tasks', label: 'Tarefas' }, { slug: 'calendar', label: 'Agenda' }, { slug: 'clients', label: 'Clientes' },
  { slug: 'team', label: 'Equipe' }, { slug: 'associates', label: 'Associados' }, { slug: 'invites', label: 'Convites' },
] as const;

/** Sections shown directly in the mobile tab bar; the rest live under "Mais". */
export const mobileTabs: NavSlug[] = ["command-center", "agents", "vault", "agenda"];

/** Shown only to platform administrators, after the office's sections, on desktop and in "Mais". */
export const adminNavigation = { href: "/app/admin", label: "Administração", short: "Admin" } as const;

/** Tabs inside the Administração module. */
export const adminSections = [
  { slug: "feedback", label: "Feedback" },
  { slug: "clients", label: "Clientes" },
  { slug: "finance", label: "Financeiro" },
  { slug: "ai", label: "IA" },
  { slug: "traces", label: "Execuções" },
  { slug: "credentials", label: "Credenciais" },
] as const;
