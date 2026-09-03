'use client';

import type { SleeperUser } from '@/hooks/useSleeperData';
import { MatchupReportPanel } from './MatchupReportPanel';
import { WaiverSuggestionsPanel } from './WaiverSuggestionsPanel';
import { TradeAnalyzerPanel } from './TradeAnalyzerPanel';

export function LeagueTab({
  sleeperUser,
  activeLeagueId,
}: {
  sleeperUser: SleeperUser | null;
  activeLeagueId: string | null;
}) {
  return (
    <div className="flex flex-col gap-6">
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
