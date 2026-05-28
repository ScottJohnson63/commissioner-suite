'use client';

import Image from 'next/image';

export const SLEEPER_THUMB = (id: string) =>
  `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`;

export const PANEL_BG = { background: '#141415', border: '1px solid #1e1e20' } as const;
export const INNER_BG = { background: '#0e0e0f', border: '1px solid #1e1e20' } as const;

export function PlayerAvatar({
  playerId, name, size = 36,
}: { playerId: string; name: string | null; size?: number }) {
  const fontSize = size <= 24 ? '9px' : size <= 30 ? '10px' : '12px';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <Image
        src={SLEEPER_THUMB(playerId)}
        alt={name ?? playerId}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size, background: '#1e1e20' }}
        onError={(e) => {
          e.currentTarget.style.display = 'none';
          const sib = e.currentTarget.nextElementSibling as HTMLElement | null;
          if (sib) sib.style.display = 'flex';
        }}
      />
      <div
        className="rounded-full items-center justify-center font-medium"
        style={{
          display: 'none', width: size, height: size, background: '#1e1e20',
          color: '#555', position: 'absolute', top: 0, left: 0, fontSize,
        }}
      >
        {name ? name.charAt(0).toUpperCase() : '?'}
      </div>
    </div>
  );
}

export function PanelActionBtn({
  onClick, disabled, loading, label, loadingLabel,
}: {
  onClick: () => void; disabled: boolean; loading: boolean; label: string; loadingLabel: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="text-xs font-medium px-3 py-1.5 rounded transition-opacity disabled:opacity-40 shrink-0"
      style={{ background: '#80ff49', color: '#0e0e0f' }}
    >
      {loading ? loadingLabel : label}
    </button>
  );
}

export function PanelSkeleton({ rows = 3, height = 10 }: { rows?: number; height?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded animate-pulse" style={{ background: '#1e1e20', height }} />
      ))}
    </div>
  );
}

export function NoLeague() {
  return <p className="text-xs text-center py-6" style={{ color: '#444' }}>Select a league first</p>;
}
