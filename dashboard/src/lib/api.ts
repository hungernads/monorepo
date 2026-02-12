/**
 * HUNGERNADS - API Client
 *
 * Typed fetch helpers for the Cloudflare Worker REST API.
 * Used by server components to fetch battle, agent, and betting data.
 */

// ─── Base URL ───────────────────────────────────────────────────────

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://hungernads.amr-robb.workers.dev";

// ─── Types (matching backend response shapes) ───────────────────────

/** Backend AgentProfile from GET /agent/:id */
export interface ApiAgentProfile {
  agentId: string;
  agentClass: string;
  totalBattles: number;
  wins: number;
  kills: number;
  matchups: Record<string, { wins: number; losses: number }>;
  deathCauses: Record<string, number>;
  avgSurvival: number;
  winRate: number;
  streak: number;
  recentLessons: ApiLesson[];
}

/** Backend Lesson shape */
export interface ApiLesson {
  battleId: string;
  epoch: number;
  context: string;
  outcome: string;
  learning: string;
  applied: string;
}

/** GET /agent/:id/lessons response */
export interface ApiLessonsResponse {
  agentId: string;
  lessons: ApiLesson[];
  count: number;
}

/** GET /agent/:id/matchups response */
export interface ApiMatchupsResponse {
  agentId: string;
  matchups: Record<string, { wins: number; losses: number }>;
}

// ─── Fetch Helpers ──────────────────────────────────────────────────

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(path: string): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    next: { revalidate: 30 }, // ISR: revalidate every 30s
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, `${res.status} ${res.statusText}: ${body}`);
  }

  return res.json() as Promise<T>;
}

// ─── Agent API ──────────────────────────────────────────────────────

/** Fetch full agent profile (stats, matchups, lessons, death causes). */
export async function getAgentProfile(
  agentId: string,
): Promise<ApiAgentProfile> {
  return apiFetch<ApiAgentProfile>(`/agent/${agentId}`);
}

/** Fetch agent lessons with optional limit. */
export async function getAgentLessons(
  agentId: string,
  limit: number = 20,
): Promise<ApiLessonsResponse> {
  return apiFetch<ApiLessonsResponse>(
    `/agent/${agentId}/lessons?limit=${limit}`,
  );
}

/** Fetch agent matchup records vs each class. */
export async function getAgentMatchups(
  agentId: string,
): Promise<ApiMatchupsResponse> {
  return apiFetch<ApiMatchupsResponse>(`/agent/${agentId}/matchups`);
}

export { ApiError };
