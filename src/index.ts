/**
 * HUNGERNADS - AI Gladiator Colosseum on Monad
 * Worker Entry Point
 *
 * Wires the Hono API router as the main fetch handler and
 * re-exports Durable Object classes for wrangler.
 *
 * "May the nads be ever in your favor."
 */

import { apiRouter } from './api/routes';

export interface Env {
  // D1 Database
  DB: D1Database;

  // Durable Objects
  AGENT_DO: DurableObjectNamespace;
  ARENA_DO: DurableObjectNamespace;

  // KV
  CACHE: KVNamespace;

  // Secrets (from .dev.vars / wrangler secrets)
  GROQ_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  MONAD_RPC_URL?: string;
  MONAD_WS_URL?: string;
  PRIVATE_KEY?: string;
  ARENA_CONTRACT_ADDRESS?: string;
  BETTING_CONTRACT_ADDRESS?: string;
  NADFUN_TOKEN_ADDRESS?: string;
  MOLTBOOK_API_KEY?: string;
  EPOCH_INTERVAL_MS?: string;
  /** Number of epochs after which betting locks (default: 3). */
  BETTING_LOCK_AFTER_EPOCH?: string;

  // Vars
  ENVIRONMENT: string;
  PYTH_ENDPOINT: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return apiRouter.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

// Durable Object exports — required by wrangler for DO bindings
export { AgentDO } from './durable-objects/agent';
export { ArenaDO } from './durable-objects/arena';
