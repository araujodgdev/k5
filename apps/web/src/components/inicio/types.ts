/** A case card of Início: the newest cases, their summary and the people on them, owner first. */
export type RecentCase = { id: string; name: string; summary: string | null; updatedAt: string; people: string[] };
export type OfficeCases = { recent: RecentCase[]; names: Record<string, string> };
/** One thing the Lume did for the person, already in words. */
export type LumeWork = { id: string; text: string; at: string };
