#!/usr/bin/env tsx
/**
 * HUNGERNADS - MP4 Battle Replay Generator
 *
 * Runs a full battle, extracts replay data, renders via Phaser 3 in a
 * headless browser (Puppeteer), captures frames, and encodes to MP4
 * via FFmpeg.
 *
 * Usage:
 *   npx tsx scripts/generate-replay.ts
 *   npx tsx scripts/generate-replay.ts --output replays/battle.mp4
 *   npx tsx scripts/generate-replay.ts --json replay-data.json   (skip battle, use existing data)
 *   npx tsx scripts/generate-replay.ts --html-only               (generate HTML, skip video)
 *   npx tsx scripts/generate-replay.ts --epoch-speed 2000         (ms per epoch, default 3000)
 *
 * Requirements:
 *   - puppeteer (npm i -D puppeteer)
 *   - ffmpeg installed system-wide (brew install ffmpeg / apt install ffmpeg)
 *
 * "May the nads be ever in your favor."
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn } from 'child_process';

import { ArenaManager } from '../src/arena/arena';
import { processEpoch, type EpochResult } from '../src/arena/epoch';
import { PriceFeed } from '../src/arena/price-feed';
import type { MarketData, ArenaAgentState } from '../src/agents/schemas';
import type { DeathCause } from '../src/arena/death';
import { extractReplayData } from '../src/replay/extract';
import { generateReplayHTML } from '../src/replay/html-template';
import type { ReplayData } from '../src/replay/types';

// ═══════════════════════════════════════════════════════════════════════════════
// ANSI Colors (minimal)
// ═══════════════════════════════════════════════════════════════════════════════

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

function log(msg: string): void {
  console.log(`  ${msg}`);
}

function logStep(step: string): void {
  console.log(`\n${C.cyan}[REPLAY]${C.reset} ${C.bold}${step}${C.reset}`);
}

function logSuccess(msg: string): void {
  console.log(`${C.green}[OK]${C.reset} ${msg}`);
}

function logError(msg: string): void {
  console.error(`${C.red}[ERROR]${C.reset} ${msg}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Simulated Price Feed (same as run-battle.ts)
// ═══════════════════════════════════════════════════════════════════════════════

class SimulatedPriceFeed extends PriceFeed {
  private prices: Record<string, number> = {
    ETH: 2450 + Math.random() * 200,
    BTC: 52000 + Math.random() * 5000,
    SOL: 105 + Math.random() * 20,
    MON: 0.75 + Math.random() * 0.3,
  };

  override async fetchPrices(): Promise<MarketData> {
    for (const asset of ['ETH', 'BTC', 'SOL', 'MON']) {
      const volatility = asset === 'MON' ? 0.08 : 0.04;
      const change = (Math.random() - 0.48) * volatility * 2;
      this.prices[asset] = this.prices[asset] * (1 + change);
    }

    const changes: Record<string, number> = {};
    for (const asset of ['ETH', 'BTC', 'SOL', 'MON']) {
      changes[asset] = (Math.random() - 0.48) * 8;
    }

    return {
      prices: { ...this.prices } as Record<'ETH' | 'BTC' | 'SOL' | 'MON', number>,
      changes: changes as Record<'ETH' | 'BTC' | 'SOL' | 'MON', number>,
      timestamp: Date.now(),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI Argument Parsing
// ═══════════════════════════════════════════════════════════════════════════════

interface CLIOptions {
  output: string;
  jsonInput?: string;
  htmlOnly: boolean;
  epochSpeed: number;
  width: number;
  height: number;
  fps: number;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const opts: CLIOptions = {
    output: 'replays/battle-replay.mp4',
    htmlOnly: false,
    epochSpeed: 3000,
    width: 800,
    height: 600,
    fps: 30,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--output':
      case '-o':
        opts.output = args[++i];
        break;
      case '--json':
        opts.jsonInput = args[++i];
        break;
      case '--html-only':
        opts.htmlOnly = true;
        break;
      case '--epoch-speed':
        opts.epochSpeed = parseInt(args[++i], 10);
        break;
      case '--width':
        opts.width = parseInt(args[++i], 10);
        break;
      case '--height':
        opts.height = parseInt(args[++i], 10);
        break;
      case '--fps':
        opts.fps = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`
${C.bold}HUNGERNADS - Battle Replay Generator${C.reset}

Generate MP4 replays of AI gladiator battles.

${C.bold}USAGE:${C.reset}
  npx tsx scripts/generate-replay.ts [options]

${C.bold}OPTIONS:${C.reset}
  --output, -o <path>     Output MP4 path (default: replays/battle-replay.mp4)
  --json <path>           Skip battle simulation, use existing replay JSON
  --html-only             Only generate HTML, skip Puppeteer/FFmpeg
  --epoch-speed <ms>      Milliseconds per epoch in replay (default: 3000)
  --width <px>            Canvas width (default: 800)
  --height <px>           Canvas height (default: 600)
  --fps <n>               Frames per second (default: 30)
  --help, -h              Show this help

${C.bold}REQUIREMENTS:${C.reset}
  - puppeteer: npm i -D puppeteer
  - ffmpeg: brew install ffmpeg (macOS) / apt install ffmpeg (Linux)

${C.bold}EXAMPLES:${C.reset}
  npx tsx scripts/generate-replay.ts
  npx tsx scripts/generate-replay.ts -o demo.mp4 --epoch-speed 2000
  npx tsx scripts/generate-replay.ts --html-only
  npx tsx scripts/generate-replay.ts --json saved-battle.json

"May the nads be ever in your favor."
`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 1: Run Battle (or load from JSON)
// ═══════════════════════════════════════════════════════════════════════════════

async function runBattle(): Promise<ReplayData> {
  logStep('Running battle simulation...');

  const maxEpochs = 50;
  const arena = new ArenaManager(crypto.randomUUID(), { maxEpochs, epochIntervalMs: 0 });
  arena.spawnAgents();
  arena.startBattleImmediate();

  const agents = arena.getAllAgents();
  log(`${C.dim}Spawned ${agents.length} agents: ${agents.map(a => `${a.name} (${a.agentClass})`).join(', ')}${C.reset}`);

  const priceFeed = new SimulatedPriceFeed();
  const epochHistory: EpochResult[] = [];
  let previousMarketData: MarketData | undefined;

  // Suppress console noise from simulation
  const origErr = console.error;
  const origWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};

  const dramaticFinalWords = async (
    _agent: ArenaAgentState,
    cause: DeathCause,
  ): Promise<string> => {
    const lines: Record<string, string[]> = {
      prediction: ['The market betrayed me...', 'Should have DYOR...'],
      combat: ['You fight without honor...', 'I will be avenged...'],
      bleed: ['Time is the cruelest enemy...', 'Bled dry...'],
      multi: ['Everything hit at once...', 'NGMI... literally...'],
    };
    const pool = lines[cause] ?? lines.multi;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  let epochNum = 0;
  while (!arena.isComplete() && arena.epochCount < maxEpochs) {
    const result = await processEpoch(arena, priceFeed, previousMarketData, dramaticFinalWords);
    epochHistory.push(result);
    previousMarketData = result.marketData;
    epochNum++;

    // Handle death edge cases (same as run-battle.ts)
    for (const agentState of result.agentStates) {
      if (!agentState.isAlive) {
        try { arena.eliminateAgent(agentState.id); } catch {}
      }
    }
  }

  console.error = origErr;
  console.warn = origWarn;

  // Determine winner
  let winner = arena.getWinner();
  if (!winner) {
    const activeAgents = arena.getActiveAgents();
    if (activeAgents.length > 0) {
      winner = activeAgents.sort((a, b) => b.hp - a.hp)[0];
    }
  }

  try {
    arena.completeBattle();
  } catch {
    // Already completed
  }

  log(`${C.green}Battle complete:${C.reset} ${epochNum} epochs`);
  if (winner) {
    log(`${C.yellow}Winner: ${winner.name} (${winner.agentClass})${C.reset}`);
  } else {
    log(`${C.red}Mutual annihilation - no winner${C.reset}`);
  }

  // Extract replay data
  const replayData = extractReplayData(
    arena.battleId,
    agents,
    epochHistory,
    winner?.id ?? null,
    arena.startedAt?.toISOString() ?? new Date().toISOString(),
  );

  return replayData;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 2: Generate HTML
// ═══════════════════════════════════════════════════════════════════════════════

function generateHTML(
  replayData: ReplayData,
  opts: CLIOptions,
): string {
  logStep('Generating Phaser 3 HTML template...');

  const html = generateReplayHTML(replayData, {
    width: opts.width,
    height: opts.height,
    epochDurationMs: opts.epochSpeed,
  });

  log(`${C.dim}Canvas: ${opts.width}x${opts.height}, ${opts.epochSpeed}ms/epoch${C.reset}`);
  return html;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 3: Capture frames with Puppeteer
// ═══════════════════════════════════════════════════════════════════════════════

async function captureFrames(
  htmlPath: string,
  framesDir: string,
  opts: CLIOptions,
): Promise<number> {
  logStep('Launching headless browser (Puppeteer)...');

  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    logError('puppeteer is not installed. Run: npm i -D puppeteer');
    logError('Or use --html-only to just generate the HTML.');
    process.exit(1);
  }

  const browser = await puppeteer.default.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      `--window-size=${opts.width},${opts.height}`,
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: opts.width, height: opts.height });

  // Load the HTML file
  const fileUrl = `file://${htmlPath}`;
  log(`${C.dim}Loading: ${fileUrl}${C.reset}`);
  await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });

  // Wait for Phaser to initialize
  await page.waitForFunction('window.__currentFrame !== undefined', { timeout: 10000 });
  log('Phaser scene initialized.');

  // Capture frames until replay is done
  let frameIndex = 0;
  const frameDurationMs = 1000 / opts.fps;
  const maxFrames = Math.ceil(
    (2 + (opts.epochSpeed / 1000) * 50 + 3) * opts.fps, // generous max
  );

  log(`Capturing frames at ${opts.fps} FPS...`);

  while (frameIndex < maxFrames) {
    const isDone = await page.evaluate('window.__replayDone');
    if (isDone) break;

    const framePath = path.join(framesDir, `frame_${String(frameIndex).padStart(5, '0')}.png`);
    await page.screenshot({
      path: framePath,
      type: 'png',
      clip: { x: 0, y: 0, width: opts.width, height: opts.height },
    });

    frameIndex++;

    // Wait for next frame timing
    await new Promise((resolve) => setTimeout(resolve, frameDurationMs));

    // Progress indicator
    if (frameIndex % 30 === 0) {
      process.stdout.write(`\r  ${C.dim}Captured ${frameIndex} frames...${C.reset}`);
    }
  }

  // Capture a few more frames after done signal for the winner screen
  for (let extra = 0; extra < opts.fps * 2; extra++) {
    const framePath = path.join(framesDir, `frame_${String(frameIndex).padStart(5, '0')}.png`);
    await page.screenshot({
      path: framePath,
      type: 'png',
      clip: { x: 0, y: 0, width: opts.width, height: opts.height },
    });
    frameIndex++;
    await new Promise((resolve) => setTimeout(resolve, frameDurationMs));
  }

  console.log(''); // Clear progress line
  log(`${C.green}Captured ${frameIndex} frames.${C.reset}`);

  await browser.close();
  return frameIndex;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 4: Encode with FFmpeg
// ═══════════════════════════════════════════════════════════════════════════════

async function encodeMP4(
  framesDir: string,
  outputPath: string,
  fps: number,
): Promise<void> {
  logStep('Encoding MP4 with FFmpeg...');

  // Check if FFmpeg is available
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
  } catch {
    logError('ffmpeg is not installed.');
    logError('Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)');
    process.exit(1);
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const framePattern = path.join(framesDir, 'frame_%05d.png');

  const ffmpegArgs = [
    '-y', // overwrite output
    '-framerate', String(fps),
    '-i', framePattern,
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-crf', '23',
    '-preset', 'medium',
    outputPath,
  ];

  log(`${C.dim}ffmpeg ${ffmpegArgs.join(' ')}${C.reset}`);

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ffmpegArgs, { stdio: 'pipe' });

    let stderr = '';
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        logError(`FFmpeg exited with code ${code}`);
        logError(stderr.slice(-500));
        reject(new Error(`FFmpeg failed with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('');
  console.log(`${C.yellow}${C.bold}  HUNGERNADS - Battle Replay Generator${C.reset}`);
  console.log(`${C.gray}  "May the nads be ever in your favor."${C.reset}`);
  console.log('');

  const opts = parseArgs();

  // Step 1: Get replay data
  let replayData: ReplayData;

  if (opts.jsonInput) {
    logStep(`Loading replay data from ${opts.jsonInput}...`);
    const raw = fs.readFileSync(opts.jsonInput, 'utf-8');
    replayData = JSON.parse(raw);
    log(`${C.green}Loaded ${replayData.totalEpochs} epochs.${C.reset}`);
  } else {
    replayData = await runBattle();
  }

  // Step 2: Generate HTML
  const html = generateHTML(replayData, opts);

  // Create temp directory for working files
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hungernads-replay-'));
  const htmlPath = path.join(tmpDir, 'replay.html');
  const framesDir = path.join(tmpDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });

  // Write HTML
  fs.writeFileSync(htmlPath, html);
  log(`HTML written to: ${htmlPath}`);

  // Save replay JSON alongside output for reproducibility
  const outputDir = path.dirname(opts.output);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const jsonPath = opts.output.replace(/\.mp4$/, '.json');
  fs.writeFileSync(jsonPath, JSON.stringify(replayData, null, 2));
  log(`Replay data saved: ${jsonPath}`);

  if (opts.htmlOnly) {
    // Copy HTML to output location
    const htmlOutputPath = opts.output.replace(/\.mp4$/, '.html');
    fs.copyFileSync(htmlPath, htmlOutputPath);
    logSuccess(`HTML replay saved to: ${htmlOutputPath}`);
    logSuccess('Open in a browser to preview the replay.');
    cleanup(tmpDir);
    return;
  }

  // Step 3: Capture frames
  const frameCount = await captureFrames(htmlPath, framesDir, opts);

  if (frameCount === 0) {
    logError('No frames captured. Something went wrong with the Phaser scene.');
    cleanup(tmpDir);
    process.exit(1);
  }

  // Step 4: Encode MP4
  await encodeMP4(framesDir, opts.output, opts.fps);

  // Get file size
  const stats = fs.statSync(opts.output);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  logSuccess(`MP4 replay saved: ${opts.output} (${sizeMB} MB, ${frameCount} frames)`);

  // Also save HTML alongside for preview
  const htmlOutputPath = opts.output.replace(/\.mp4$/, '.html');
  fs.copyFileSync(htmlPath, htmlOutputPath);
  log(`${C.dim}HTML preview saved: ${htmlOutputPath}${C.reset}`);

  // Cleanup
  cleanup(tmpDir);

  console.log('');
  console.log(`${C.yellow}${C.bold}  Replay generation complete!${C.reset}`);
  console.log(`${C.gray}  "The arena remembers all."${C.reset}`);
  console.log('');
}

function cleanup(tmpDir: string): void {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════════════════════════════

main().catch((err) => {
  logError(String(err));
  process.exit(1);
});
