// src/lib/nflStats.ts
//
// The catalog of rankable NflWeeklyStat columns — every numeric stat nflverse
// publishes, which is what the Statistics tab ranks players by.
//
// This is deliberately one list rather than two. The API needs it as a security
// allowlist (the column name is interpolated into raw SQL, so it can never come
// from user input) and the UI needs it for the dropdown. Keeping them as
// separate hand-maintained arrays meant a stat added to one and not the other
// either vanished from the menu or 400'd when picked.
//
// Identity columns, the season/week keys, and the semicolon-joined FG distance
// lists are excluded: none of them are meaningful to rank by.

export interface StatCategory {
  /** NflWeeklyStat column name. Safe to interpolate — it comes from this file. */
  key: string;
  label: string;
  /** Suffix shown after the value, e.g. "yds". Empty for a bare count. */
  unit: string;
  decimals: number;
  group: string;
}

export const STAT_CATEGORIES: StatCategory[] = [
  // ── Fantasy ─────────────────────────────────────────────────────
  { key: 'fantasyPoints',    label: 'Fantasy Points (STD)', unit: 'pts',  decimals: 1, group: 'Fantasy' },
  { key: 'fantasyPointsPpr', label: 'Fantasy Points (PPR)', unit: 'pts',  decimals: 1, group: 'Fantasy' },

  // ── Passing ─────────────────────────────────────────────────────
  { key: 'attempts',               label: 'Pass Attempts',           unit: '',     decimals: 0, group: 'Passing' },
  { key: 'completions',            label: 'Completions',             unit: '',     decimals: 0, group: 'Passing' },
  { key: 'pacr',                   label: 'PACR',                    unit: '',     decimals: 2, group: 'Passing' },
  { key: 'passing10',              label: 'Passing 10',              unit: '',     decimals: 0, group: 'Passing' },
  { key: 'passing16',              label: 'Passing 16',              unit: '',     decimals: 0, group: 'Passing' },
  { key: 'passing20',              label: 'Passing 20',              unit: '',     decimals: 0, group: 'Passing' },
  { key: 'passing2ptConversions',  label: 'Passing 2PT Conversions', unit: '',     decimals: 0, group: 'Passing' },
  { key: 'passing40',              label: 'Passing 40',              unit: '',     decimals: 0, group: 'Passing' },
  { key: 'passingAirYards',        label: 'Air Yards',               unit: 'yds',  decimals: 0, group: 'Passing' },
  { key: 'passingCpoe',            label: 'CPOE',                    unit: '%',    decimals: 1, group: 'Passing' },
  { key: 'passingEpa',             label: 'Passing EPA',             unit: '',     decimals: 1, group: 'Passing' },
  { key: 'passingFirstDowns',      label: 'Pass 1st Downs',          unit: '',     decimals: 0, group: 'Passing' },
  { key: 'passingInterceptions',   label: 'Interceptions',           unit: '',     decimals: 0, group: 'Passing' },
  { key: 'passingTds',             label: 'Passing TDs',             unit: 'TD',   decimals: 0, group: 'Passing' },
  { key: 'passingYards',           label: 'Passing Yards',           unit: 'yds',  decimals: 0, group: 'Passing' },
  { key: 'passingYardsAfterCatch', label: 'YAC',                     unit: 'yds',  decimals: 0, group: 'Passing' },
  { key: 'sackFumbles',            label: 'Sack Fumbles',            unit: '',     decimals: 0, group: 'Passing' },
  { key: 'sackFumblesLost',        label: 'Sack Fumbles Lost',       unit: '',     decimals: 0, group: 'Passing' },
  { key: 'sackYardsLost',          label: 'Sack Yards Lost',         unit: 'yds',  decimals: 0, group: 'Passing' },
  { key: 'sacksSuffered',          label: 'Sacks Taken',             unit: '',     decimals: 0, group: 'Passing' },

  // ── Rushing ─────────────────────────────────────────────────────
  { key: 'carries',               label: 'Carries',                 unit: '',     decimals: 0, group: 'Rushing' },
  { key: 'rushing10',             label: 'Rushing 10',              unit: '',     decimals: 0, group: 'Rushing' },
  { key: 'rushing12',             label: 'Rushing 12',              unit: '',     decimals: 0, group: 'Rushing' },
  { key: 'rushing20',             label: 'Rushing 20',              unit: '',     decimals: 0, group: 'Rushing' },
  { key: 'rushing2ptConversions', label: 'Rushing 2PT Conversions', unit: '',     decimals: 0, group: 'Rushing' },
  { key: 'rushing40',             label: 'Rushing 40',              unit: '',     decimals: 0, group: 'Rushing' },
  { key: 'rushingEpa',            label: 'Rushing EPA',             unit: '',     decimals: 1, group: 'Rushing' },
  { key: 'rushingFirstDowns',     label: 'Rush 1st Downs',          unit: '',     decimals: 0, group: 'Rushing' },
  { key: 'rushingFumbles',        label: 'Rushing Fumbles',         unit: '',     decimals: 0, group: 'Rushing' },
  { key: 'rushingFumblesLost',    label: 'Rushing Fumbles Lost',    unit: '',     decimals: 0, group: 'Rushing' },
  { key: 'rushingTds',            label: 'Rushing TDs',             unit: 'TD',   decimals: 0, group: 'Rushing' },
  { key: 'rushingYards',          label: 'Rushing Yards',           unit: 'yds',  decimals: 0, group: 'Rushing' },

  // ── Receiving ───────────────────────────────────────────────────
  { key: 'airYardsShare',            label: 'Air Yards Share',           unit: '%',    decimals: 1, group: 'Receiving' },
  { key: 'racr',                     label: 'RACR',                      unit: '',     decimals: 2, group: 'Receiving' },
  { key: 'receiving10',              label: 'Receiving 10',              unit: '',     decimals: 0, group: 'Receiving' },
  { key: 'receiving16',              label: 'Receiving 16',              unit: '',     decimals: 0, group: 'Receiving' },
  { key: 'receiving20',              label: 'Receiving 20',              unit: '',     decimals: 0, group: 'Receiving' },
  { key: 'receiving2ptConversions',  label: 'Receiving 2PT Conversions', unit: '',     decimals: 0, group: 'Receiving' },
  { key: 'receiving40',              label: 'Receiving 40',              unit: '',     decimals: 0, group: 'Receiving' },
  { key: 'receivingAirYards',        label: 'Air Yards',                 unit: 'yds',  decimals: 0, group: 'Receiving' },
  { key: 'receivingEpa',             label: 'Rec EPA',                   unit: '',     decimals: 1, group: 'Receiving' },
  { key: 'receivingFirstDowns',      label: 'Rec 1st Downs',             unit: '',     decimals: 0, group: 'Receiving' },
  { key: 'receivingFumbles',         label: 'Receiving Fumbles',         unit: '',     decimals: 0, group: 'Receiving' },
  { key: 'receivingFumblesLost',     label: 'Receiving Fumbles Lost',    unit: '',     decimals: 0, group: 'Receiving' },
  { key: 'receivingTds',             label: 'Receiving TDs',             unit: 'TD',   decimals: 0, group: 'Receiving' },
  { key: 'receivingYards',           label: 'Receiving Yards',           unit: 'yds',  decimals: 0, group: 'Receiving' },
  { key: 'receivingYardsAfterCatch', label: 'YAC',                       unit: 'yds',  decimals: 0, group: 'Receiving' },
  { key: 'receptions',               label: 'Receptions',                unit: '',     decimals: 0, group: 'Receiving' },
  { key: 'targetShare',              label: 'Target Share',              unit: '%',    decimals: 1, group: 'Receiving' },
  { key: 'targets',                  label: 'Targets',                   unit: '',     decimals: 0, group: 'Receiving' },
  { key: 'wopr',                     label: 'WOPR',                      unit: '',     decimals: 2, group: 'Receiving' },

  // ── Defense ─────────────────────────────────────────────────────
  { key: 'def2ptAtts',             label: 'Def 2PT Attempts',           unit: '',     decimals: 0, group: 'Defense' },
  { key: 'def2ptMade',             label: 'Def 2PT Made',               unit: '',     decimals: 0, group: 'Defense' },
  { key: 'defFgBlocks',            label: 'Def FG Blocks',              unit: '',     decimals: 0, group: 'Defense' },
  { key: 'defFumbles',             label: 'Def Fumbles',                unit: '',     decimals: 0, group: 'Defense' },
  { key: 'defFumblesForced',       label: 'Forced Fumbles',             unit: '',     decimals: 0, group: 'Defense' },
  { key: 'defInterceptionYards',   label: 'Def Interception Yards',     unit: 'yds',  decimals: 0, group: 'Defense' },
  { key: 'defInterceptions',       label: 'INTs',                       unit: '',     decimals: 0, group: 'Defense' },
  { key: 'defPassDefended',        label: 'Pass Breakups',              unit: '',     decimals: 0, group: 'Defense' },
  { key: 'defPatBlocks',           label: 'Def PAT Blocks',             unit: '',     decimals: 0, group: 'Defense' },
  { key: 'defPuntBlocks',          label: 'Def Punt Blocks',            unit: '',     decimals: 0, group: 'Defense' },
  { key: 'defQbHits',              label: 'QB Hits',                    unit: '',     decimals: 0, group: 'Defense' },
  { key: 'defSackYards',           label: 'Def Sack Yards',             unit: 'yds',  decimals: 0, group: 'Defense' },
  { key: 'defSacks',               label: 'Sacks',                      unit: '',     decimals: 1, group: 'Defense' },
  { key: 'defSafeties',            label: 'Def Safeties',               unit: '',     decimals: 0, group: 'Defense' },
  { key: 'defTackleAssists',       label: 'Def Tackle Assists',         unit: '',     decimals: 0, group: 'Defense' },
  { key: 'defTacklesForLoss',      label: 'TFL',                        unit: '',     decimals: 1, group: 'Defense' },
  { key: 'defTacklesForLossYards', label: 'Def Tackles For Loss Yards', unit: 'yds',  decimals: 0, group: 'Defense' },
  { key: 'defTacklesSolo',         label: 'Solo Tackles',               unit: '',     decimals: 0, group: 'Defense' },
  { key: 'defTacklesWithAssist',   label: 'Def Tackles With Assist',    unit: '',     decimals: 0, group: 'Defense' },
  { key: 'defTds',                 label: 'Def TDs',                    unit: 'TD',   decimals: 0, group: 'Defense' },

  // ── Kicking ─────────────────────────────────────────────────────
  { key: 'fgAtt',             label: 'FG Attempts',         unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgBlocked',         label: 'FG Blocked',          unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgBlockedDistance', label: 'FG Blocked Distance', unit: 'yds',  decimals: 0, group: 'Kicking' },
  { key: 'fgLong',            label: 'FG Long',             unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgMade',            label: 'FG Made',             unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgMade0To19',       label: 'FG Made 0–19',        unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgMade20To29',      label: 'FG Made 20–29',       unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgMade30To39',      label: 'FG Made 30–39',       unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgMade40To49',      label: 'FG Made 40–49',       unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgMade50To59',      label: 'FG Made 50–59',       unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgMade60Plus',      label: 'FG Made 60 Plus',     unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgMadeDistance',    label: 'FG Made Distance',    unit: 'yds',  decimals: 0, group: 'Kicking' },
  { key: 'fgMissed',          label: 'FG Missed',           unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgMissed0To19',     label: 'FG Missed 0–19',      unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgMissed20To29',    label: 'FG Missed 20–29',     unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgMissed30To39',    label: 'FG Missed 30–39',     unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgMissed40To49',    label: 'FG Missed 40–49',     unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgMissed50To59',    label: 'FG Missed 50–59',     unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgMissed60Plus',    label: 'FG Missed 60 Plus',   unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'fgMissedDistance',  label: 'FG Missed Distance',  unit: 'yds',  decimals: 0, group: 'Kicking' },
  { key: 'fgPct',             label: 'FG %',                unit: '%',    decimals: 2, group: 'Kicking' },
  { key: 'gwfgAtt',           label: 'GW FG Attempts',      unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'gwfgBlocked',       label: 'GW FG Blocked',       unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'gwfgDistance',      label: 'GW FG Distance',      unit: 'yds',  decimals: 0, group: 'Kicking' },
  { key: 'gwfgMade',          label: 'GW FG Made',          unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'gwfgMissed',        label: 'GW FG Missed',        unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'patAtt',            label: 'PAT Attempts',        unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'patBlocked',        label: 'PAT Blocked',         unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'patMade',           label: 'PAT Made',            unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'patMissed',         label: 'PAT Missed',          unit: '',     decimals: 0, group: 'Kicking' },
  { key: 'patPct',            label: 'PAT %',               unit: '%',    decimals: 2, group: 'Kicking' },

  // ── Punting ─────────────────────────────────────────────────────
  { key: 'ptAtt',         label: 'Punt Attempts',      unit: '',     decimals: 0, group: 'Punting' },
  { key: 'ptBlocked',     label: 'Punt Blocked',       unit: '',     decimals: 0, group: 'Punting' },
  { key: 'ptDowned',      label: 'Punt Downed',        unit: '',     decimals: 0, group: 'Punting' },
  { key: 'ptFairCaught',  label: 'Punt Fair Caught',   unit: '',     decimals: 0, group: 'Punting' },
  { key: 'ptInside20',    label: 'Punt Inside 20',     unit: '',     decimals: 0, group: 'Punting' },
  { key: 'ptLong',        label: 'Punt Long',          unit: '',     decimals: 0, group: 'Punting' },
  { key: 'ptNetYards',    label: 'Punt Net Yards',     unit: 'yds',  decimals: 0, group: 'Punting' },
  { key: 'ptOutOfBounds', label: 'Punt Out Of Bounds', unit: '',     decimals: 0, group: 'Punting' },
  { key: 'ptReturnTds',   label: 'Punt Return TDs',    unit: 'TD',   decimals: 0, group: 'Punting' },
  { key: 'ptReturnYards', label: 'Punt Return Yards',  unit: 'yds',  decimals: 0, group: 'Punting' },
  { key: 'ptReturned',    label: 'Punt Returned',      unit: '',     decimals: 0, group: 'Punting' },
  { key: 'ptTouchback',   label: 'Punt Touchback',     unit: '',     decimals: 0, group: 'Punting' },
  { key: 'ptYards',       label: 'Punt Yards',         unit: 'yds',  decimals: 0, group: 'Punting' },

  // ── Returns ─────────────────────────────────────────────────────
  { key: 'kickoffReturnYards', label: 'Kickoff Return Yards', unit: 'yds',  decimals: 0, group: 'Returns' },
  { key: 'kickoffReturns',     label: 'Kickoff Returns',      unit: '',     decimals: 0, group: 'Returns' },
  { key: 'puntReturnYards',    label: 'Punt Return Yards',    unit: 'yds',  decimals: 0, group: 'Returns' },
  { key: 'puntReturns',        label: 'Punt Returns',         unit: '',     decimals: 0, group: 'Returns' },
  { key: 'specialTeamsTds',    label: 'Special Teams TDs',    unit: 'TD',   decimals: 0, group: 'Returns' },

  // ── Misc ────────────────────────────────────────────────────────
  { key: 'fumbleRecoveryOpp',      label: 'Fumble Recovery Opponent',       unit: '',     decimals: 0, group: 'Misc' },
  { key: 'fumbleRecoveryOwn',      label: 'Fumble Recovery Own',            unit: '',     decimals: 0, group: 'Misc' },
  { key: 'fumbleRecoveryTds',      label: 'Fumble Recovery TDs',            unit: 'TD',   decimals: 0, group: 'Misc' },
  { key: 'fumbleRecoveryYardsOpp', label: 'Fumble Recovery Yards Opponent', unit: 'yds',  decimals: 0, group: 'Misc' },
  { key: 'fumbleRecoveryYardsOwn', label: 'Fumble Recovery Yards Own',      unit: 'yds',  decimals: 0, group: 'Misc' },
  { key: 'fumblesForcedByOpp',     label: 'Fumbles Forced By Opponent',     unit: '',     decimals: 0, group: 'Misc' },
  { key: 'fumblesLostTotal',       label: 'Fumbles Lost Total',             unit: '',     decimals: 0, group: 'Misc' },
  { key: 'fumblesNotForced',       label: 'Fumbles Not Forced',             unit: '',     decimals: 0, group: 'Misc' },
  { key: 'fumblesOutOfBounds',     label: 'Fumbles Out Of Bounds',          unit: '',     decimals: 0, group: 'Misc' },
  { key: 'fumblesTotal',           label: 'Fumbles Total',                  unit: '',     decimals: 0, group: 'Misc' },
  { key: 'miscYards',              label: 'Misc Yards',                     unit: 'yds',  decimals: 0, group: 'Misc' },
  { key: 'penalties',              label: 'Penalties',                      unit: '',     decimals: 0, group: 'Misc' },
  { key: 'penaltyYards',           label: 'Penalty Yards',                  unit: 'yds',  decimals: 0, group: 'Misc' },
];

/** Distinct groups, in the order the dropdown should show them. */
export const STAT_GROUPS: string[] = [...new Set(STAT_CATEGORIES.map((c) => c.group))];

/** Guards the raw-SQL column interpolation in /api/nfl/leaders. */
export const ALLOWED_STAT_COLS: ReadonlySet<string> = new Set(
  STAT_CATEGORIES.map((c) => c.key),
);
