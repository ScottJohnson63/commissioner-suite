'use client';

import type { SleeperUser } from '@/hooks/useSleeperData';
import { MatchupReportPanel } from './MatchupReportPanel';
import { WaiverSuggestionsPanel } from './WaiverSuggestionsPanel';
import { TradeAnalyzerPanel } from './TradeAnalyzerPanel';

const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export function LeagueTab({
  sleeperUser,
  activeLeagueId,
}: {
  sleeperUser: SleeperUser | null;
  activeLeagueId: string | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      {IS_DEMO && (
        <div className="rounded-lg px-4 py-3 flex items-center gap-3"
          style={{ background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.2)' }}>
          <span className="text-base shrink-0" style={{ color: '#facc15' }}>⚗</span>
          <div>
            <p className="text-xs font-semibold" style={{ color: '#facc15' }}>Demo Mode Active</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'rgba(250,204,21,0.5)' }}>
              Mock rosters · Real 2025 stats · Live odds from the current active sport · Set{' '}
              <code style={{ color: 'rgba(250,204,21,0.75)' }}>DEMO_MODE=false</code> in{' '}
              <code style={{ color: 'rgba(250,204,21,0.75)' }}>.env</code> to connect your Sleeper account
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <MatchupReportPanel
          leagueId={activeLeagueId}
          userId={sleeperUser?.userId ?? null}
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <WaiverSuggestionsPanel
            leagueId={activeLeagueId}
            userId={sleeperUser?.userId ?? null}
          />
          <TradeAnalyzerPanel
            leagueId={activeLeagueId}
            userId={sleeperUser?.userId ?? null}
          />
        </div>
      </div>
    </div>
  );
}
