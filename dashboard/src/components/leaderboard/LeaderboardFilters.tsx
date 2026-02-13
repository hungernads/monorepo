'use client';

import type { AgentClass } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentSortField =
  | 'winRate'
  | 'kills'
  | 'totalBattles'
  | 'prizes'
  | 'streak'
  | 'avgSurvival';

export type BettorSortField =
  | 'profit'
  | 'win_rate'
  | 'total_wagered'
  | 'total_bets'
  | 'wins';

interface LeaderboardFiltersProps {
  tab: 'agents' | 'bettors';
  search: string;
  onSearchChange: (value: string) => void;
  classFilter: AgentClass | 'ALL';
  onClassFilterChange: (value: AgentClass | 'ALL') => void;
  sortField: AgentSortField | BettorSortField;
  onSortFieldChange: (value: AgentSortField | BettorSortField) => void;
  isWalletMode?: boolean; // Flag to indicate if showing wallet-aggregated data
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_CLASSES: (AgentClass | 'ALL')[] = [
  'ALL',
  'WARRIOR',
  'TRADER',
  'SURVIVOR',
  'PARASITE',
  'GAMBLER',
];

const CLASS_COLORS: Record<AgentClass | 'ALL', string> = {
  ALL: 'border-gold/40 text-gold bg-gold/10 hover:bg-gold/20',
  WARRIOR: 'border-blood/40 text-blood bg-blood/10 hover:bg-blood/20',
  TRADER: 'border-blue-500/40 text-blue-400 bg-blue-500/10 hover:bg-blue-500/20',
  SURVIVOR:
    'border-green-500/40 text-green-400 bg-green-500/10 hover:bg-green-500/20',
  PARASITE:
    'border-accent/40 text-accent-light bg-accent/10 hover:bg-accent/20',
  GAMBLER: 'border-gold/40 text-gold bg-gold/10 hover:bg-gold/20',
};

const CLASS_ACTIVE: Record<AgentClass | 'ALL', string> = {
  ALL: 'border-gold text-gold bg-gold/25',
  WARRIOR: 'border-blood text-blood bg-blood/25',
  TRADER: 'border-blue-500 text-blue-400 bg-blue-500/25',
  SURVIVOR: 'border-green-500 text-green-400 bg-green-500/25',
  PARASITE: 'border-accent text-accent-light bg-accent/25',
  GAMBLER: 'border-gold text-gold bg-gold/25',
};

const AGENT_SORT_OPTIONS: { value: AgentSortField; label: string }[] = [
  { value: 'winRate', label: 'Win Rate' },
  { value: 'kills', label: 'Kills' },
  { value: 'prizes', label: 'Prizes' },
  { value: 'totalBattles', label: 'Battles' },
  { value: 'streak', label: 'Streak' },
  { value: 'avgSurvival', label: 'Survival' },
];

const BETTOR_SORT_OPTIONS: { value: BettorSortField; label: string }[] = [
  { value: 'profit', label: 'Profit' },
  { value: 'win_rate', label: 'Win Rate' },
  { value: 'total_wagered', label: 'Wagered' },
  { value: 'total_bets', label: 'Total Bets' },
  { value: 'wins', label: 'Wins' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LeaderboardFilters({
  tab,
  search,
  onSearchChange,
  classFilter,
  onClassFilterChange,
  sortField,
  onSortFieldChange,
  isWalletMode = false,
}: LeaderboardFiltersProps) {
  const sortOptions =
    tab === 'agents' ? AGENT_SORT_OPTIONS : BETTOR_SORT_OPTIONS;

  // Dynamic search placeholder based on mode
  const searchPlaceholder = tab === 'bettors'
    ? 'Search by address...'
    : isWalletMode
      ? 'Search by address...'
      : 'Search by agent name or class...';

  return (
    <div className="space-y-3">
      {/* Search + Sort row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search */}
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-lg border border-colosseum-surface-light bg-colosseum-bg py-2 pl-10 pr-4 text-sm text-gray-200 placeholder-gray-600 outline-none transition-colors focus:border-gold/40 focus:ring-1 focus:ring-gold/20"
          />
        </div>

        {/* Sort dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-600">
            Sort
          </span>
          <select
            value={sortField}
            onChange={(e) =>
              onSortFieldChange(
                e.target.value as AgentSortField | BettorSortField,
              )
            }
            className="rounded-lg border border-colosseum-surface-light bg-colosseum-bg px-3 py-2 text-sm text-gray-300 outline-none transition-colors focus:border-gold/40"
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Class filter (agents only) */}
      {tab === 'agents' && (
        <div className="flex flex-wrap gap-2">
          {AGENT_CLASSES.map((cls) => (
            <button
              key={cls}
              onClick={() => onClassFilterChange(cls)}
              className={`rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all sm:py-1 ${
                classFilter === cls
                  ? CLASS_ACTIVE[cls]
                  : CLASS_COLORS[cls]
              }`}
            >
              {cls === 'ALL' ? 'All Classes' : cls}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
