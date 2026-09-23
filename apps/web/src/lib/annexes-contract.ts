export const MAX_ANNEX_ITEMS = 60;
export const MAX_ANNEX_PAGES = 300;

export type AnnexItem = {
  label: string; startPage: number; endPage: number;
  /** Suggested for the upload: only documents the petition cites. */
  include: boolean; cited: boolean; mention: string | null; fileName: string;
};
