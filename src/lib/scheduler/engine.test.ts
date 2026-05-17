// src/lib/scheduler/engine.test.ts
import { generateSchedule } from './engine';
import { Team } from './types';

const teams: Team[] = [
  { id: '1', name: 'Team A1', divisionId: 0 },
  { id: '2', name: 'Team A2', divisionId: 0 },
  { id: '3', name: 'Team A3', divisionId: 0 },
  { id: '4', name: 'Team A4', divisionId: 0 },
  { id: '5', name: 'Team A5', divisionId: 0 },
  { id: '6', name: 'Team B1', divisionId: 1 },
  { id: '7', name: 'Team B2', divisionId: 1 },
  { id: '8', name: 'Team B3', divisionId: 1 },
  { id: '9', name: 'Team B4', divisionId: 1 },
  { id: '10', name: 'Team B5', divisionId: 1 },
];

const schedule = generateSchedule('test-league', 2025, teams);
console.log(`Generated ${schedule.weeks.length} weeks`);
schedule.weeks.forEach((w) => {
  console.log(`Week ${w.week}: ${w.matchups.map(m => `${m.home} vs ${m.away}`).join(' | ')}`);
});