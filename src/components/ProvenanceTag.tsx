import type { DataProvenance } from '../types/mars';

interface ProvenanceTagProps {
  type: DataProvenance;
  detail?: string;
}

export function ProvenanceTag({ type, detail }: ProvenanceTagProps) {
  const colorClass =
    type === 'ACTUAL NASA OBSERVATION'
      ? 'text-emerald-400'
      : type === 'PUBLISHED SCIENTIFIC DATASET'
        ? 'text-cyan-400'
        : type === 'DERIVED CALCULATION'
          ? 'text-amber-400'
          : 'text-orange-400';

  const glyph =
    type === 'ACTUAL NASA OBSERVATION'
      ? '●'
      : type === 'PUBLISHED SCIENTIFIC DATASET'
        ? '◆'
        : type === 'DERIVED CALCULATION'
          ? '▲'
          : '◇';

  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-mono tracking-wider uppercase max-w-full">
      <span className={colorClass} aria-hidden="true">
        {glyph}
      </span>
      <span className={colorClass}>{type}</span>
      {detail && (
        <>
          <span className="text-slate-600" aria-hidden="true">
            ·
          </span>
          <span className="text-slate-400 normal-case tracking-normal">{detail}</span>
        </>
      )}
    </span>
  );
}
