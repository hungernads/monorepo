#!/usr/bin/env tsx
/**
 * HUNGERNADS - CLI Battle Runner
 *
 * Runs a full battle end-to-end in the terminal with colorful play-by-play.
 * Works without API keys (pure simulation mode using agent fallback logic).
 *
 * Usage:
 *   npx tsx scripts/run-battle.ts
 *   npm run battle
 *
 * Environment variables (optional):
 *   GROQ_API_KEY, GOOGLE_API_KEY, OPENROUTER_API_KEY - Enable LLM decisions
 *   BATTLE_SPEED=fast|slow|instant - Control epoch delay (default: fast)
 *
 * "May the nads be ever in your favor."
 */

import 'dotenv/config';

import { ArenaManager } from '../src/arena/arena';
import { processEpoch, type EpochResult } from '../src/arena/epoch';
import { PriceFeed } from '../src/arena/price-feed';
import type { MarketData } from '../src/agents/schemas';
import {
  extractAllLessons,
  type BattleHistory,
  type AgentInfo,
  type LLMCall,
} from '../src/learning/lessons';
import type { DeathCause } from '../src/arena/death';
import type { ArenaAgentState } from '../src/agents/schemas';
import type { HexGridState, HexTile, HexCoord } from '../src/arena/hex-grid';
import { hexKey, getDistance } from '../src/arena/hex-grid';
import type { ItemPickupResult, TrapTriggerResult } from '../src/arena/items';
import type { MoveResult } from '../src/arena/grid';

// ═══════════════════════════════════════════════════════════════════════════════
// ANSI Color Utilities (no dependencies needed)
// ═══════════════════════════════════════════════════════════════════════════════

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  blink: '\x1b[5m',
  // Foreground
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  // Bright
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
  // Background
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
} as const;

function c(color: keyof typeof C, text: string): string {
  return `${C[color]}${text}${C.reset}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Class Styling
// ═══════════════════════════════════════════════════════════════════════════════

const CLASS_STYLE: Record<string, { icon: string; color: keyof typeof C }> = {
  WARRIOR: { icon: '\u2694\uFE0F', color: 'brightRed' },
  TRADER: { icon: '\uD83D\uDCCA', color: 'brightCyan' },
  SURVIVOR: { icon: '\uD83D\uDEE1\uFE0F', color: 'brightGreen' },
  PARASITE: { icon: '\uD83E\uDDA0', color: 'brightMagenta' },
  GAMBLER: { icon: '\uD83C\uDFB2', color: 'brightYellow' },
};

function agentTag(name: string, agentClass: string): string {
  const style = CLASS_STYLE[agentClass] ?? { icon: '?', color: 'white' as const };
  return `${style.icon} ${c(style.color, name)}`;
}

function agentTagBold(name: string, agentClass: string): string {
  const style = CLASS_STYLE[agentClass] ?? { icon: '?', color: 'white' as const };
  return `${style.icon} ${c('bold', c(style.color, name))}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HP Bar Rendering
// ═══════════════════════════════════════════════════════════════════════════════

function hpBar(hp: number, maxHp: number, width: number = 20): string {
  const ratio = Math.max(0, hp / maxHp);
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  let barColor: keyof typeof C;
  if (ratio > 0.6) barColor = 'brightGreen';
  else if (ratio > 0.3) barColor = 'brightYellow';
  else if (ratio > 0.1) barColor = 'red';
  else barColor = 'brightRed';

  const bar = c(barColor, '\u2588'.repeat(filled)) + c('gray', '\u2591'.repeat(empty));
  const pct = Math.round(ratio * 100).toString().padStart(3);
  return `[${bar}] ${c(barColor, `${pct}%`)} ${c('gray', `(${hp}/${maxHp})`)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Item Type Styling
// ═══════════════════════════════════════════════════════════════════════════════

const ITEM_STYLE: Record<string, { icon: string; char: string; color: keyof typeof C }> = {
  RATION: { icon: '\uD83C\uDF56', char: 'R', color: 'green' },
  WEAPON: { icon: '\uD83D\uDDE1\uFE0F', char: 'W', color: 'red' },
  SHIELD: { icon: '\uD83D\uDEE1\uFE0F', char: 'S', color: 'cyan' },
  TRAP:   { icon: '\uD83D\uDCA3', char: 'T', color: 'brightRed' },
  ORACLE: { icon: '\uD83D\uDD2E', char: 'O', color: 'magenta' },
};

// ═══════════════════════════════════════════════════════════════════════════════
// ASCII Hex Grid Renderer (19-tile arena)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Agent class abbreviations for the grid display.
 * Single char for compact hex cells.
 */
const CLASS_CHAR: Record<string, string> = {
  WARRIOR: 'W',
  TRADER: 'T',
  SURVIVOR: 'S',
  PARASITE: 'P',
  GAMBLER: 'G',
};

/**
 * Render the 19-tile hex grid as ASCII art.
 *
 * Layout (flat-top hexes, r rows top-to-bottom):
 *
 *          [   ] [   ] [   ]           r = -2 (3 tiles)
 *        [   ] [   ] [   ] [   ]       r = -1 (4 tiles)
 *      [   ] [   ] [   ] [   ] [   ]   r =  0 (5 tiles)
 *        [   ] [   ] [   ] [   ]       r =  1 (4 tiles)
 *          [   ] [   ] [   ]           r =  2 (3 tiles)
 *
 * Each cell shows agent (colored class char) or item type, or '.' for empty.
 */
function renderHexGrid(
  grid: HexGridState,
  agentLookup: Map<string, { name: string; class: string }>,
  indent: string = '    ',
): string {
  // Grid rows from top to bottom (r = -2 to 2)
  const rows: { r: number; qMin: number; qMax: number }[] = [
    { r: -2, qMin: 0, qMax: 2 },
    { r: -1, qMin: -1, qMax: 2 },
    { r: 0,  qMin: -2, qMax: 2 },
    { r: 1,  qMin: -2, qMax: 1 },
    { r: 2,  qMin: -2, qMax: 0 },
  ];

  const CELL_WIDTH = 5; // " [x] " total per cell
  const MAX_COLS = 5;   // widest row (r=0) has 5 cells

  const lines: string[] = [];

  for (const row of rows) {
    const numCells = row.qMax - row.qMin + 1;
    const leftPad = Math.floor((MAX_COLS - numCells) * (CELL_WIDTH / 2));
    let line = indent + ' '.repeat(leftPad);

    for (let q = row.qMin; q <= row.qMax; q++) {
      const key = `${q},${row.r}`;
      const tile = grid.tiles.get(key);

      if (!tile) {
        line += '     '; // shouldn't happen for valid grid
        continue;
      }

      const cellContent = formatHexCell(tile, agentLookup);
      line += cellContent;
    }

    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Format a single hex cell for the ASCII grid.
 * Priority: agent > items > tile type indicator.
 */
function formatHexCell(
  tile: HexTile,
  agentLookup: Map<string, { name: string; class: string }>,
): string {
  // Agent on tile?
  if (tile.occupantId) {
    const info = agentLookup.get(tile.occupantId);
    if (info) {
      const style = CLASS_STYLE[info.class] ?? { icon: '?', color: 'white' as const };
      const ch = CLASS_CHAR[info.class] ?? '?';
      const nameInitial = info.name.charAt(0).toUpperCase();
      return ` [${c(style.color, ch + nameInitial)}] `;
    }
    return ' [??] ';
  }

  // Items on tile?
  if (tile.items.length > 0) {
    const item = tile.items[0]; // Show first item
    const itemStyle = ITEM_STYLE[item.type] ?? { char: '?', color: 'white' as const };
    const extra = tile.items.length > 1 ? '+' : ' ';
    return ` [${c(itemStyle.color, itemStyle.char + extra)}] `;
  }

  // Empty tile - show type indicator
  if (tile.type === 'CORNUCOPIA') {
    return ` [${c('yellow', '\u00B7\u00B7')}] `; // center zone
  }

  return ` [${c('gray', '\u00B7\u00B7')}] `; // edge zone
}

/**
 * Print the hex grid with a header and legend.
 */
function printHexGrid(
  grid: HexGridState,
  agentLookup: Map<string, { name: string; class: string }>,
  header?: string,
): void {
  if (header) {
    console.log('');
    console.log(c('bold', `  ${header}`));
  }

  console.log('');
  console.log(renderHexGrid(grid, agentLookup));
  console.log('');

  // Compact legend
  const agentLegend = Object.entries(CLASS_STYLE)
    .map(([cls, style]) => `${c(style.color, CLASS_CHAR[cls] ?? '?')}=${cls}`)
    .join(' ');
  const itemLegend = Object.entries(ITEM_STYLE)
    .map(([type, style]) => `${c(style.color, style.char)}=${type}`)
    .join(' ');

  console.log(`    ${c('gray', 'Agents:')} ${agentLegend}`);
  console.log(`    ${c('gray', 'Items:')}  ${itemLegend}`);
  console.log(`    ${c('gray', 'Zones:')}  ${c('yellow', '\u00B7\u00B7')}=cornucopia  ${c('gray', '\u00B7\u00B7')}=edge`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Movement / Item Phase Display
// ═══════════════════════════════════════════════════════════════════════════════

function printMovementPhase(
  result: EpochResult,
  agentLookup: Map<string, { name: string; class: string }>,
): void {
  if (!result.moveResults || result.moveResults.length === 0) return;

  console.log('');
  console.log(c('bold', '  MOVEMENT:'));

  for (const mv of result.moveResults) {
    const info = agentLookup.get(mv.agentId);
    if (!info) continue;

    const tag = agentTag(info.name, info.class);
    if (mv.success) {
      console.log(
        `    ${tag} ${c('brightCyan', '\u2192')} moved (${mv.from.q},${mv.from.r}) ${c('brightCyan', '\u2192')} (${mv.to.q},${mv.to.r})`,
      );
    } else {
      console.log(
        `    ${tag} ${c('gray', '\u2717')} stay at (${mv.from.q},${mv.from.r}) ${c('gray', `[${mv.reason}]`)}`,
      );
    }
  }
}

function printItemPickupPhase(
  result: EpochResult,
  agentLookup: Map<string, { name: string; class: string }>,
): void {
  const hasPickups = result.itemPickups && result.itemPickups.length > 0;
  const hasTraps = result.trapTriggers && result.trapTriggers.length > 0;
  if (!hasPickups && !hasTraps) return;

  console.log('');
  console.log(c('bold', '  ITEMS:'));

  // Traps first (dramatic)
  if (hasTraps) {
    for (const trap of result.trapTriggers) {
      const info = agentLookup.get(trap.agentId);
      if (!info) continue;
      const tag = agentTag(info.name, info.class);
      console.log(
        `    ${tag} ${c('brightRed', '\uD83D\uDCA5 TRAP!')} ${c('brightRed', `-${trap.damage} HP`)} at (${trap.item.coord.q},${trap.item.coord.r})`,
      );
    }
  }

  // Pickups
  if (hasPickups) {
    for (const pickup of result.itemPickups) {
      const info = agentLookup.get(pickup.agentId);
      if (!info) continue;
      const tag = agentTag(info.name, info.class);
      const itemStyle = ITEM_STYLE[pickup.item.type] ?? { icon: '?', char: '?', color: 'white' as const };
      const hpStr = pickup.hpChange > 0
        ? c('brightGreen', `+${pickup.hpChange} HP`)
        : pickup.hpChange < 0
          ? c('brightRed', `${pickup.hpChange} HP`)
          : c('gray', 'buff applied');
      console.log(
        `    ${tag} ${c(itemStyle.color, `picked up ${pickup.item.type}`)} ${hpStr}`,
      );
      if (pickup.buff) {
        console.log(
          `           ${c('cyan', `\u2192 ${pickup.effect}`)}`,
        );
      }
    }
  }
}

function printItemSpawns(result: EpochResult): void {
  if (!result.itemsSpawned || result.itemsSpawned === 0) return;
  console.log('');
  console.log(
    `  ${c('yellow', `\u2728 ${result.itemsSpawned} new item${result.itemsSpawned > 1 ? 's' : ''} spawned on the field`)}`,
  );
}

function printBuffStatus(
  result: EpochResult,
  agentLookup: Map<string, { name: string; class: string }>,
): void {
  if (!result.buffTicks || result.buffTicks.length === 0) return;

  const expired = result.buffTicks.filter(bt => bt.expired.length > 0);
  if (expired.length === 0) return;

  console.log('');
  console.log(c('bold', '  BUFF EXPIRATIONS:'));
  for (const bt of expired) {
    const info = agentLookup.get(bt.agentId);
    if (!info) continue;
    const tag = agentTag(info.name, info.class);
    for (const buff of bt.expired) {
      console.log(
        `    ${tag} ${c('gray', `${buff.type} buff expired`)}`,
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Simulated Price Feed (for offline/mock mode)
// ═══════════════════════════════════════════════════════════════════════════════

class SimulatedPriceFeed extends PriceFeed {
  private prices: Record<string, number> = {
    ETH: 2450 + Math.random() * 200,
    BTC: 52000 + Math.random() * 5000,
    SOL: 105 + Math.random() * 20,
    MON: 0.75 + Math.random() * 0.3,
  };

  override async fetchPrices(): Promise<MarketData> {
    // Simulate realistic price movements: -5% to +5% per epoch
    const changes: Record<string, number> = { ETH: 0, BTC: 0, SOL: 0, MON: 0 };

    for (const asset of ['ETH', 'BTC', 'SOL', 'MON']) {
      // Random walk with slight mean reversion
      const volatility = asset === 'MON' ? 0.08 : 0.04; // MON is more volatile
      const change = (Math.random() - 0.48) * volatility * 2; // slight upward bias
      changes[asset] = change * 100; // as percentage
      this.prices[asset] = this.prices[asset] * (1 + change);
    }

    return {
      prices: { ...this.prices } as Record<'ETH' | 'BTC' | 'SOL' | 'MON', number>,
      changes: changes as Record<'ETH' | 'BTC' | 'SOL' | 'MON', number>,
      timestamp: Date.now(),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Display Functions
// ═══════════════════════════════════════════════════════════════════════════════

function printBanner(): void {
  console.log('');
  console.log(c('brightRed', '  ╔═══════════════════════════════════════════════════════════════╗'));
  console.log(c('brightRed', '  ║') + c('brightYellow', '     _   _ _   _ _   _  ____ _____ ____  _   _    _    ____  ____  ') + c('brightRed', '║'));
  console.log(c('brightRed', '  ║') + c('brightYellow', '    | | | | | | | \\ | |/ ___| ____|  _ \\| \\ | |  / \\  |  _ \\/ ___| ') + c('brightRed', '║'));
  console.log(c('brightRed', '  ║') + c('brightYellow', '    | |_| | | | |  \\| | |  _|  _| | |_) |  \\| | / _ \\ | | | \\___ \\ ') + c('brightRed', '║'));
  console.log(c('brightRed', '  ║') + c('brightYellow', '    |  _  | |_| | |\\  | |_| | |___|  _ <| |\\  |/ ___ \\| |_| |___) |') + c('brightRed', '║'));
  console.log(c('brightRed', '  ║') + c('brightYellow', '    |_| |_|\\___/|_| \\_|\\____|_____|_| \\_\\_| \\_/_/   \\_\\____/|____/ ') + c('brightRed', '║'));
  console.log(c('brightRed', '  ║') + c('gray', '                                                               ') + c('brightRed', '║'));
  console.log(c('brightRed', '  ║') + c('brightWhite', '          "May the nads be ever in your favor."              ') + c('brightRed', '  ║'));
  console.log(c('brightRed', '  ╚═══════════════════════════════════════════════════════════════╝'));
  console.log('');
}

function printSectionHeader(text: string): void {
  const line = '\u2550'.repeat(60);
  console.log('');
  console.log(c('brightYellow', `  ${line}`));
  console.log(c('brightYellow', `  \u2551 ${c('bold', text).padEnd(68)} \u2551`));
  console.log(c('brightYellow', `  ${line}`));
}

function printEpochHeader(epoch: number, maxEpochs: number): void {
  const line = '\u2550'.repeat(60);
  console.log('');
  console.log(c('brightWhite', `\u2554${line}\u2557`));
  console.log(c('brightWhite', `\u2551  ${c('bold', `EPOCH ${epoch}`)}${c('gray', ` / ${maxEpochs} max`)}${''.padEnd(38)}\u2551`));
  console.log(c('brightWhite', `\u255A${line}\u255D`));
}

function printMarketData(data: MarketData): void {
  console.log('');
  console.log(c('bold', '  MARKET DATA:'));

  for (const asset of ['ETH', 'BTC', 'SOL', 'MON'] as const) {
    const price = data.prices[asset];
    const change = data.changes[asset];
    const arrow = change > 0 ? '\u25B2' : change < 0 ? '\u25BC' : '\u25C6';
    const changeColor: keyof typeof C = change > 0 ? 'brightGreen' : change < 0 ? 'brightRed' : 'gray';
    const priceStr = asset === 'MON'
      ? `$${price.toFixed(4)}`
      : `$${price.toFixed(2)}`;
    const changeStr = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    console.log(`    ${c('brightWhite', asset.padEnd(4))} ${priceStr.padStart(12)} ${c(changeColor, `${arrow} ${changeStr}`)}`);
  }
}

function printAgentDecisions(
  result: EpochResult,
  agentLookup: Map<string, { name: string; class: string }>,
): void {
  console.log('');
  console.log(c('bold', '  AGENT DECISIONS:'));

  for (const [agentId, actions] of result.actions) {
    const info = agentLookup.get(agentId);
    if (!info) continue;

    const tag = agentTag(info.name, info.class);
    const pred = actions.prediction;
    const dirArrow = pred.direction === 'UP' ? c('green', '\u25B2 UP') : c('red', '\u25BC DN');
    let line = `    ${tag} ${c('white', 'predicts')} ${c('brightWhite', pred.asset)} ${dirArrow} ${c('yellow', `stake ${pred.stake}%`)}`;

    if (actions.attack) {
      line += ` ${c('brightRed', `\u2694\uFE0F ATK ${actions.attack.target} (${actions.attack.stake} HP)`)}`;
    }
    if (actions.defend) {
      line += ` ${c('brightGreen', '\uD83D\uDEE1\uFE0F DEF')}`;
    }

    console.log(line);

    // Truncated reasoning
    const reasoning = actions.reasoning.length > 80
      ? actions.reasoning.slice(0, 77) + '...'
      : actions.reasoning;
    console.log(`           ${c('gray', reasoning)}`);
  }
}

function printSecretaryCorrections(
  result: EpochResult,
  agentLookup: Map<string, { name: string; class: string }>,
): void {
  if (!result.secretaryReports) return;

  // Only print if any agent had corrections
  let hasCorrectionsToPrint = false;
  for (const [, report] of result.secretaryReports) {
    if (report.correctionCount > 0) {
      hasCorrectionsToPrint = true;
      break;
    }
  }
  if (!hasCorrectionsToPrint) return;

  console.log('');
  console.log(c('bold', '  SECRETARY CORRECTIONS:'));

  for (const [agentId, report] of result.secretaryReports) {
    if (report.correctionCount === 0) continue;
    const info = agentLookup.get(agentId);
    if (!info) continue;

    const tag = agentTag(info.name, info.class);
    const corrections = report.issues.filter(i => i.action !== 'KEPT');
    console.log(`    ${tag} ${c('yellow', `${corrections.length} correction(s):`)}`)

    for (const issue of corrections) {
      const actionLabel = issue.action === 'CORRECTED' ? c('yellow', 'FIX')
        : issue.action === 'REMOVED' ? c('gray', 'REM')
        : c('brightRed', 'DEF');
      console.log(`           [${actionLabel}] ${c('gray', `${issue.field}: ${issue.message}`)}`);
    }
  }
}

function printPredictionResults(
  result: EpochResult,
  agentLookup: Map<string, { name: string; class: string }>,
): void {
  console.log('');
  console.log(c('bold', '  PREDICTION RESULTS:'));

  for (const pr of result.predictionResults) {
    const info = agentLookup.get(pr.agentId);
    if (!info) continue;

    const tag = agentTag(info.name, info.class);
    const isFlat = pr.hpChange === 0;
    const icon = isFlat ? '\u25C6' : pr.correct ? '\u2705' : '\u274C';
    const resultText = isFlat
      ? c('gray', 'FLAT - no change')
      : pr.correct
        ? c('brightGreen', `CORRECT! +${pr.hpChange} HP`)
        : c('brightRed', `WRONG! ${pr.hpChange} HP`);
    const changeStr = `(${pr.asset} ${pr.actualChange >= 0 ? '+' : ''}${pr.actualChange.toFixed(2)}%)`;

    console.log(`    ${tag} predicted ${c('white', pr.asset)} ${pr.direction} ${c('gray', changeStr)} ${icon} ${resultText}`);
  }
}

function printCombatResults(
  result: EpochResult,
  agentLookup: Map<string, { name: string; class: string }>,
): void {
  if (result.combatResults.length === 0 && result.defendCosts.length === 0) return;

  console.log('');
  console.log(c('bold', '  COMBAT:'));

  for (const cr of result.combatResults) {
    const attacker = agentLookup.get(cr.attackerId);
    const target = agentLookup.get(cr.targetId);
    if (!attacker || !target) continue;

    const attackerTag = agentTag(attacker.name, attacker.class);
    const targetTag = agentTag(target.name, target.class);

    const betrayalTag = cr.betrayal ? c('brightRed', ' [BETRAYAL! 2x DMG]') : '';

    if (cr.defended) {
      console.log(
        `    ${attackerTag} ${c('brightRed', '\u2694\uFE0F attacks')} ${targetTag} for ${cr.attackStake} HP ` +
        `${c('brightGreen', '\u2192 BLOCKED!')} ${c('brightRed', `Attacker loses ${Math.abs(cr.hpTransfer)} HP`)}${betrayalTag}`,
      );
    } else {
      console.log(
        `    ${attackerTag} ${c('brightRed', '\u2694\uFE0F attacks')} ${targetTag} ` +
        `${c('brightRed', `\u2192 HIT! Stole ${cr.hpTransfer} HP`)}${betrayalTag}`,
      );
    }
  }

  for (const dc of result.defendCosts) {
    const info = agentLookup.get(dc.agentId);
    if (!info) continue;
    console.log(
      `    ${agentTag(info.name, info.class)} ${c('cyan', `\uD83D\uDEE1\uFE0F Defense cost: -${dc.cost} HP`)}`,
    );
  }
}

function printAllianceEvents(result: EpochResult): void {
  if (!result.allianceEvents || result.allianceEvents.length === 0) return;

  console.log('');
  console.log(c('bold', '  ALLIANCES:'));

  for (const evt of result.allianceEvents) {
    switch (evt.type) {
      case 'FORMED':
        console.log(
          `    ${c('cyan', '\uD83E\uDD1D')} ${c('brightCyan', evt.description)}`,
        );
        break;
      case 'BETRAYED':
        console.log(
          `    ${c('brightRed', '\uD83D\uDDE1\uFE0F')} ${c('brightRed', evt.description)}`,
        );
        break;
      case 'BROKEN':
        console.log(
          `    ${c('yellow', '\u26A0\uFE0F')} ${c('yellow', evt.description)}`,
        );
        break;
      case 'EXPIRED':
        console.log(
          `    ${c('gray', '\u23F3')} ${c('gray', evt.description)}`,
        );
        break;
      case 'PROPOSED':
        console.log(
          `    ${c('white', '\uD83D\uDCE8')} ${c('white', evt.description)}`,
        );
        break;
    }
  }
}

function printBleed(result: EpochResult): void {
  const totalBleed = result.bleedResults.reduce((sum, r) => sum + r.bleedAmount, 0);
  console.log('');
  console.log(`  ${c('gray', `\uD83E\uDE78 -2% bleed applied to all (total: -${Math.round(totalBleed)} HP drained)`)}`);
}

function printDeaths(result: EpochResult): void {
  if (result.deaths.length === 0) return;

  console.log('');
  for (const death of result.deaths) {
    const style = CLASS_STYLE[death.agentClass] ?? { icon: '?', color: 'white' as const };
    console.log(c('brightRed', '  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'));
    console.log(
      `  ${c('brightRed', '\uD83D\uDC80')} ${c('bold', c('brightRed', `${death.agentName} is REKT!`))} ` +
      `${c('gray', `(${death.cause})`)}`,
    );
    if (death.killerName) {
      console.log(`     ${c('gray', `Killed by: ${death.killerName}`)}`);
    }
    console.log(`     ${c('italic', c('gray', `"${death.finalWords}"`))}`)
    console.log(c('brightRed', '  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'));
  }
}

function printHPSummary(result: EpochResult): void {
  console.log('');
  console.log(c('bold', '  HP STANDINGS:'));

  // Sort: alive first (by HP desc), then dead
  const sorted = [...result.agentStates].sort((a, b) => {
    if (a.isAlive && !b.isAlive) return -1;
    if (!a.isAlive && b.isAlive) return 1;
    return b.hp - a.hp;
  });

  for (const agent of sorted) {
    const tag = agentTag(agent.name, agent.class);
    if (agent.isAlive) {
      const posStr = agent.position
        ? c('gray', ` @ (${agent.position.q},${agent.position.r})`)
        : '';
      console.log(`    ${tag} ${hpBar(agent.hp, 1000)}${posStr}`);
    } else {
      console.log(`    ${tag} ${c('gray', '\uD83D\uDC80 ELIMINATED')}`);
    }
  }
}

function printWinner(winner: { id: string; name: string; class: string }): void {
  const style = CLASS_STYLE[winner.class] ?? { icon: '?', color: 'white' as const };
  console.log('');
  console.log(c('brightYellow', '  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557'));
  console.log(c('brightYellow', '  \u2551') + '                                                        ' + c('brightYellow', '\u2551'));
  console.log(c('brightYellow', '  \u2551') + `   \uD83C\uDFC6 ${c('bold', c(style.color, `WINNER: ${style.icon} ${winner.name}`))} (${winner.class})` + ''.padEnd(20) + c('brightYellow', '\u2551'));
  console.log(c('brightYellow', '  \u2551') + '                                                        ' + c('brightYellow', '\u2551'));
  console.log(c('brightYellow', '  \u2551') + `   ${c('brightWhite', '"Last nad standing. Glory eternal."')}` + ''.padEnd(17) + c('brightYellow', '\u2551'));
  console.log(c('brightYellow', '  \u2551') + '                                                        ' + c('brightYellow', '\u2551'));
  console.log(c('brightYellow', '  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D'));
}

function printDraw(): void {
  console.log('');
  console.log(c('brightYellow', '  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557'));
  console.log(c('brightYellow', '  \u2551') + `   ${c('bold', 'MUTUAL ANNIHILATION - No survivors!')}` + ''.padEnd(19) + c('brightYellow', '\u2551'));
  console.log(c('brightYellow', '  \u2551') + `   ${c('gray', 'The arena claims all. The nads weep.')}` + ''.padEnd(18) + c('brightYellow', '\u2551'));
  console.log(c('brightYellow', '  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D'));
}

function printBattleStats(
  battleRecord: ReturnType<ArenaManager['completeBattle']>,
  epochHistory: EpochResult[],
  winnerId?: string,
): void {
  printSectionHeader('BATTLE STATISTICS');

  const { roster, epochCount, eliminations } = battleRecord;
  const duration = battleRecord.endedAt && battleRecord.startedAt
    ? ((new Date(battleRecord.endedAt).getTime() - new Date(battleRecord.startedAt).getTime()) / 1000).toFixed(1)
    : '?';

  console.log('');
  console.log(`  ${c('white', 'Epochs:')} ${epochCount}`);
  console.log(`  ${c('white', 'Duration:')} ${duration}s`);
  console.log(`  ${c('white', 'Eliminations:')} ${eliminations.length}`);
  console.log('');

  console.log(c('bold', '  FINAL ROSTER:'));
  for (const agent of roster) {
    const tag = agentTagBold(agent.agentName, agent.agentClass);
    const isWinner = agent.isAlive && agent.agentId === winnerId;
    const status = isWinner
      ? c('brightGreen', '\uD83C\uDFC6 WINNER')
      : agent.isAlive
        ? c('brightYellow', 'SURVIVED')
        : c('gray', `\uD83D\uDC80 Eliminated E${eliminations.find(e => e.agentId === agent.agentId)?.eliminatedAtEpoch ?? '?'}`);
    console.log(
      `    ${tag} ${status} | Kills: ${agent.kills} | Survived: ${agent.epochsSurvived} epochs | Final HP: ${agent.finalHp}`,
    );
  }

  // Elimination order
  if (eliminations.length > 0) {
    console.log('');
    console.log(c('bold', '  ELIMINATION ORDER:'));
    for (let i = 0; i < eliminations.length; i++) {
      const e = eliminations[i];
      const place = eliminations.length - i + 1;
      console.log(
        `    ${c('gray', `#${place}`)} ${agentTag(e.agentName, e.agentClass)} ${c('gray', `- Epoch ${e.eliminatedAtEpoch}`)}`,
      );
    }
  }
}

function printLessons(allLessons: Map<string, import('../src/agents/schemas').Lesson[]>, agentLookup: Map<string, { name: string; class: string }>): void {
  printSectionHeader('LESSONS LEARNED');

  for (const [agentId, lessons] of allLessons) {
    const info = agentLookup.get(agentId);
    if (!info) continue;

    console.log('');
    console.log(`  ${agentTagBold(info.name, info.class)}:`);

    for (const lesson of lessons) {
      console.log(`    ${c('cyan', '\u2022')} ${c('white', lesson.context)}`);
      console.log(`      ${c('gray', `Outcome: ${lesson.outcome}`)}`);
      console.log(`      ${c('brightCyan', `\u2192 ${lesson.learning}`)}`);
      if (lesson.applied) {
        console.log(`      ${c('green', `Applied: ${lesson.applied}`)}`);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Speed Control
// ═══════════════════════════════════════════════════════════════════════════════

function getEpochDelay(): number {
  const speed = process.env.BATTLE_SPEED?.toLowerCase() ?? 'fast';
  switch (speed) {
    case 'instant': return 0;
    case 'fast': return 500;
    case 'slow': return 2000;
    default: return 500;
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════════
// LLM Detection
// ═══════════════════════════════════════════════════════════════════════════════

function hasLLMKeys(): boolean {
  return !!(
    process.env.GROQ_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.OPENROUTER_API_KEY
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Final Words Generator (dramatic for CLI)
// ═══════════════════════════════════════════════════════════════════════════════

const FINAL_WORDS: Record<DeathCause, string[]> = {
  prediction: [
    'The market... it betrayed me...',
    'I should have gone the other way...',
    'My charts... they lied...',
    'The candles... they burned me alive...',
    'I was... the exit liquidity...',
    'Should have... DYOR...',
  ],
  combat: [
    'You fight without honor...',
    'I will be avenged...',
    'Tell them... I died fighting...',
    'This isn\'t over... *cough*... okay it\'s over.',
    'NGMI... literally...',
    'At least I didn\'t sell the bottom...',
  ],
  bleed: [
    'Time... is the cruelest enemy...',
    'The arena drains us all...',
    'Slowly... but surely... bled dry...',
    'Death by a thousand paper cuts...',
    'The 2%... it adds up...',
  ],
  multi: [
    'Everything hit at once...',
    'Death by a thousand cuts...',
    'They all came for me... at once...',
    'Hit from every direction... rekt...',
    'The perfect storm of NGMI...',
  ],
};

async function dramaticFinalWords(
  agent: ArenaAgentState,
  cause: DeathCause,
  _killerId?: string,
): Promise<string> {
  const pool = FINAL_WORDS[cause] ?? FINAL_WORDS.multi;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN BATTLE RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

async function runBattle(): Promise<void> {
  printBanner();

  // ── Detect mode ──────────────────────────────────────────────────────────
  const useLLM = hasLLMKeys();
  const mode = useLLM ? 'LLM' : 'SIMULATION';

  console.log(c('bold', `  Mode: ${mode === 'LLM' ? c('brightGreen', 'LLM-POWERED') : c('brightYellow', 'SIMULATION (mock decisions)')}`));
  if (!useLLM) {
    console.log(c('gray', '  Set GROQ_API_KEY, GOOGLE_API_KEY, or OPENROUTER_API_KEY for LLM mode'));
  }
  console.log(c('gray', `  Speed: ${process.env.BATTLE_SPEED ?? 'fast'} (set BATTLE_SPEED=instant|fast|slow)`));

  // ── Create arena ─────────────────────────────────────────────────────────
  const maxEpochs = 10;
  const arena = new ArenaManager(crypto.randomUUID(), { maxEpochs, epochIntervalMs: 0 });

  // ── Spawn agents ─────────────────────────────────────────────────────────
  arena.spawnAgents(); // Default: one of each class
  arena.startBattleImmediate();

  printSectionHeader('GLADIATORS ENTER THE ARENA');
  console.log('');

  const agents = arena.getAllAgents();
  for (const agent of agents) {
    const style = CLASS_STYLE[agent.agentClass] ?? { icon: '?', color: 'white' as const };
    const posStr = agent.position
      ? c('gray', `@ (${agent.position.q},${agent.position.r})`)
      : '';
    console.log(
      `  ${style.icon} ${c('bold', c(style.color, agent.name.padEnd(16)))} ` +
      `${c('white', agent.agentClass.padEnd(10))} ` +
      `${c('gray', `HP: ${agent.hp}/${agent.maxHp}`)} ${posStr}`,
    );
  }

  // ── Build agent lookup ───────────────────────────────────────────────────
  const agentLookup = new Map<string, { name: string; class: string }>();
  for (const agent of agents) {
    agentLookup.set(agent.id, { name: agent.name, class: agent.agentClass });
  }

  // ── Display initial arena grid ────────────────────────────────────────────
  let cornucopiaItemCount = 0;
  Array.from(arena.grid.tiles.values()).forEach(tile => {
    cornucopiaItemCount += tile.items.length;
  });
  printHexGrid(
    arena.grid,
    agentLookup,
    `ARENA MAP (19-tile hex grid \u2022 ${cornucopiaItemCount} cornucopia items spawned)`,
  );

  console.log('');
  console.log(c('gray', '  Agents spread across the outer ring. Cornucopia loot glitters in the center.'));
  console.log(c('gray', '  The crowd roars. The battle begins.'));

  // ── Price feed (simulated for mock mode, real for LLM mode) ──────────────
  // Use simulated prices always for the CLI - real Pyth prices are slow and
  // don't change enough between rapid epochs to be interesting
  const priceFeed = new SimulatedPriceFeed();

  // ── Battle loop ──────────────────────────────────────────────────────────
  const epochHistory: EpochResult[] = [];
  let previousMarketData: MarketData | undefined;
  const delay = getEpochDelay();

  // Suppress noisy console.error from LLM failures in simulation mode
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  if (!useLLM) {
    console.error = (..._args: unknown[]) => {}; // suppress
    console.warn = (..._args: unknown[]) => {}; // suppress
  }

  while (!arena.isComplete() && arena.epochCount < maxEpochs) {
    await sleep(delay);

    const result = await processEpoch(
      arena,
      priceFeed,
      previousMarketData,
      dramaticFinalWords,
    );

    epochHistory.push(result);
    previousMarketData = result.marketData;

    // Workaround: detect agents who died this epoch but weren't caught by
    // checkDeaths (engine bug: takeDamage sets isAlive=false before the
    // snapshot, so checkDeaths condition `hp <= 0 && isAlive` fails).
    // Record their elimination so battle stats are accurate.
    for (const agentState of result.agentStates) {
      if (!agentState.isAlive) {
        const agent = arena.getAgent(agentState.id);
        if (agent && !agent.alive()) {
          // eliminateAgent is idempotent (records only once)
          try {
            arena.eliminateAgent(agentState.id);
          } catch {
            // Already recorded or agent not found — ignore
          }
        }
      }
    }

    // Restore console temporarily for output
    if (!useLLM) {
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
    }

    // ── Print epoch play-by-play ──────────────────────────────────────────
    printEpochHeader(result.epochNumber, maxEpochs);
    printMarketData(result.marketData);

    // Movement phase (new: hex grid movement)
    printMovementPhase(result, agentLookup);

    // Item events (pickups, traps)
    printItemPickupPhase(result, agentLookup);

    printAgentDecisions(result, agentLookup);
    printSecretaryCorrections(result, agentLookup);
    printPredictionResults(result, agentLookup);
    printCombatResults(result, agentLookup);
    printAllianceEvents(result);

    // Item spawns (after combat)
    printItemSpawns(result);

    printBleed(result);

    // Buff expirations
    printBuffStatus(result, agentLookup);

    // Print deaths from the engine's death checker
    printDeaths(result);

    // Also detect agents who newly died this epoch but weren't caught by
    // the engine's checkDeaths (due to the isAlive timing bug). These are
    // agents whose HP is 0 and weren't alive in the previous epoch's states.
    const previousAlive = epochHistory.length >= 2
      ? new Set(epochHistory[epochHistory.length - 2].agentStates.filter(s => s.isAlive).map(s => s.id))
      : new Set(agents.map(a => a.id)); // first epoch: all were alive
    const engineDeathIds = new Set(result.deaths.map(d => d.agentId));

    for (const agentState of result.agentStates) {
      if (!agentState.isAlive && previousAlive.has(agentState.id) && !engineDeathIds.has(agentState.id)) {
        // This agent died this epoch but wasn't detected by checkDeaths
        const style = CLASS_STYLE[agentState.class] ?? { icon: '?', color: 'white' as const };
        const deathQuotes = [
          'The numbers... they don\'t add up anymore...',
          'I didn\'t think... the bleed... would...',
          'Tell the nads... I tried...',
          'The arena takes another...',
          'It\'s getting... so cold...',
        ];
        const quote = deathQuotes[Math.floor(Math.random() * deathQuotes.length)];
        console.log(c('brightRed', '  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'));
        console.log(
          `  ${c('brightRed', '\uD83D\uDC80')} ${c('bold', c('brightRed', `${agentState.name} is REKT!`))} ` +
          `${c('gray', '(attrition)')}`,
        );
        console.log(`     ${c('italic', c('gray', `"${quote}"`))}`)
        console.log(c('brightRed', '  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'));
      }
    }

    printHPSummary(result);

    // Render the hex grid after each epoch (shows current positions + items)
    printHexGrid(arena.grid, agentLookup);

    // Suppress again for next epoch
    if (!useLLM) {
      console.error = (..._args: unknown[]) => {};
      console.warn = (..._args: unknown[]) => {};
    }

    // Check for max epochs reached
    if (arena.epochCount >= maxEpochs && !arena.isComplete()) {
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      console.log('');
      console.log(c('brightYellow', '  \u231B MAX EPOCHS REACHED - Battle ends by timeout'));
      break;
    }
  }

  // Restore console
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;

  // ── Battle Complete ──────────────────────────────────────────────────────
  // Determine winner: if arena has a single survivor, use that. Otherwise
  // (timeout case), the agent with the most HP wins.
  let winner = arena.getWinner();
  if (!winner) {
    const activeAgents = arena.getActiveAgents();
    if (activeAgents.length > 0) {
      const best = activeAgents.sort((a, b) => b.hp - a.hp)[0];
      winner = best;
    }
  }

  const battleRecord = arena.completeBattle();

  if (winner) {
    printWinner({ id: winner.id, name: winner.name, class: winner.agentClass });
  } else {
    printDraw();
  }

  printBattleStats(battleRecord, epochHistory, winner?.id);

  // ── Extract Lessons ──────────────────────────────────────────────────────
  const agentInfos: AgentInfo[] = agents.map(a => ({
    id: a.id,
    name: a.name,
    class: a.agentClass,
  }));

  const battleHistory: BattleHistory = {
    battleId: arena.battleId,
    epochs: epochHistory,
  };

  // Mock LLM call for lesson extraction (uses fallback generator)
  const mockLLMCall: LLMCall = async (_system: string, _prompt: string) => {
    throw new Error('Mock mode - no LLM');
  };

  // Suppress error logs from fallback lesson generation
  const savedErr = console.error;
  console.error = (..._args: unknown[]) => {};
  const allLessons = await extractAllLessons(agentInfos, battleHistory, mockLLMCall);
  console.error = savedErr;

  printLessons(allLessons, agentLookup);

  // ── Footer ───────────────────────────────────────────────────────────────
  console.log('');
  console.log(c('gray', '  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'));
  console.log(c('brightWhite', '  HUNGERNADS - AI Gladiator Colosseum on Monad'));
  console.log(c('gray', '  "May the nads be ever in your favor."'));
  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════════════════════════════

runBattle().catch((err) => {
  console.error('\n\x1b[91mFATAL ERROR:\x1b[0m', err);
  process.exit(1);
});
