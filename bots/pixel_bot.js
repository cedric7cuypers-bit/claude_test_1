// @ts-nocheck
/**
 * Pixel Bot for Thornwood Hollow
 * Visual-only bot — reads enemy positions from canvas pixels, HP from DOM style.
 * State machine: WANDER → APPROACH → FIGHT
 * Once in FIGHT it stays put, stops moving, and spams abilities until the
 * enemy has been invisible for several ticks (dead/fled).
 * Run with: node bots/pixel_bot.js
 */

const { chromium } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../games/rpg.html').replace(/\\/g, '/');
const TICK_MS  = 150;

// ── Player is always at the canvas centre (camera follows player) ─────────────
const PLAYER_SCREEN = { x: 400, y: 280 };

// ── Enemy detection colours (from rpg.html sprite code) ──────────────────────
//   Wolf:   #ffcc00  yellow eyes
//   Bandit: #ff4040  red eyes
//   Treant: #ff8000  orange eyes
// Skip treant (boss, 350HP) — pixel bot can't pathfind around walls to reach it
const ENEMY_MARKERS = [
  { name: 'wolf',   r: [230,255], g: [180,220], b: [0,30]  },
  { name: 'bandit', r: [230,255], g: [20,90],   b: [20,90] },
];

const SCAN_STEP     = 2;    // every 2px — eyes are 2-3px wide
const CLUSTER_DIST  = 48;   // px — merge nearby hits into one cluster
const MIN_HITS      = 2;    // need at least 2 matching pixels to count as an enemy

// How close (screen px) before we enter FIGHT mode
// Auto-attack fires at dist<60 game px — screen px maps 1:1 to game px
const ENGAGE_RANGE  = 75;
// Prefer enemies under this distance; only go for far ones if nothing closer
const PREFER_RANGE  = 250;
// We exit FIGHT only after the enemy has been missing for this many ticks
const FIGHT_LEEWAY  = 12;
// Give up approaching a target if dist hasn't improved after this many ticks
const STUCK_TICKS   = 20;
// Potion threshold
const POTION_PCT    = 0.35;
// Wander: switch direction every N ticks
const WANDER_SWITCH = 15;

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Run color matching + HUD read inside the browser — only transfer results */
async function scanAndReadHUD(page, markers, step, clusterDist, minHits) {
  return page.evaluate(({ markers, step, clusterDist, minHits }) => {
    // HUD
    const bar = document.getElementById('pf-hp');
    const tf  = document.getElementById('tf');
    const hpPct     = bar ? parseFloat(bar.style.width) / 100 : 1;
    const hasTarget = tf  ? tf.style.display !== 'none' : false;

    // Pixel scan — all done in-browser, no data transfer
    const c   = document.getElementById('gc');
    const ctx = c.getContext('2d');
    const w   = c.width;
    const sy  = 110, ey = 490;
    const id  = ctx.getImageData(0, sy, w, ey - sy);
    const d   = id.data;
    const h   = ey - sy;

    const hits = [];
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const r = d[i], g = d[i+1], b = d[i+2];
        for (const m of markers) {
          if (r >= m.r0 && r <= m.r1 && g >= m.g0 && g <= m.g1 && b >= m.b0 && b <= m.b1) {
            hits.push({ x, y: y + sy, name: m.name });
            break;
          }
        }
      }
    }

    // Cluster in-browser too
    const clusters = [];
    for (const h of hits) {
      const near = clusters.find(c => c.name === h.name &&
        Math.sqrt((c.x-h.x)*(c.x-h.x) + (c.y-h.y)*(c.y-h.y)) < clusterDist);
      if (near) {
        near.x = (near.x * near.n + h.x) / (near.n + 1);
        near.y = (near.y * near.n + h.y) / (near.n + 1);
        near.n++;
      } else {
        clusters.push({ x: h.x, y: h.y, name: h.name, n: 1 });
      }
    }

    return {
      hpPct, hasTarget,
      enemies: clusters.filter(c => c.n >= minHits),
    };
  }, {
    markers: markers.map(m => ({ name: m.name, r0: m.r[0], r1: m.r[1], g0: m.g[0], g1: m.g[1], b0: m.b[0], b1: m.b[1] })),
    step, clusterDist, minHits,
  });
}

const held = { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false };

async function pressKeys(page, L, R, U, D) {
  const want = { ArrowLeft: L, ArrowRight: R, ArrowUp: U, ArrowDown: D };
  for (const [key, on] of Object.entries(want)) {
    if (on  && !held[key]) { await page.keyboard.down(key); held[key] = true;  }
    if (!on &&  held[key]) { await page.keyboard.up(key);   held[key] = false; }
  }
}

async function stopMoving(page) {
  await pressKeys(page, false, false, false, false);
}

async function spamAbilities(page) {
  for (const k of ['q','w','e','r']) {
    await page.keyboard.press(k);
    await sleep(25);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

let browser;
process.on('SIGINT',  () => { browser?.close().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { browser?.close().finally(() => process.exit(0)); });

(async () => {
  browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(FILE_URL);
  await page.waitForTimeout(1200);

  await page.locator('#gc').click({ position: { x: 400, y: 280 } });
  await sleep(300);

  const canvasBox = await page.locator('#gc').boundingBox();

  // ── State machine ─────────────────────────────────────────────────────────
  // WANDER  — no enemies visible, moving around to find one
  // APPROACH — enemy spotted, walking toward it
  // FIGHT   — in range, standing still and fighting
  let state        = 'WANDER';
  let missingTicks = 0;
  let approachTicks = 0;
  let bestDist     = Infinity;
  let wanderDir    = Math.floor(Math.random() * 4);
  let wanderTick   = 0;
  let ticks        = 0;
  let lastHp       = 1; // track HP to detect taking damage

  console.log('Pixel Bot started  [WANDER → APPROACH → FIGHT]');

  while (true) {
    ticks++;
    try {

    // ── Combined HUD + pixel scan (all in-browser, minimal data transfer) ──
    const scan = await scanAndReadHUD(page, ENEMY_MARKERS, SCAN_STEP, CLUSTER_DIST, MIN_HITS);
    const hud = scan;
    const enemies = scan.enemies;

    // Damage detection
    const takingDamage = ticks > 5 && hud.hpPct > 0 && lastHp > 0.05 && hud.hpPct < lastHp - 0.02;
    lastHp = hud.hpPct > 0 ? hud.hpPct : lastHp;

    if (takingDamage) {
      await stopMoving(page);
      if (state !== 'FIGHT') { state = 'FIGHT'; missingTicks = 0; console.log(`→ FIGHT (taking damage! HP=${Math.round(hud.hpPct*100)}%)`); }
    }

    if (hud.hpPct < POTION_PCT && hud.hpPct > 0) {
      await page.keyboard.press('f');
      console.log(`  [POTION] HP ~${Math.round(hud.hpPct*100)}%`);
    }

    // Pick target: prefer enemies within PREFER_RANGE, fall back to nearest overall
    let target = null;
    if (enemies.length > 0) {
      const sorted = enemies.slice().sort((a,b) =>
        Math.hypot(a.x-PLAYER_SCREEN.x, a.y-PLAYER_SCREEN.y) -
        Math.hypot(b.x-PLAYER_SCREEN.x, b.y-PLAYER_SCREEN.y));
      const nearby = sorted.filter(e => Math.hypot(e.x-PLAYER_SCREEN.x, e.y-PLAYER_SCREEN.y) <= PREFER_RANGE);
      target = nearby.length > 0 ? nearby[0] : sorted[0];
    }
    const dist = target ? Math.hypot(target.x-PLAYER_SCREEN.x, target.y-PLAYER_SCREEN.y) : Infinity;

    // ── State transitions ─────────────────────────────────────────────────
    if (state === 'WANDER') {
      if (target && dist <= PREFER_RANGE) {
        state = dist <= ENGAGE_RANGE ? 'FIGHT' : 'APPROACH';
        missingTicks = 0; approachTicks = 0; bestDist = dist;
        console.log(`→ ${state}  ${target.name} dist=${Math.round(dist)}`);
      }
    } else if (state === 'APPROACH') {
      if (!target) {
        missingTicks++;
        if (missingTicks > 5) { state = 'WANDER'; approachTicks = 0; bestDist = Infinity; console.log('→ WANDER (lost target)'); }
      } else {
        missingTicks = 0;
        approachTicks++;
        if (dist < bestDist) bestDist = dist;
        // Stuck: been approaching a long time and dist hasn't improved
        if (approachTicks > STUCK_TICKS && dist > bestDist + 20) {
          console.log(`→ WANDER (stuck, best=${Math.round(bestDist)} cur=${Math.round(dist)})`);
          state = 'WANDER'; approachTicks = 0; bestDist = Infinity;
        } else if (dist <= ENGAGE_RANGE) {
          state = 'FIGHT'; approachTicks = 0; bestDist = Infinity;
          console.log(`→ FIGHT  ${target.name} dist=${Math.round(dist)}`);
        }
      }
    } else if (state === 'FIGHT') {
      // No enemy nearby — count missing ticks
      if (!target || dist > ENGAGE_RANGE) {
        missingTicks++;
        if (missingTicks >= FIGHT_LEEWAY) {
          state = 'WANDER';
          missingTicks = 0;
          console.log('→ WANDER (enemy gone)');
        }
      } else {
        missingTicks = 0;
      }
    }

    // Always stop moving when in FIGHT — do this before any other action
    if (state === 'FIGHT') await stopMoving(page);

    // ── Actions per state ─────────────────────────────────────────────────
    if (state === 'WANDER') {
      wanderTick++;
      // Switch direction every 6 ticks so it never runs one way for long
      if (wanderTick % 6 === 0) {
        wanderDir = (wanderDir + 1) % 4;
        const dirs = ['R','D','L','U'];
        console.log(`[WANDER] → ${dirs[wanderDir]}`);
      }
      const dirs4 = [
        [false,true, false,false],  // R
        [false,false,false,true ],  // D
        [true, false,false,false],  // L
        [false,false,true, false],  // U
      ];
      await pressKeys(page, ...dirs4[wanderDir]);

    } else if (state === 'APPROACH' && target) {
      const dx = target.x - PLAYER_SCREEN.x;
      const dy = target.y - PLAYER_SCREEN.y;
      await pressKeys(page, dx < -6, dx > 6, dy < -6, dy > 6);
      // Click once to pre-select target for auto-attack (only if not already selected)
      if (!hud.hasTarget) await page.mouse.click(canvasBox.x + target.x, canvasBox.y + target.y);
      console.log(`[APPROACH] ${target.name}  dist=${Math.round(dist)}  target=${hud.hasTarget?'YES':'no'}`);

    } else if (state === 'FIGHT') {
      // FIGHT = stop moving. Always. No exceptions.
      await stopMoving(page);
      // Only click to select target if target frame is NOT visible (lost selection)
      // Clicking when already selected risks misclicking and DESELECTING
      if (target && !hud.hasTarget) {
        await page.mouse.click(canvasBox.x + target.x, canvasBox.y + target.y);
        console.log(`  [click] selecting ${target.name} (target frame was gone)`);
      }
      await spamAbilities(page);
      if (ticks % 4 === 0) {
        console.log(`[FIGHT]  dist=${Math.round(dist)}  HP=${Math.round(hud.hpPct*100)}%  target=${hud.hasTarget?'YES':'no'}  missing=${missingTicks}`);
      }
    }

    await sleep(TICK_MS);
    } catch (err) {
      if (err.message.includes('closed') || err.message.includes('crashed')) {
        console.log('Browser closed — exiting.');
        break;
      }
      console.log(`  [error] ${err.message} — retrying...`);
      await sleep(500);
    }
  }
  await browser?.close().catch(() => {});
})();
