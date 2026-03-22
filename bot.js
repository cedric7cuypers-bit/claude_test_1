// @ts-nocheck
/**
 * XP Grind Bot for Thornwood Hollow — with A* pathfinding
 * Run with: node bot.js
 */

const { chromium } = require('@playwright/test');
const path = require('path');

const FILE_URL    = 'file:///' + path.resolve(__dirname, 'games/rpg.html').replace(/\\/g, '/');
const TW          = 32;
const MELEE_RANGE = 52;   // px — stop walking, let auto-attack fire
const POTION_PCT  = 0.35; // drink potion below 35% HP
const TICK_MS     = 80;   // bot loop ms
const WAYPOINT_R  = 20;   // px — how close before advancing to next waypoint
const STUCK_TICKS = 25;   // ticks without moving before forcing a re-path

// ─── A* pathfinding (runs in Node, uses map data read from page) ──────────────

function astar(mapGrid, solidSet, cols, rows, sc, sr, ec, er) {
  const key  = (c, r) => r * cols + c;
  const h    = (c, r) => Math.abs(c - ec) + Math.abs(r - er);
  const open = new Map();
  const closed = new Set();

  open.set(key(sc, sr), { c: sc, r: sr, g: 0, f: h(sc, sr), parent: null });

  while (open.size > 0) {
    // Pick lowest-f node
    let cur = null, curKey = null;
    for (const [k, n] of open) {
      if (!cur || n.f < cur.f) { cur = n; curKey = k; }
    }

    if (cur.c === ec && cur.r === er) {
      const path = [];
      for (let n = cur; n; n = n.parent) path.unshift(n);
      return path;
    }

    open.delete(curKey);
    closed.add(curKey);

    const dirs = [
      [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
      [-1,-1, 1.414], [1,-1, 1.414], [-1, 1, 1.414], [1, 1, 1.414],
    ];

    for (const [dc, dr, cost] of dirs) {
      const nc = cur.c + dc, nr = cur.r + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      if (solidSet.has(mapGrid[nr][nc])) continue;

      // Block diagonal if either adjacent cardinal is solid (corner-cutting)
      const diag = dc !== 0 && dr !== 0;
      if (diag && (solidSet.has(mapGrid[cur.r][nc]) || solidSet.has(mapGrid[nr][cur.c]))) continue;

      const nk = key(nc, nr);
      if (closed.has(nk)) continue;

      const g = cur.g + cost;
      const ex = open.get(nk);
      if (!ex || g < ex.g) {
        open.set(nk, { c: nc, r: nr, g, f: g + h(nc, nr), parent: cur });
      }
    }
  }
  return null; // no path
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function readState(page) {
  return page.evaluate(() => {
    const p = game.player;
    return {
      px: p.x, py: p.y,
      hp: p.hp, maxHp: p.maxHp,
      potions: p.potions,
      xp: p.xp, level: p.level,
      dead: p.dead,
      enemies: game.enemies.map((e, i) => ({
        i, x: e.x, y: e.y, dead: e.dead, name: e.name, xpReward: e.xpReward,
      })),
    };
  });
}

async function readMap(page) {
  return page.evaluate(() => ({
    grid:   map.map(row => [...row]),
    solid:  [...SOLID],
    cols:   COLS,
    rows:   ROWS,
  }));
}

const held = { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false };

async function pressKeys(page, wantLeft, wantRight, wantUp, wantDown) {
  const want = { ArrowLeft: wantLeft, ArrowRight: wantRight, ArrowUp: wantUp, ArrowDown: wantDown };
  for (const [key, on] of Object.entries(want)) {
    if (on && !held[key])  { await page.keyboard.down(key); held[key] = true; }
    if (!on && held[key])  { await page.keyboard.up(key);   held[key] = false; }
  }
}

async function stopMoving(page) {
  await pressKeys(page, false, false, false, false);
}

async function spamAbilities(page) {
  for (const k of ['q', 'e', 'r']) {
    await page.keyboard.press(k);
    await sleep(20);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page    = await browser.newPage();
  await page.goto(FILE_URL);
  await page.waitForTimeout(1000);

  // Focus canvas
  await page.locator('#gc').click({ position: { x: 400, y: 280 } });
  await sleep(300);

  // Read map once — it never changes
  const { grid, solid, cols, rows } = await readMap(page);
  const solidSet = new Set(solid);

  let waypoints   = [];   // current A* path as [{c,r}]
  let lastTargetI = -1;   // which enemy we're chasing
  let stuckTicks  = 0;
  let lastPx = -1, lastPy = -1;
  let kills   = 0;
  let startXp = null;

  console.log('Bot started — A* pathfinding enabled');

  while (true) {
    const s = await readState(page);
    if (startXp === null) startXp = s.xp;

    // ── Dead — wait ──────────────────────────────────────────────────────
    if (s.dead) {
      await stopMoving(page);
      waypoints = []; lastTargetI = -1;
      console.log('Died — waiting for respawn...');
      await sleep(3000);
      continue;
    }

    // ── Potion ───────────────────────────────────────────────────────────
    if (s.potions > 0 && s.hp / s.maxHp < POTION_PCT) {
      await page.keyboard.press('f');
      console.log(`  Potion! HP ${s.hp}/${s.maxHp}`);
      await sleep(100);
    }

    // ── Find nearest alive enemy ──────────────────────────────────────────
    const alive = s.enemies.filter(e => !e.dead);
    if (alive.length === 0) {
      await stopMoving(page);
      console.log('No enemies — waiting...');
      await sleep(2000);
      continue;
    }

    const target = alive.reduce((best, e) =>
      Math.hypot(e.x - s.px, e.y - s.py) < Math.hypot(best.x - s.px, best.y - s.py) ? e : best
    );

    const dist = Math.hypot(target.x - s.px, target.y - s.py);

    // Set game target for auto-attack
    await page.evaluate(i => {
      const e = game.enemies[i];
      if (e && !e.dead) game.target = e;
    }, target.i);

    // ── In melee range — stand and fight ─────────────────────────────────
    if (dist <= MELEE_RANGE) {
      await stopMoving(page);
      await spamAbilities(page);
      waypoints = []; lastTargetI = target.i;
      stuckTicks = 0; lastPx = s.px; lastPy = s.py;

      // Log kill
      const newAlive = s.enemies.filter(e => !e.dead).length;
      if (newAlive < alive.length) {
        kills++;
        console.log(`Kill #${kills} — ${target.name} (+${target.xpReward} XP) | Total: ${s.xp - startXp} XP | Lv ${s.level}`);
      }

      await sleep(TICK_MS);
      continue;
    }

    // ── Need a path — compute A* if target changed or path empty ─────────
    if (target.i !== lastTargetI || waypoints.length === 0) {
      const pc = Math.floor(s.px / TW);
      const pr = Math.floor(s.py / TW);
      const ec = Math.floor(target.x / TW);
      const er = Math.floor(target.y / TW);

      // If the enemy's tile is solid (e.g. wolf inside a tree cluster),
    // spiral outward to find the nearest walkable tile to use as target
    let tc = ec, tr = er;
    if (solidSet.has(grid[tr]?.[tc] ?? 0)) {
      let found2 = false;
      outer: for (let radius = 1; radius <= 6; radius++) {
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
            const nc = ec + dc, nr = er + dr;
            if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
            if (!solidSet.has(grid[nr][nc])) { tc = nc; tr = nr; found2 = true; break outer; }
          }
        }
      }
      if (!found2) { waypoints = []; await sleep(TICK_MS); continue; }
    }

    const found = astar(grid, solidSet, cols, rows, pc, pr, tc, tr);
      if (found) {
        // Skip first node (current tile), convert to pixel centres
        waypoints = found.slice(1).map(n => ({ x: n.c * TW + TW / 2, y: n.r * TW + TW / 2 }));
      } else {
        waypoints = [];
        console.log('No path found — waiting...');
      }
      lastTargetI = target.i;
      stuckTicks = 0;
    }

    // ── Stuck detection — re-path if not moving ───────────────────────────
    if (Math.abs(s.px - lastPx) < 1 && Math.abs(s.py - lastPy) < 1) {
      stuckTicks++;
      if (stuckTicks >= STUCK_TICKS) {
        console.log('  Stuck — forcing re-path');
        waypoints = []; lastTargetI = -1; stuckTicks = 0;
      }
    } else {
      stuckTicks = 0;
    }
    lastPx = s.px; lastPy = s.py;

    // ── Follow waypoints ──────────────────────────────────────────────────
    if (waypoints.length > 0) {
      // Advance past waypoints we've already reached
      while (waypoints.length > 0 &&
             Math.hypot(waypoints[0].x - s.px, waypoints[0].y - s.py) < WAYPOINT_R) {
        waypoints.shift();
      }

      if (waypoints.length > 0) {
        const wp  = waypoints[0];
        const wdx = wp.x - s.px;
        const wdy = wp.y - s.py;
        await pressKeys(page, wdx < -4, wdx > 4, wdy < -4, wdy > 4);
      }
    } else {
      await stopMoving(page);
    }

    await sleep(TICK_MS);
  }
})();
