interface Props {
  total: number;
  division: number;
  cross: number;
  generatedAt: string;
}

export function StatCards({ total, division, cross, generatedAt }: Props) {
  const formatted = new Date(generatedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: 'Total matchups', value: total,     sub: '13 per team' },
        { label: 'Division games', value: division,  sub: '8 per team' },
        { label: 'Cross-division', value: cross,     sub: '5 per team' },
        { label: 'Generated',      value: formatted, sub: 'last run', isText: true },
      ].map(({ label, value, sub, isText }) => (
        <div key={label} className="bg-[#141415] border border-[#2a2a2c] rounded-lg p-4">
          <p className="text-[10px] uppercase tracking-widest mb-2">{label}</p>
          <p className={`font-medium text-[#e8e6df] ${isText ? 'text-sm' : 'text-2xl'}`}>
            {value}
          </p>
          <p className="text-[11px] mt-1">{sub}</p>
        </div>
      ))}
    </div>
  );
}
