/**
 * HUNGERNADS - Phaser 3 Replay HTML Template
 *
 * Generates a self-contained HTML page that embeds Phaser 3 (via CDN)
 * and battle replay data. The Phaser scene auto-plays the battle epoch
 * by epoch, rendering:
 *
 *   - 7-hex arena (flat-top honeycomb)
 *   - Agent circles with class icons and HP bars
 *   - Attack lines (red), defend shields (cyan), deaths (skull flash)
 *   - Event ticker at the bottom
 *   - Epoch counter and title at the top
 *
 * The page exposes a global `window.__replayDone` flag so Puppeteer
 * knows when to stop capturing frames.
 */

import type { ReplayData } from './types';

// ---------------------------------------------------------------------------
// Colors per agent class (matches dashboard theme)
// ---------------------------------------------------------------------------

const CLASS_COLORS: Record<string, string> = {
  WARRIOR: '#ef4444',   // red-500
  TRADER: '#06b6d4',    // cyan-500
  SURVIVOR: '#22c55e',  // green-500
  PARASITE: '#a855f7',  // purple-500
  GAMBLER: '#eab308',   // yellow-500
};

const CLASS_LETTERS: Record<string, string> = {
  WARRIOR: 'W',
  TRADER: 'T',
  SURVIVOR: 'S',
  PARASITE: 'P',
  GAMBLER: 'G',
};

// ---------------------------------------------------------------------------
// Template Generator
// ---------------------------------------------------------------------------

/**
 * Generate the self-contained HTML page for replay rendering.
 *
 * @param data - The extracted ReplayData from a completed battle
 * @param options - Rendering options
 * @returns HTML string ready to be written to disk or served
 */
export function generateReplayHTML(
  data: ReplayData,
  options: {
    width?: number;
    height?: number;
    /** Milliseconds per epoch (controls replay speed). */
    epochDurationMs?: number;
    /** Phaser 3 CDN URL. */
    phaserCdnUrl?: string;
  } = {},
): string {
  const {
    width = 800,
    height = 600,
    epochDurationMs = 3000,
    phaserCdnUrl = 'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js',
  } = options;

  const serializedData = JSON.stringify(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>HUNGERNADS - Battle Replay</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0f;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      overflow: hidden;
    }
    #game-container {
      width: ${width}px;
      height: ${height}px;
    }
  </style>
</head>
<body>
  <div id="game-container"></div>
  <script src="${phaserCdnUrl}"></script>
  <script>
    // ═══ EMBEDDED REPLAY DATA ═══
    const REPLAY_DATA = ${serializedData};
    const EPOCH_DURATION = ${epochDurationMs};
    const CANVAS_W = ${width};
    const CANVAS_H = ${height};

    // Signal to Puppeteer that replay is done
    window.__replayDone = false;
    window.__currentFrame = 0;
    window.__totalFrames = 0;

    // ═══ CLASS STYLING ═══
    const CLASS_COLORS = ${JSON.stringify(CLASS_COLORS)};
    const CLASS_LETTERS = ${JSON.stringify(CLASS_LETTERS)};

    // ═══ HEX GRID LAYOUT ═══
    // 7-hex flat-top honeycomb. We convert axial (q, r) to pixel.
    const HEX_SIZE = 55; // radius of each hex
    const GRID_CENTER_X = CANVAS_W / 2;
    const GRID_CENTER_Y = CANVAS_H / 2 - 20; // shifted up for event ticker

    function axialToPixel(q, r) {
      const x = HEX_SIZE * (3/2 * q);
      const y = HEX_SIZE * (Math.sqrt(3)/2 * q + Math.sqrt(3) * r);
      return { x: GRID_CENTER_X + x, y: GRID_CENTER_Y + y };
    }

    // ═══ PHASER SCENE ═══
    class ReplayScene extends Phaser.Scene {
      constructor() {
        super({ key: 'ReplayScene' });
        this.currentEpochIndex = -1; // -1 = showing roster
        this.animPhase = 'idle'; // 'idle' | 'showing_events' | 'transitioning'
        this.agentSprites = {};
        this.hpBars = {};
        this.nameTexts = {};
        this.eventTexts = [];
        this.attackLines = [];
        this.phaseTimer = 0;
        this.frameCount = 0;
      }

      create() {
        // Background
        this.cameras.main.setBackgroundColor('#0a0a0f');

        // Draw hex grid (static)
        this.drawHexGrid();

        // Title bar
        this.titleText = this.add.text(CANVAS_W / 2, 20, 'HUNGERNADS', {
          fontSize: '24px',
          fontFamily: 'monospace',
          color: '#fbbf24',
          fontStyle: 'bold',
        }).setOrigin(0.5);

        this.subtitleText = this.add.text(CANVAS_W / 2, 44, '"May the nads be ever in your favor."', {
          fontSize: '11px',
          fontFamily: 'monospace',
          color: '#6b7280',
          fontStyle: 'italic',
        }).setOrigin(0.5);

        // Epoch counter
        this.epochText = this.add.text(CANVAS_W - 20, 20, '', {
          fontSize: '16px',
          fontFamily: 'monospace',
          color: '#9ca3af',
        }).setOrigin(1, 0);

        // Event ticker area (bottom)
        this.tickerBg = this.add.rectangle(
          CANVAS_W / 2, CANVAS_H - 50, CANVAS_W - 20, 80, 0x111118, 0.9
        );
        this.tickerBg.setStrokeStyle(1, 0x374151);

        // Initialize agents at roster positions
        this.initAgents();

        // Calculate total frames
        const epochCount = REPLAY_DATA.epochs.length;
        // roster (2s) + per-epoch (epochDuration) + winner (3s)
        const fps = 30;
        window.__totalFrames = Math.ceil(
          (2 + epochCount * (EPOCH_DURATION / 1000) + 3) * fps
        );

        // Start the replay sequence
        this.time.delayedCall(2000, () => this.nextEpoch());
      }

      drawHexGrid() {
        const hexes = [
          {q:0,r:0}, {q:1,r:0}, {q:0,r:1}, {q:-1,r:1},
          {q:-1,r:0}, {q:0,r:-1}, {q:1,r:-1}
        ];

        const graphics = this.add.graphics();

        for (const hex of hexes) {
          const {x, y} = axialToPixel(hex.q, hex.r);
          // Draw hex outline
          graphics.lineStyle(1.5, 0x1e293b, 0.6);
          graphics.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 180) * (60 * i);
            const hx = x + (HEX_SIZE - 4) * Math.cos(angle);
            const hy = y + (HEX_SIZE - 4) * Math.sin(angle);
            if (i === 0) graphics.moveTo(hx, hy);
            else graphics.lineTo(hx, hy);
          }
          graphics.closePath();
          graphics.strokePath();

          // Subtle fill
          graphics.fillStyle(0x0f172a, 0.3);
          graphics.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 180) * (60 * i);
            const hx = x + (HEX_SIZE - 5) * Math.cos(angle);
            const hy = y + (HEX_SIZE - 5) * Math.sin(angle);
            if (i === 0) graphics.moveTo(hx, hy);
            else graphics.lineTo(hx, hy);
          }
          graphics.closePath();
          graphics.fillPath();
        }
      }

      initAgents() {
        const roster = REPLAY_DATA.roster;
        for (const agent of roster) {
          const pos = agent.position || {q: 0, r: 0};
          const {x, y} = axialToPixel(pos.q, pos.r);
          const color = CLASS_COLORS[agent.class] || '#ffffff';
          const colorNum = parseInt(color.slice(1), 16);

          // Agent circle
          const circle = this.add.circle(x, y, 18, colorNum, 0.85);
          circle.setStrokeStyle(2, 0xffffff, 0.3);
          this.agentSprites[agent.id] = circle;

          // Class letter
          const letter = this.add.text(x, y, CLASS_LETTERS[agent.class] || '?', {
            fontSize: '16px',
            fontFamily: 'monospace',
            color: '#ffffff',
            fontStyle: 'bold',
          }).setOrigin(0.5);
          // Store as child reference
          circle.setData('letterText', letter);

          // Name
          const nameText = this.add.text(x, y + 26, agent.name, {
            fontSize: '9px',
            fontFamily: 'monospace',
            color: '#d1d5db',
          }).setOrigin(0.5);
          this.nameTexts[agent.id] = nameText;

          // HP bar background
          const barWidth = 40;
          const barHeight = 4;
          const barBg = this.add.rectangle(x, y + 36, barWidth, barHeight, 0x374151);
          const barFill = this.add.rectangle(
            x - barWidth/2, y + 36, barWidth, barHeight, colorNum
          );
          barFill.setOrigin(0, 0.5);
          this.hpBars[agent.id] = { bg: barBg, fill: barFill, maxWidth: barWidth };
        }
      }

      nextEpoch() {
        this.currentEpochIndex++;

        if (this.currentEpochIndex >= REPLAY_DATA.epochs.length) {
          // Battle over - show winner
          this.showWinner();
          return;
        }

        const epoch = REPLAY_DATA.epochs[this.currentEpochIndex];
        this.epochText.setText('EPOCH ' + epoch.epochNumber + ' / ' + REPLAY_DATA.totalEpochs);

        // Clear previous event visuals
        this.clearEventVisuals();

        // Update agent positions and HP
        this.updateAgents(epoch.agents);

        // Show events with staggered timing
        this.showEvents(epoch.events);

        // Schedule next epoch
        this.time.delayedCall(EPOCH_DURATION, () => this.nextEpoch());
      }

      updateAgents(agents) {
        for (const agent of agents) {
          const circle = this.agentSprites[agent.id];
          if (!circle) continue;

          const pos = agent.position || {q: 0, r: 0};
          const {x, y} = axialToPixel(pos.q, pos.r);

          // Animate position change
          this.tweens.add({
            targets: circle,
            x: x,
            y: y,
            duration: 400,
            ease: 'Power2',
          });

          // Move letter text
          const letterText = circle.getData('letterText');
          if (letterText) {
            this.tweens.add({
              targets: letterText,
              x: x,
              y: y,
              duration: 400,
              ease: 'Power2',
            });
          }

          // Move name
          const nameText = this.nameTexts[agent.id];
          if (nameText) {
            this.tweens.add({
              targets: nameText,
              x: x,
              y: y + 26,
              duration: 400,
              ease: 'Power2',
            });
          }

          // Update HP bar
          const hpBar = this.hpBars[agent.id];
          if (hpBar) {
            const ratio = Math.max(0, agent.hp / agent.maxHp);
            const newWidth = Math.max(0, hpBar.maxWidth * ratio);

            // Animate HP bar position
            this.tweens.add({
              targets: hpBar.bg,
              x: x,
              y: y + 36,
              duration: 400,
              ease: 'Power2',
            });

            this.tweens.add({
              targets: hpBar.fill,
              x: x - hpBar.maxWidth / 2,
              y: y + 36,
              duration: 400,
              ease: 'Power2',
            });

            // Animate HP bar width
            this.tweens.add({
              targets: hpBar.fill,
              displayWidth: newWidth,
              duration: 600,
              ease: 'Power2',
            });

            // Change color based on HP
            let barColor;
            if (ratio > 0.6) barColor = 0x22c55e;
            else if (ratio > 0.3) barColor = 0xeab308;
            else barColor = 0xef4444;
            hpBar.fill.setFillStyle(barColor);
          }

          // Handle death: fade out
          if (!agent.isAlive) {
            this.tweens.add({
              targets: circle,
              alpha: 0.15,
              duration: 800,
              ease: 'Power2',
            });
            if (letterText) {
              this.tweens.add({
                targets: letterText,
                alpha: 0.15,
                duration: 800,
                ease: 'Power2',
              });
            }
            if (nameText) {
              this.tweens.add({
                targets: nameText,
                alpha: 0.3,
                duration: 800,
                ease: 'Power2',
              });
            }
          }
        }
      }

      showEvents(events) {
        // Filter to most dramatic events (max 4 for readability)
        const prioritized = this.prioritizeEvents(events).slice(0, 4);

        // Show attack/combat lines
        for (const evt of events) {
          if ((evt.type === 'attack' || evt.type === 'betrayal') && evt.targetId) {
            this.drawAttackLine(evt.agentId, evt.targetId, evt.type === 'betrayal');
          }
          if (evt.type === 'attack_blocked' && evt.targetId) {
            this.drawShield(evt.targetId);
          }
          if (evt.type === 'death') {
            this.showDeathEffect(evt.agentId);
          }
        }

        // Event ticker text
        const tickerY = CANVAS_H - 75;
        for (let i = 0; i < prioritized.length; i++) {
          const evt = prioritized[i];
          let color = '#9ca3af';
          if (evt.type === 'death') color = '#ef4444';
          else if (evt.type === 'attack' || evt.type === 'betrayal') color = '#f97316';
          else if (evt.type === 'prediction_correct') color = '#22c55e';
          else if (evt.type === 'prediction_wrong') color = '#ef4444';
          else if (evt.type === 'skill_activation') color = '#a855f7';
          else if (evt.type === 'alliance_formed') color = '#06b6d4';

          const truncated = evt.text.length > 80 ? evt.text.slice(0, 77) + '...' : evt.text;

          const txt = this.add.text(30, tickerY + i * 16, truncated, {
            fontSize: '11px',
            fontFamily: 'monospace',
            color: color,
          });
          txt.setAlpha(0);
          this.tweens.add({
            targets: txt,
            alpha: 1,
            duration: 300,
            delay: i * 200,
          });
          this.eventTexts.push(txt);
        }
      }

      prioritizeEvents(events) {
        const priority = {
          death: 0,
          betrayal: 1,
          skill_activation: 2,
          attack: 3,
          attack_blocked: 4,
          prediction_correct: 5,
          prediction_wrong: 5,
          alliance_formed: 6,
          alliance_broken: 6,
          defend: 7,
          move: 8,
        };
        return [...events].sort(
          (a, b) => (priority[a.type] ?? 99) - (priority[b.type] ?? 99)
        );
      }

      drawAttackLine(attackerId, targetId, isBetrayal) {
        const attacker = this.agentSprites[attackerId];
        const target = this.agentSprites[targetId];
        if (!attacker || !target) return;

        const graphics = this.add.graphics();
        const color = isBetrayal ? 0xff0000 : 0xf97316;
        const lineWidth = isBetrayal ? 3 : 2;

        graphics.lineStyle(lineWidth, color, 0.8);
        graphics.beginPath();
        graphics.moveTo(attacker.x, attacker.y);
        graphics.lineTo(target.x, target.y);
        graphics.strokePath();

        // Arrow head at target
        const angle = Math.atan2(target.y - attacker.y, target.x - attacker.x);
        const arrowSize = 8;
        graphics.fillStyle(color, 0.8);
        graphics.beginPath();
        graphics.moveTo(
          target.x - 20 * Math.cos(angle),
          target.y - 20 * Math.sin(angle)
        );
        graphics.lineTo(
          target.x - 20 * Math.cos(angle) - arrowSize * Math.cos(angle - 0.5),
          target.y - 20 * Math.sin(angle) - arrowSize * Math.sin(angle - 0.5)
        );
        graphics.lineTo(
          target.x - 20 * Math.cos(angle) - arrowSize * Math.cos(angle + 0.5),
          target.y - 20 * Math.sin(angle) - arrowSize * Math.sin(angle + 0.5)
        );
        graphics.closePath();
        graphics.fillPath();

        // Fade out attack line
        this.tweens.add({
          targets: graphics,
          alpha: 0,
          duration: 1500,
          delay: 500,
          onComplete: () => graphics.destroy(),
        });

        this.attackLines.push(graphics);
      }

      drawShield(agentId) {
        const circle = this.agentSprites[agentId];
        if (!circle) return;

        const shield = this.add.circle(circle.x, circle.y, 28, 0x06b6d4, 0.3);
        shield.setStrokeStyle(2, 0x06b6d4, 0.8);

        this.tweens.add({
          targets: shield,
          alpha: 0,
          scaleX: 1.5,
          scaleY: 1.5,
          duration: 1000,
          ease: 'Power2',
          onComplete: () => shield.destroy(),
        });
      }

      showDeathEffect(agentId) {
        const circle = this.agentSprites[agentId];
        if (!circle) return;

        // Red flash
        const flash = this.add.circle(circle.x, circle.y, 30, 0xff0000, 0.7);
        this.tweens.add({
          targets: flash,
          alpha: 0,
          scaleX: 2,
          scaleY: 2,
          duration: 800,
          ease: 'Power2',
          onComplete: () => flash.destroy(),
        });

        // Skull emoji text
        const skull = this.add.text(circle.x, circle.y - 10, 'REKT', {
          fontSize: '14px',
          fontFamily: 'monospace',
          color: '#ef4444',
          fontStyle: 'bold',
        }).setOrigin(0.5);

        this.tweens.add({
          targets: skull,
          y: circle.y - 40,
          alpha: 0,
          duration: 1500,
          ease: 'Power2',
          onComplete: () => skull.destroy(),
        });
      }

      showWinner() {
        this.clearEventVisuals();

        if (REPLAY_DATA.winner) {
          const winner = REPLAY_DATA.winner;
          const color = CLASS_COLORS[winner.class] || '#fbbf24';

          // Darken everything
          const overlay = this.add.rectangle(CANVAS_W/2, CANVAS_H/2, CANVAS_W, CANVAS_H, 0x000000, 0.5);

          // Winner announcement
          this.add.text(CANVAS_W/2, CANVAS_H/2 - 40, 'WINNER', {
            fontSize: '36px',
            fontFamily: 'monospace',
            color: '#fbbf24',
            fontStyle: 'bold',
          }).setOrigin(0.5);

          this.add.text(CANVAS_W/2, CANVAS_H/2 + 10, winner.name, {
            fontSize: '28px',
            fontFamily: 'monospace',
            color: color,
            fontStyle: 'bold',
          }).setOrigin(0.5);

          this.add.text(CANVAS_W/2, CANVAS_H/2 + 45, '(' + winner.class + ')', {
            fontSize: '16px',
            fontFamily: 'monospace',
            color: '#9ca3af',
          }).setOrigin(0.5);

          this.add.text(CANVAS_W/2, CANVAS_H/2 + 75, '"Last nad standing. Glory eternal."', {
            fontSize: '12px',
            fontFamily: 'monospace',
            color: '#6b7280',
            fontStyle: 'italic',
          }).setOrigin(0.5);
        } else {
          const overlay = this.add.rectangle(CANVAS_W/2, CANVAS_H/2, CANVAS_W, CANVAS_H, 0x000000, 0.5);
          this.add.text(CANVAS_W/2, CANVAS_H/2, 'MUTUAL ANNIHILATION', {
            fontSize: '28px',
            fontFamily: 'monospace',
            color: '#ef4444',
            fontStyle: 'bold',
          }).setOrigin(0.5);
          this.add.text(CANVAS_W/2, CANVAS_H/2 + 35, 'The arena claims all. The nads weep.', {
            fontSize: '12px',
            fontFamily: 'monospace',
            color: '#6b7280',
            fontStyle: 'italic',
          }).setOrigin(0.5);
        }

        // Mark replay as done after 3 seconds
        this.time.delayedCall(3000, () => {
          window.__replayDone = true;
        });
      }

      clearEventVisuals() {
        for (const txt of this.eventTexts) {
          txt.destroy();
        }
        this.eventTexts = [];

        for (const line of this.attackLines) {
          if (line && !line.scene) continue; // already destroyed
          try { line.destroy(); } catch {}
        }
        this.attackLines = [];
      }

      update() {
        this.frameCount++;
        window.__currentFrame = this.frameCount;
      }
    }

    // ═══ PHASER CONFIG ═══
    const config = {
      type: Phaser.CANVAS,
      width: CANVAS_W,
      height: CANVAS_H,
      parent: 'game-container',
      scene: ReplayScene,
      backgroundColor: '#0a0a0f',
      banner: false,
      audio: { noAudio: true },
      fps: {
        target: 30,
        forceSetTimeOut: true,
      },
      render: {
        antialias: true,
        pixelArt: false,
      },
    };

    const game = new Phaser.Game(config);
  </script>
</body>
</html>`;
}
