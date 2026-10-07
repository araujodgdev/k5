export const MAX_ANNEX_ITEMS = 60;
export const MAX_ANNEX_PAGES = 300;

export function annexFileName(position: number, label: string) {
  const base = label.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60).replace(/_+$/, '');
  return `${String(position).padStart(2, '0')}_${base || 'documento'}.pdf`;
}

export type AnnexItem = {
  label: string; startPage: number; endPage: number;
  /** Suggested for the upload: only documents the petition cites. */
  include: boolean; cited: boolean; mention: string | null; fileName: string;
};
