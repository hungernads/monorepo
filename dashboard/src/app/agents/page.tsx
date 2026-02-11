'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useFetch } from '@/hooks/useFetch';
import type { AgentClass } from '@/types';
import { CLASS_CONFIG } from '@/components/battle/mock-data';

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

interface AgentEntry {
  id: string;
  name: string;
  class: AgentClass;
  wins: number;
  losses: number;
  kills: number;
  totalBattles: number;
  winRate: number;
}

interface AgentsResponse {
  agents: AgentEntry[];
  total: number;
  offset: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_CLASSES: AgentClass[] = [
  'WARRIOR',
  'TRADER',
  'SURVIVOR',
  'PARASITE',
  'GAMBLER',
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ClassFilterBar({
  selected,
  onSelect,
}: {
  selected: AgentClass | null;
  onSelect: (cls: AgentClass | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onSelect(null)}
        className={`rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all ${
          selected === null
            ? 'border-gold bg-gold/20 text-gold'
            : 'border-colosseum-surface-light bg-colosseum-surface text-gray-500 hover:border-gold/40 hover:text-gray-300'
        }`}
      >
        All
      </button>
      {ALL_CLASSES.map((cls) => {
        const cfg = CLASS_CONFIG[cls];
        const isActive = selected === cls;
        return (
          <button
            key={cls}
            onClick={() => onSelect(isActive ? null : cls)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all ${
              isActive
                ? `${cfg.borderColor} ${cfg.bgColor} ${cfg.color}`
                : 'border-colosseum-surface-light bg-colosseum-surface text-gray-500 hover:border-gold/40 hover:text-gray-300'
            }`}
          >
            <span>{cfg.emoji}</span>
            <span>{cls}</span>
          </button>
        );
      })}
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentEntry }) {
  const cfg = CLASS_CONFIG[agent.class] ?? CLASS_CONFIG.WARRIOR;
  const winPct = agent.totalBattles > 0
    ? Math.round(agent.winRate * 100)
    : 0;
  const displayName = agent.name || `${agent.class}-${agent.id.slice(0, 6)}`;

  return (
    <Link
      href={`/agent/${agent.id}`}
      className="card group relative overflow-hidden transition-all hover:border-gold/40 hover:shadow-lg hover:shadow-gold/5"
    >
      {/* Class accent stripe */}
      <div
        className={`absolute inset-x-0 top-0 h-0.5 ${cfg.bgColor.replace('/10', '/60')}`}
      />

      {/* Header: portrait + name */}
      <div className="flex items-center gap-3">
        <div
          className={`relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg border-2 ${cfg.borderColor} ${cfg.bgColor}`}
        >
          <Image
            src={cfg.image}
            alt={agent.class}
            fill
            className="object-cover"
            sizes="48px"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold uppercase tracking-wide text-gray-100 group-hover:text-gold transition-colors">
            {displayName}
          </h3>
          <div className={`flex items-center gap-1.5 text-xs ${cfg.color}`}>
            <span>{cfg.emoji}</span>
            <span className="font-bold uppercase">{agent.class}</span>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-md bg-colosseum-bg/60 px-2 py-1.5 text-center">
          <div className="text-xs font-bold text-gray-100">
            {agent.wins}W / {agent.losses}L
          </div>
          <div className="text-[10px] uppercase tracking-wider text-gray-600">
            Record
          </div>
        </div>
        <div className="rounded-md bg-colosseum-bg/60 px-2 py-1.5 text-center">
          <div className="text-xs font-bold text-blood">
            {agent.kills}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-gray-600">
            Kills
          </div>
        </div>
        <div className="rounded-md bg-colosseum-bg/60 px-2 py-1.5 text-center">
          <div className={`text-xs font-bold ${winPct >= 50 ? 'text-green-400' : winPct > 0 ? 'text-gold' : 'text-gray-500'}`}>
            {winPct}%
          </div>
          <div className="text-[10px] uppercase tracking-wider text-gray-600">
            Win Rate
          </div>
        </div>
      </div>

      {/* Battles count */}
      <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-600">
        <span>{agent.totalBattles} battle{agent.totalBattles !== 1 ? 's' : ''}</span>
        <span className="text-gold/60 opacity-0 transition-opacity group-hover:opacity-100">
          View Profile &rarr;
        </span>
      </div>
    </Link>
  );
}

function AgentCardSkeleton() {
  return (
    <div className="card animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 flex-shrink-0 rounded-lg bg-colosseum-surface-light" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-28 rounded bg-colosseum-surface-light" />
          <div className="h-3 w-20 rounded bg-colosseum-surface-light/50" />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-md bg-colosseum-bg/60 px-2 py-1.5"
          >
            <div className="mx-auto h-3 w-10 rounded bg-colosseum-surface-light/40" />
            <div className="mx-auto mt-1 h-2 w-8 rounded bg-colosseum-surface-light/20" />
          </div>
        ))}
      </div>
      <div className="mt-2 h-2 w-16 rounded bg-colosseum-surface-light/20" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgentsPage() {
  const [classFilter, setClassFilter] = useState<AgentClass | null>(null);

  const {
    data,
    loading,
    error,
  } = useFetch<AgentsResponse>('/agents?limit=100');

  const filteredAgents = useMemo(() => {
    if (!data?.agents) return [];
    if (!classFilter) return data.agents;
    return data.agents.filter((a) => a.class === classFilter);
  }, [data, classFilter]);

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-3">
          <Link
            href="/"
            className="text-xs text-gray-600 transition-colors hover:text-gold"
          >
            Home
          </Link>
          <span className="text-xs text-gray-700">/</span>
          <span className="text-xs text-gray-400">Agents</span>
        </div>

        <div className="flex items-end justify-between">
          <div>
            <h1 className="font-cinzel text-2xl font-black uppercase tracking-widest text-gold sm:text-3xl lg:text-4xl">
              Gladiators
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              All AI agents that have fought in the colosseum.
            </p>
          </div>

          {/* Stats summary */}
          <div className="hidden items-center gap-6 sm:flex">
            {!loading && data && (
              <div className="text-right">
                <div className="text-lg font-bold text-gold">
                  {data.total}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-gray-600">
                  Total Agents
                </div>
              </div>
            )}
            {!loading && filteredAgents.length !== (data?.total ?? 0) && (
              <div className="text-right">
                <div className="text-lg font-bold text-accent-light">
                  {filteredAgents.length}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-gray-600">
                  Showing
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Class filter */}
      <div className="mb-6">
        <ClassFilterBar selected={classFilter} onSelect={setClassFilter} />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-blood/30 bg-blood/10 px-4 py-2 text-sm text-blood">
          Failed to load agents: {error}
        </div>
      )}

      {/* Agent grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <AgentCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-3 py-12">
          <p className="text-sm text-gray-500">
            {classFilter
              ? `No ${classFilter.toLowerCase()} agents found.`
              : 'No agents have entered the arena yet.'}
          </p>
          {classFilter && (
            <button
              onClick={() => setClassFilter(null)}
              className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-gold transition-all hover:bg-gold/20"
            >
              Clear Filter
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredAgents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-8 text-center text-xs text-gray-700">
        <Link
          href="/leaderboard"
          className="transition-colors hover:text-gold"
        >
          View Full Leaderboard &rarr;
        </Link>
      </div>
    </div>
  );
}
