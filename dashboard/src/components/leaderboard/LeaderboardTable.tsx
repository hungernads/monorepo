'use client';

import { useState, useMemo } from 'react';
import type { AgentClass } from '@/types';
import AgentRow from './AgentRow';
import type { AgentLeaderboardEntry, WalletLeaderboardEntry } from './AgentRow';
import BettorRow from './BettorRow';
import type { BettorLeaderboardEntry } from './BettorRow';
import LeaderboardFilters from './LeaderboardFilters';
import type { AgentSortField, BettorSortField } from './LeaderboardFilters';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeaderboardTableProps {
  agents: (AgentLeaderboardEntry | WalletLeaderboardEntry)[];
  bettors: BettorLeaderboardEntry[];
  agentsLoading: boolean;
  bettorsLoading: boolean;
  isWalletMode?: boolean; // True if showing wallet-aggregated data
}

type Tab = 'agents' | 'bettors';

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Sorting helpers
// ---------------------------------------------------------------------------

function sortAgents(
  entries: (AgentLeaderboardEntry | WalletLeaderboardEntry)[],
  field: AgentSortField,
): (AgentLeaderboardEntry | WalletLeaderboardEntry)[] {
  return [...entries].sort((a, b) => {
    // Handle both wallet and agent entries
    const isWalletA = 'wallet_address' in a;
    const isWalletB = 'wallet_address' in b;

    switch (field) {
      case 'winRate':
        const winRateA = isWalletA ? a.win_rate : a.winRate;
        const winRateB = isWalletB ? b.win_rate : b.winRate;
        return winRateB - winRateA;
      case 'kills':
        return b.kills - a.kills;
      case 'totalBattles':
        const battlesA = isWalletA ? a.total_battles : a.totalBattles;
        const battlesB = isWalletB ? b.total_battles : b.totalBattles;
        return battlesB - battlesA;
      case 'prizes':
        // Prizes only exist for wallet entries
        if (isWalletA && isWalletB) {
          return parseInt(b.prize_won_mon) - parseInt(a.prize_won_mon);
        }
        return 0;
      case 'streak':
        // Streak only exists for agent entries
        if (!isWalletA && !isWalletB) {
          return b.streak - a.streak;
        }
        return 0;
      case 'avgSurvival':
        // Avg survival only exists for agent entries
        if (!isWalletA && !isWalletB) {
          return b.avgSurvival - a.avgSurvival;
        }
        return 0;
      default:
        return 0;
    }
  });
}

function sortBettors(
  entries: BettorLeaderboardEntry[],
  field: BettorSortField,
): BettorLeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    switch (field) {
      case 'profit':
        return b.profit - a.profit;
      case 'win_rate':
        return b.win_rate - a.win_rate;
      case 'total_wagered':
        return b.total_wagered - a.total_wagered;
      case 'total_bets':
        return b.total_bets - a.total_bets;
      case 'wins':
        return b.wins - a.wins;
      default:
        return 0;
    }
  });
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function RowSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-3 rounded border border-colosseum-surface-light bg-colosseum-bg/50 px-3 py-2.5">
      <div className="h-4 w-7 rounded bg-colosseum-surface-light" />
      <div className="h-4 w-6 rounded bg-colosseum-surface-light" />
      <div className="h-4 flex-1 rounded bg-colosseum-surface-light/50" />
      <div className="hidden h-4 w-28 rounded bg-colosseum-surface-light/30 sm:block" />
      <div className="hidden h-8 w-36 rounded bg-colosseum-surface-light/20 md:block" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems: number;
}

function Pagination({ page, totalPages, onPageChange, totalItems }: PaginationProps) {
  if (totalPages <= 1) return null;

  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, totalItems);

  // Generate visible page numbers
  const pages: (number | 'ellipsis')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('ellipsis');
    for (
      let i = Math.max(2, page - 1);
      i <= Math.min(totalPages - 1, page + 1);
      i++
    ) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push('ellipsis');
    pages.push(totalPages);
  }

  return (
    <div className="flex flex-col items-center gap-3 border-t border-colosseum-surface-light pt-4 sm:flex-row sm:justify-between">
      <span className="text-xs text-gray-600">
        {start}-{end} of {totalItems}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          className="rounded border border-colosseum-surface-light px-3 py-2 text-xs text-gray-400 transition-colors hover:border-gold/30 hover:text-gold disabled:cursor-not-allowed disabled:opacity-30 sm:px-2 sm:py-1"
        >
          Prev
        </button>
        {pages.map((p, idx) =>
          p === 'ellipsis' ? (
            <span key={`e-${idx}`} className="px-1 text-xs text-gray-600">
              ...
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`min-w-[36px] rounded border px-2 py-2 text-xs transition-colors sm:min-w-[28px] sm:py-1 ${
                p === page
                  ? 'border-gold/40 bg-gold/15 text-gold'
                  : 'border-colosseum-surface-light text-gray-500 hover:border-gold/20 hover:text-gray-300'
              }`}
            >
              {p}
            </button>
          ),
        )}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          className="rounded border border-colosseum-surface-light px-3 py-2 text-xs text-gray-400 transition-colors hover:border-gold/30 hover:text-gold disabled:cursor-not-allowed disabled:opacity-30 sm:px-2 sm:py-1"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LeaderboardTable({
  agents,
  bettors,
  agentsLoading,
  bettorsLoading,
  isWalletMode = false,
}: LeaderboardTableProps) {
  const [tab, setTab] = useState<Tab>('agents');
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<AgentClass | 'ALL'>('ALL');
  const [agentSort, setAgentSort] = useState<AgentSortField>('winRate');
  const [bettorSort, setBettorSort] = useState<BettorSortField>('profit');
  const [page, setPage] = useState(1);

  // Reset page when filters change
  const handleSearchChange = (v: string) => {
    setSearch(v);
    setPage(1);
  };
  const handleClassChange = (v: AgentClass | 'ALL') => {
    setClassFilter(v);
    setPage(1);
  };
  const handleSortChange = (v: AgentSortField | BettorSortField) => {
    if (tab === 'agents') {
      setAgentSort(v as AgentSortField);
    } else {
      setBettorSort(v as BettorSortField);
    }
    setPage(1);
  };
  const handleTabChange = (t: Tab) => {
    setTab(t);
    setSearch('');
    setClassFilter('ALL');
    setPage(1);
  };

  // ── Filtered + sorted agents ──────────────────────────────────
  const filteredAgents = useMemo(() => {
    let result = agents;

    // Class filter
    if (classFilter !== 'ALL') {
      result = result.filter((a) => {
        const agentClass = 'wallet_address' in a ? a.top_class : a.agentClass;
        return agentClass === classFilter;
      });
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((a) => {
        if ('wallet_address' in a) {
          // Wallet entry: search by address
          return a.wallet_address.toLowerCase().includes(q);
        } else {
          // Agent entry: search by agent ID or class
          return (
            a.agentId.toLowerCase().includes(q) ||
            a.agentClass.toLowerCase().includes(q) ||
            `${a.agentClass}-${a.agentId.slice(0, 6)}`.toLowerCase().includes(q)
          );
        }
      });
    }

    // Sort
    return sortAgents(result, agentSort);
  }, [agents, classFilter, search, agentSort]);

  // ── Filtered + sorted bettors ─────────────────────────────────
  const filteredBettors = useMemo(() => {
    let result = bettors;

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((b) =>
        b.user_address.toLowerCase().includes(q),
      );
    }

    // Sort
    return sortBettors(result, bettorSort);
  }, [bettors, search, bettorSort]);

  // ── Pagination ────────────────────────────────────────────────
  const activeItems = tab === 'agents' ? filteredAgents : filteredBettors;
  const totalPages = Math.max(1, Math.ceil(activeItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedAgents = filteredAgents.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const paginatedBettors = filteredBettors.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const isLoading = tab === 'agents' ? agentsLoading : bettorsLoading;

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-colosseum-surface-light">
        <button
          onClick={() => handleTabChange('agents')}
          className={`relative px-4 py-3.5 text-sm font-bold uppercase tracking-wider transition-colors sm:py-2.5 ${
            tab === 'agents'
              ? 'text-gold'
              : 'text-gray-600 hover:text-gray-400'
          }`}
        >
          Gladiators
          {tab === 'agents' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gold" />
          )}
          {!agentsLoading && (
            <span className="ml-2 text-[10px] text-gray-600">
              ({agents.length})
            </span>
          )}
        </button>
        <button
          onClick={() => handleTabChange('bettors')}
          className={`relative px-4 py-3.5 text-sm font-bold uppercase tracking-wider transition-colors sm:py-2.5 ${
            tab === 'bettors'
              ? 'text-gold'
              : 'text-gray-600 hover:text-gray-400'
          }`}
        >
          Bettors
          {tab === 'bettors' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gold" />
          )}
          {!bettorsLoading && (
            <span className="ml-2 text-[10px] text-gray-600">
              ({bettors.length})
            </span>
          )}
        </button>
      </div>

      {/* Filters */}
      <LeaderboardFilters
        tab={tab}
        search={search}
        onSearchChange={handleSearchChange}
        classFilter={classFilter}
        onClassFilterChange={handleClassChange}
        sortField={tab === 'agents' ? agentSort : bettorSort}
        onSortFieldChange={handleSortChange}
        isWalletMode={isWalletMode}
      />

      {/* Table content */}
      <div className="space-y-1.5">
        {isLoading ? (
          // Skeleton rows
          Array.from({ length: 8 }).map((_, i) => <RowSkeleton key={i} />)
        ) : activeItems.length === 0 ? (
          <div className="flex items-center justify-center rounded border border-colosseum-surface-light bg-colosseum-bg/50 py-12">
            <p className="text-sm text-gray-600">
              {search.trim()
                ? 'No results match your search.'
                : tab === 'agents'
                  ? 'No agents ranked yet. Start a battle!'
                  : 'No bettors ranked yet.'}
            </p>
          </div>
        ) : tab === 'agents' ? (
          paginatedAgents.map((entry, i) => (
            <AgentRow
              key={'wallet_address' in entry ? entry.wallet_address : entry.agentId}
              entry={entry}
              rank={(safePage - 1) * PAGE_SIZE + i + 1}
            />
          ))
        ) : (
          paginatedBettors.map((entry, i) => (
            <BettorRow
              key={entry.user_address}
              entry={entry}
              rank={(safePage - 1) * PAGE_SIZE + i + 1}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      {!isLoading && (
        <Pagination
          page={safePage}
          totalPages={totalPages}
          onPageChange={setPage}
          totalItems={activeItems.length}
        />
      )}
    </div>
  );
}
