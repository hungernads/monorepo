/**
 * Multi-Provider LLM Client for HUNGERNADS
 *
 * Combines free tiers from multiple providers:
 * - Groq: 1,000 req/day per key (comma-separated GROQ_API_KEYS)
 * - Google Gemini: ~1,500 req/day
 * - OpenRouter: 50 req/day (free models)
 *
 * Keys that hit rate limits are flagged and skipped until daily reset.
 */

import OpenAI from 'openai';

interface Provider {
  name: string;
  client: OpenAI;
  model: string;
  priority: number;
  requestsToday: number;
  lastReset: Date;
  dailyLimit: number;
  /** When set, this provider is skipped until this time passes */
  exhaustedUntil: Date | null;
}

interface LLMResponse {
  content: string;
  provider: string;
  model: string;
}

/**
 * Explicit API keys for environments without process.env (e.g. Cloudflare Workers).
 *
 * GROQ_API_KEYS: Comma-separated list of Groq keys (e.g. "gsk_abc,gsk_def,gsk_ghi")
 * Each key gets its own 1,000 req/day pool.
 */
export interface LLMKeys {
  groqApiKeys?: string;        // comma-separated
  // Legacy single-key fields (still supported for backward compat)
  groqApiKey?: string;
  groq2ApiKey?: string;
  groq3ApiKey?: string;
  groq4ApiKey?: string;
  googleApiKey?: string;
  openrouterApiKey?: string;
}

export class MultiProviderLLM {
  private providers: Provider[] = [];
  private currentIndex = 0;

  constructor(keys?: LLMKeys) {
    // Resolve keys: explicit keys take precedence, fall back to process.env
    const env = typeof process !== 'undefined' ? process.env : {};

    // Collect all Groq keys: prefer comma-separated GROQ_API_KEYS, then fall back to individual vars
    const groqKeysRaw = keys?.groqApiKeys ?? env.GROQ_API_KEYS;
    let groqKeys: string[] = [];

    if (groqKeysRaw) {
      groqKeys = groqKeysRaw.split(',').map(k => k.trim()).filter(Boolean);
    } else {
      // Legacy: collect individual GROQ_API_KEY, GROQ_2_API_KEY, etc.
      const candidates = [
        keys?.groqApiKey ?? env.GROQ_API_KEY,
        keys?.groq2ApiKey ?? env.GROQ_2_API_KEY,
        keys?.groq3ApiKey ?? env.GROQ_3_API_KEY,
        keys?.groq4ApiKey ?? env.GROQ_4_API_KEY,
      ];
      groqKeys = candidates.filter((k): k is string => !!k);
    }

    const googleKey = keys?.googleApiKey ?? env.GOOGLE_API_KEY;
    const openrouterKey = keys?.openrouterApiKey ?? env.OPENROUTER_API_KEY;

    // Register Groq providers (1,000 req/day each)
    groqKeys.forEach((key, i) => {
      this.providers.push({
        name: i === 0 ? 'groq' : `groq-${i + 1}`,
        client: new OpenAI({
          apiKey: key,
          baseURL: 'https://api.groq.com/openai/v1',
        }),
        model: 'llama-3.3-70b-versatile',
        priority: 1,
        requestsToday: 0,
        lastReset: new Date(),
        dailyLimit: 1000,
        exhaustedUntil: null,
      });
    });

    // Google Gemini (~1,500 req/day)
    if (googleKey) {
      this.providers.push({
        name: 'google',
        client: new OpenAI({
          apiKey: googleKey,
          baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        }),
        model: 'gemini-2.0-flash',
        priority: 2,
        requestsToday: 0,
        lastReset: new Date(),
        dailyLimit: 1500,
        exhaustedUntil: null,
      });
    }

    // OpenRouter (50 req/day)
    if (openrouterKey) {
      this.providers.push({
        name: 'openrouter',
        client: new OpenAI({
          apiKey: openrouterKey,
          baseURL: 'https://openrouter.ai/api/v1',
        }),
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        priority: 3,
        requestsToday: 0,
        lastReset: new Date(),
        dailyLimit: 50,
        exhaustedUntil: null,
      });
    }

    if (this.providers.length === 0) {
      throw new Error(
        'No LLM providers configured! Set GROQ_API_KEYS (comma-separated) or individual GROQ_API_KEY, GOOGLE_API_KEY, OPENROUTER_API_KEY'
      );
    }

    console.log(`[LLM] Initialized ${this.providers.length} providers:`,
      this.providers.map(p => `${p.name} (${p.dailyLimit}/day)`).join(', ')
    );
  }

  /**
   * Reset daily counters if new day, and clear exhausted flag
   */
  private checkDailyReset(provider: Provider): void {
    const now = new Date();
    if (now.toDateString() !== provider.lastReset.toDateString()) {
      provider.requestsToday = 0;
      provider.lastReset = now;
      provider.exhaustedUntil = null;
      console.log(`[LLM] Reset daily counter for ${provider.name}`);
    }
  }

  /**
   * Check if provider is available (not exhausted, has capacity)
   */
  private isAvailable(provider: Provider): boolean {
    this.checkDailyReset(provider);

    // Skip if flagged as exhausted (from 429 or counter limit)
    if (provider.exhaustedUntil) {
      if (new Date() < provider.exhaustedUntil) return false;
      // Cooldown expired, give it another shot
      provider.exhaustedUntil = null;
    }

    return provider.requestsToday < provider.dailyLimit;
  }

  /**
   * Get next available provider (round-robin with rate limit awareness)
   */
  private getNextProvider(): Provider | null {
    const startIndex = this.currentIndex;

    do {
      const provider = this.providers[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.providers.length;

      if (this.isAvailable(provider)) {
        return provider;
      }
    } while (this.currentIndex !== startIndex);

    return null; // All providers exhausted
  }

  /**
   * Mark a provider as exhausted until end of day (or a cooldown period)
   */
  private markExhausted(provider: Provider): void {
    // Set exhausted until midnight UTC (Groq resets daily)
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    provider.exhaustedUntil = tomorrow;
    provider.requestsToday = provider.dailyLimit;
    console.log(`[LLM] ${provider.name} marked exhausted until ${tomorrow.toISOString()}`);
  }

  /**
   * Call LLM with automatic fallback
   */
  async chat(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    options?: { maxTokens?: number; temperature?: number }
  ): Promise<LLMResponse> {
    const maxRetries = this.providers.length;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const provider = this.getNextProvider();

      if (!provider) {
        throw new Error('All LLM providers exhausted their daily limits!');
      }

      try {
        const response = await provider.client.chat.completions.create({
          model: provider.model,
          messages,
          max_tokens: options?.maxTokens ?? 500,
          temperature: options?.temperature ?? 0.7,
        });

        provider.requestsToday++;

        const content = response.choices[0]?.message?.content || '';

        return {
          content,
          provider: provider.name,
          model: provider.model,
        };
      } catch (error: any) {
        lastError = error;

        // Rate limited — flag exhausted so we skip it immediately next time
        if (error?.status === 429) {
          console.log(`[LLM] ${provider.name} rate limited (429), marking exhausted`);
          this.markExhausted(provider);
          continue;
        }

        // Other error - log and try next
        console.error(`[LLM] ${provider.name} error:`, error.message);
        continue;
      }
    }

    throw lastError || new Error('All LLM providers failed');
  }

  /**
   * Get current status of all providers
   */
  getStatus(): { name: string; used: number; limit: number; available: number; exhausted: boolean }[] {
    return this.providers.map(p => {
      this.checkDailyReset(p);
      const exhausted = !!p.exhaustedUntil && new Date() < p.exhaustedUntil;
      return {
        name: p.name,
        used: p.requestsToday,
        limit: p.dailyLimit,
        available: exhausted ? 0 : p.dailyLimit - p.requestsToday,
        exhausted,
      };
    });
  }

  /**
   * Get total remaining requests across all providers
   */
  getTotalRemaining(): number {
    return this.getStatus().reduce((sum, p) => sum + p.available, 0);
  }
}

// Singleton instance (keyed by serialised keys for multi-tenant safety)
let llmInstance: MultiProviderLLM | null = null;
let llmInstanceKeyHash: string = '';

function keyHash(keys?: LLMKeys): string {
  if (!keys) return '__env__';
  const groqPart = keys.groqApiKeys
    ?? [keys.groqApiKey, keys.groq2ApiKey, keys.groq3ApiKey, keys.groq4ApiKey].filter(Boolean).join(',');
  return [groqPart, keys.googleApiKey, keys.openrouterApiKey]
    .map(k => k ? k.slice(0, 8) : '')
    .join('|');
}

export function getLLM(keys?: LLMKeys): MultiProviderLLM {
  const hash = keyHash(keys);
  if (!llmInstance || llmInstanceKeyHash !== hash) {
    llmInstance = new MultiProviderLLM(keys);
    llmInstanceKeyHash = hash;
  }
  return llmInstance;
}

// Agent decision result type (supports both new triangle and legacy fields)
export interface AgentDecisionResult {
  prediction: { asset: string; direction: 'UP' | 'DOWN'; stake: number };
  // New combat triangle fields
  combatStance?: 'ATTACK' | 'SABOTAGE' | 'DEFEND' | 'NONE';
  combatTarget?: string;
  combatStake?: number;
  // Hex grid movement (optional)
  move?: { q: number; r: number };
  // Skill system
  useSkill?: boolean;
  skillTarget?: string;
  // Legacy fields (for backward compat during migration)
  attack?: { target: string; stake: number } | null;
  defend?: boolean;
  reasoning: string;
}

// Example usage for agent decisions
export async function agentDecision(
  agentName: string,
  agentClass: string,
  personality: string,
  hp: number,
  marketData: { eth: number; btc: number; sol: number; mon: number },
  otherAgents: { name: string; class: string; hp: number }[],
  lessons: string[],
  keys?: LLMKeys,
  /** Spatial context string from grid.buildSpatialContext (optional). */
  spatialContext?: string,
): Promise<AgentDecisionResult> {
  const llm = getLLM(keys);

  const systemPrompt = `You are ${agentName}, a ${agentClass} agent in HUNGERNADS arena.
${personality}

Your lessons from past battles:
${lessons.length > 0 ? lessons.join('\n') : 'No lessons yet.'}

You must respond with ONLY valid JSON, no other text.`;

  const spatialBlock = spatialContext
    ? `\nARENA POSITION:\n${spatialContext}\n`
    : '';

  const userPrompt = `MARKET PRICES:
ETH: $${marketData.eth}
BTC: $${marketData.btc}
SOL: $${marketData.sol}
MON: $${marketData.mon}

YOUR HP: ${hp}/1000
${spatialBlock}
OTHER AGENTS:
${otherAgents.map(a => `- ${a.name} (${a.class}) - ${a.hp} HP`).join('\n')}

Decide your action. Respond with JSON:
{
  "prediction": { "asset": "ETH|BTC|SOL|MON", "direction": "UP|DOWN", "stake": 5-50 },
  "combatStance": "ATTACK|SABOTAGE|DEFEND|NONE",
  "combatTarget": "agent_name or null",
  "move": { "q": number, "r": number },
  "reasoning": "brief explanation"
}

IMPORTANT:
- stake is a PERCENTAGE (5-50) of your current HP, NOT a decimal
- move is your target hex position (axial coordinates)
- combatTarget must be an exact agent name from the list above, or null`;

  const response = await llm.chat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);

  // Parse JSON from response
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Fall through to default
  }

  // Default safe action
  return {
    prediction: { asset: 'ETH', direction: 'UP', stake: 5 },
    combatStance: 'DEFEND',
    reasoning: `[FALLBACK] ${agentName} defaulted to safe prediction.`,
  };
}
