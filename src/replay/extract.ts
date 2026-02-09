/**
 * HUNGERNADS - Replay Data Extractor
 *
 * Converts a sequence of EpochResult[] (from the battle engine) into
 * the serializable ReplayData format used by the Phaser 3 renderer.
 *
 * This module bridges the engine's internal types and the replay system's
 * rendering-oriented data model.
 */

import type { EpochResult } from '../arena/epoch';
import type { BaseAgent } from '../agents/base-agent';
import type {
  ReplayData,
  ReplayEpochFrame,
  ReplayAgentSnapshot,
  ReplayEvent,
} from './types';

// ---------------------------------------------------------------------------
// Main Extraction
// ---------------------------------------------------------------------------

/**
 * Extract replay data from a completed battle.
 *
 * @param battleId - The battle UUID
 * @param agents - The agent instances (for initial roster)
 * @param epochHistory - Full sequence of EpochResult from the battle
 * @param winnerId - Winner agent ID (null if draw)
 * @param startedAt - ISO timestamp when battle started
 */
export function extractReplayData(
  battleId: string,
  agents: BaseAgent[],
  epochHistory: EpochResult[],
  winnerId: string | null,
  startedAt: string,
): ReplayData {
  // Build initial roster from agents at spawn
  const roster: ReplayAgentSnapshot[] = agents.map((a) => ({
    id: a.id,
    name: a.name,
    class: a.agentClass,
    hp: a.maxHp, // full HP at start
    maxHp: a.maxHp,
    isAlive: true,
    position: a.position ? { q: a.position.q, r: a.position.r } : null,
  }));

  // Extract per-epoch frames
  const epochs: ReplayEpochFrame[] = epochHistory.map((result) =>
    extractEpochFrame(result),
  );

  // Build winner info
  let winner: ReplayData['winner'] = null;
  if (winnerId) {
    const winnerAgent = agents.find((a) => a.id === winnerId);
    if (winnerAgent) {
      winner = {
        id: winnerAgent.id,
        name: winnerAgent.name,
        class: winnerAgent.agentClass,
      };
    }
  }

  return {
    battleId,
    roster,
    epochs,
    winner,
    totalEpochs: epochHistory.length,
    startedAt,
  };
}

// ---------------------------------------------------------------------------
// Per-Epoch Frame Extraction
// ---------------------------------------------------------------------------

function extractEpochFrame(result: EpochResult): ReplayEpochFrame {
  const events: ReplayEvent[] = [];

  // --- Prediction results ---
  for (const pr of result.predictionResults) {
    const agentState = result.agentStates.find((a) => a.id === pr.agentId);
    const name = agentState?.name ?? 'Unknown';
    if (pr.correct) {
      events.push({
        type: 'prediction_correct',
        agentId: pr.agentId,
        text: `${name} predicted ${pr.asset} correctly! +${pr.hpChange} HP`,
        hpDelta: pr.hpChange,
      });
    } else if (pr.hpChange < 0) {
      events.push({
        type: 'prediction_wrong',
        agentId: pr.agentId,
        text: `${name} predicted ${pr.asset} wrong! ${pr.hpChange} HP`,
        hpDelta: pr.hpChange,
      });
    }
  }

  // --- Combat results ---
  for (const cr of result.combatResults) {
    const attackerState = result.agentStates.find((a) => a.id === cr.attackerId);
    const targetState = result.agentStates.find((a) => a.id === cr.targetId);
    const attackerName = attackerState?.name ?? 'Unknown';
    const targetName = targetState?.name ?? 'Unknown';

    if (cr.betrayal) {
      events.push({
        type: 'betrayal',
        agentId: cr.attackerId,
        targetId: cr.targetId,
        text: `BETRAYAL! ${attackerName} backstabbed ${targetName}!`,
        hpDelta: cr.hpTransfer,
      });
    } else if (cr.defended) {
      events.push({
        type: 'attack_blocked',
        agentId: cr.attackerId,
        targetId: cr.targetId,
        text: `${attackerName} attacked ${targetName} - BLOCKED!`,
        hpDelta: cr.hpTransfer,
      });
    } else {
      events.push({
        type: 'attack',
        agentId: cr.attackerId,
        targetId: cr.targetId,
        text: `${attackerName} hit ${targetName} for ${Math.abs(cr.hpTransfer)} HP!`,
        hpDelta: cr.hpTransfer,
      });
    }
  }

  // --- Defend costs ---
  for (const dc of result.defendCosts) {
    const agentState = result.agentStates.find((a) => a.id === dc.agentId);
    const name = agentState?.name ?? 'Unknown';
    events.push({
      type: 'defend',
      agentId: dc.agentId,
      text: `${name} defended (-${dc.cost} HP)`,
      hpDelta: -dc.cost,
    });
  }

  // --- Skill activations ---
  for (const skill of result.skillActivations) {
    events.push({
      type: 'skill_activation',
      agentId: skill.agentId,
      targetId: skill.targetId,
      text: skill.effectDescription,
    });
  }

  // --- Alliance events ---
  for (const ae of result.allianceEvents) {
    if (ae.type === 'FORMED') {
      events.push({
        type: 'alliance_formed',
        agentId: ae.agentId,
        targetId: ae.partnerId,
        text: ae.description,
      });
    } else if (ae.type === 'BROKEN' || ae.type === 'EXPIRED') {
      events.push({
        type: 'alliance_broken',
        agentId: ae.agentId,
        targetId: ae.partnerId,
        text: ae.description,
      });
    } else if (ae.type === 'BETRAYED') {
      events.push({
        type: 'betrayal',
        agentId: ae.agentId,
        targetId: ae.partnerId,
        text: ae.description,
      });
    }
  }

  // --- Move results ---
  for (const mr of result.moveResults) {
    if (mr.success) {
      events.push({
        type: 'move',
        agentId: mr.agentId,
        text: `Moved from (${mr.from.q},${mr.from.r}) to (${mr.to.q},${mr.to.r})`,
      });
    }
  }

  // --- Deaths (highest drama, pushed last so they render prominently) ---
  for (const death of result.deaths) {
    events.push({
      type: 'death',
      agentId: death.agentId,
      targetId: death.killerId,
      text: `${death.agentName} is REKT! "${death.finalWords}"`,
    });
  }

  // Build agent snapshot for this epoch
  const agents: ReplayAgentSnapshot[] = result.agentStates.map((a) => ({
    id: a.id,
    name: a.name,
    class: a.class,
    hp: a.hp,
    maxHp: 1000, // All agents start at 1000 HP
    isAlive: a.isAlive,
    position: a.position ? { q: a.position.q, r: a.position.r } : null,
  }));

  return {
    epochNumber: result.epochNumber,
    market: {
      ETH: round2(result.marketData.prices.ETH ?? 0),
      BTC: round2(result.marketData.prices.BTC ?? 0),
      SOL: round2(result.marketData.prices.SOL ?? 0),
      MON: round2(result.marketData.prices.MON ?? 0),
    },
    agents,
    events,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
