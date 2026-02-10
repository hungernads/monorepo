/**
 * HUNGERNADS - Moltbook Battle Poster
 *
 * Orchestrates posting battle results to the /m/hungernads submolt.
 * Creates a battle summary post, then adds agent reaction comments
 * in each agent's class-specific voice.
 *
 * Designed to be called fire-and-forget after battle completion
 * (via waitUntil in the ArenaDO). All errors are caught and logged.
 *
 * Flow:
 *   1. Ensure /m/hungernads submolt exists (idempotent)
 *   2. Create battle summary post
 *   3. Add agent reactions as comments (with delay to respect rate limits)
 */

import type { AgentClass } from '../agents/schemas';
import { MoltbookClient, createMoltbookClient } from './client';
import {
  generateBattleSummaryPost,
  generateAgentReaction,
  type BattlePostContext,
} from './posting-styles';

// ─── Constants ────────────────────────────────────────────────────

const SUBMOLT_NAME = 'hungernads';
const SUBMOLT_DISPLAY_NAME = 'HUNGERNADS Arena';
const SUBMOLT_DESCRIPTION =
  'AI gladiator colosseum on Monad. 5 agents fight to survive. ' +
  'Nads bet and sponsor. Agents learn and evolve. Last nad standing wins. ' +
  'May the nads be ever in your favor. | $HNADS on nad.fun';

/** Delay between comment posts to respect rate limits (20s + buffer). */
const COMMENT_DELAY_MS = 22_000;

// ─── MoltbookPoster ───────────────────────────────────────────────

export class MoltbookPoster {
  private client: MoltbookClient;
  private submoltEnsured = false;

  constructor(client: MoltbookClient) {
    this.client = client;
  }

  /**
   * Post battle results to /m/hungernads.
   *
   * Creates a summary post with a results table, then adds
   * comments from each agent in their class voice.
   *
   * Safe to call fire-and-forget: all errors are caught internally.
   *
   * @param battleState - The completed battle state from ArenaDO
   * @returns true if the summary post was created successfully
   */
  async postBattleResults(battleState: {
    battleId: string;
    epoch: number;
    agents: Record<string, {
      id: string;
      name: string;
      class: AgentClass;
      hp: number;
      maxHp: number;
      isAlive: boolean;
      kills: number;
      epochsSurvived: number;
      thoughts: string[];
    }>;
    winnerId: string | null;
    config?: { maxEpochs?: number };
  }): Promise<boolean> {
    try {
      // Step 0: Ensure the submolt exists
      await this.ensureSubmolt();

      // Step 1: Build the context
      const agentList = Object.values(battleState.agents);
      const winnerAgent = battleState.winnerId
        ? agentList.find((a) => a.id === battleState.winnerId)
        : null;

      const maxEpochs = battleState.config?.maxEpochs ?? 10;
      const wasTimeout = battleState.epoch >= maxEpochs;

      const ctx: BattlePostContext = {
        battleId: battleState.battleId,
        totalEpochs: battleState.epoch,
        winner: winnerAgent
          ? {
              name: winnerAgent.name,
              class: winnerAgent.class,
              hp: winnerAgent.hp,
              kills: winnerAgent.kills,
            }
          : null,
        roster: agentList.map((a) => ({
          name: a.name,
          class: a.class,
          hp: a.hp,
          kills: a.kills,
          isAlive: a.isAlive,
          epochsSurvived: a.epochsSurvived,
          lastThought: a.thoughts?.length > 0
            ? a.thoughts[a.thoughts.length - 1]
            : undefined,
        })),
        wasTimeout,
      };

      // Step 2: Generate and post the summary
      const summaryPost = generateBattleSummaryPost(ctx);
      const postData = await this.client.createPost({
        submolt: SUBMOLT_NAME,
        title: summaryPost.title,
        content: summaryPost.content,
      });

      if (!postData) {
        console.error('[MoltbookPoster] Failed to create summary post');
        return false;
      }

      console.log(
        `[MoltbookPoster] Battle ${battleState.battleId.slice(0, 8)} posted to /m/${SUBMOLT_NAME} (post ID: ${postData.id})`,
      );

      // Step 3: Add agent reactions as comments
      // Fire these sequentially with delays to respect the 20s rate limit
      await this.postAgentReactions(postData.id, ctx);

      return true;
    } catch (err) {
      console.error('[MoltbookPoster] postBattleResults failed:', err);
      return false;
    }
  }

  /**
   * Post agent reactions as threaded comments on the battle summary post.
   *
   * Posts the winner's reaction first, then the others in order of
   * elimination (last eliminated first). Respects the 20s comment cooldown.
   */
  private async postAgentReactions(
    postId: string,
    ctx: BattlePostContext,
  ): Promise<void> {
    // Order: winner first, then alive agents, then dead (reverse elimination order)
    const ordered = [...ctx.roster].sort((a, b) => {
      const aIsWinner = ctx.winner?.name === a.name;
      const bIsWinner = ctx.winner?.name === b.name;
      if (aIsWinner) return -1;
      if (bIsWinner) return 1;
      if (a.isAlive && !b.isAlive) return -1;
      if (!a.isAlive && b.isAlive) return 1;
      return b.epochsSurvived - a.epochsSurvived;
    });

    for (let i = 0; i < ordered.length; i++) {
      const agent = ordered[i];

      try {
        const reaction = generateAgentReaction(agent, ctx);
        const commentContent = `**${agent.name}** (${agent.class}):\n\n${reaction}`;

        const success = await this.client.createComment({
          postId,
          content: commentContent,
        });

        if (success) {
          console.log(`[MoltbookPoster] ${agent.name} reaction posted`);
        } else {
          console.warn(`[MoltbookPoster] Failed to post ${agent.name} reaction`);
        }
      } catch (err) {
        console.error(`[MoltbookPoster] ${agent.name} reaction error:`, err);
      }

      // Delay between comments (skip after the last one)
      if (i < ordered.length - 1) {
        await sleep(COMMENT_DELAY_MS);
      }
    }
  }

  /**
   * Ensure the /m/hungernads submolt exists.
   * Creates it if it doesn't exist. Idempotent and cached.
   */
  private async ensureSubmolt(): Promise<void> {
    if (this.submoltEnsured) return;

    try {
      // Check if it already exists
      const existing = await this.client.getSubmolt(SUBMOLT_NAME);
      if (existing) {
        this.submoltEnsured = true;
        return;
      }

      // Create it
      await this.client.createSubmolt({
        name: SUBMOLT_NAME,
        displayName: SUBMOLT_DISPLAY_NAME,
        description: SUBMOLT_DESCRIPTION,
      });

      // Subscribe to our own submolt
      await this.client.subscribeToSubmolt(SUBMOLT_NAME);

      this.submoltEnsured = true;
    } catch (err) {
      // Non-fatal: submolt might already exist (race condition with other workers)
      console.warn('[MoltbookPoster] ensureSubmolt warning:', err);
      this.submoltEnsured = true; // Assume it exists, post will fail if not
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────

/**
 * Create a MoltbookPoster from env vars.
 * Returns null if MOLTBOOK_API_KEY is not set.
 */
export function createMoltbookPoster(env: {
  MOLTBOOK_API_KEY?: string;
}): MoltbookPoster | null {
  const client = createMoltbookClient(env);
  if (!client) return null;
  return new MoltbookPoster(client);
}

// ─── Helpers ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
