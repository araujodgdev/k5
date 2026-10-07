import { sectionTab, sectionTabRow } from '@/components/section-tabs';

/** The saved versions of a calculation or a proposal as section tabs, newest first. */
export function VersionTabs({ label, latest, current, onSelect }: {
  label: string;
  latest: number;
  current: number;
  onSelect: (version: number) => void;
}) {
  const versions = Array.from({ length: latest }, (_, index) => latest - index);
  return (
    <div role="tablist" aria-label={label} className={sectionTabRow}>
      {versions.map(version => (
        <button key={version} type="button" role="tab" aria-selected={version === current} className={sectionTab(version === current)}
          onClick={() => { if (version !== current) onSelect(version); }}>
          Versão {version}
        </button>
      ))}
    </div>
  );
}
