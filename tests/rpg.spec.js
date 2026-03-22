// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../rpg.html').replace(/\\/g, '/');

test.beforeEach(async ({ page }) => {
  await page.goto(FILE_URL);
  // Give the game loop a moment to initialise
  await page.waitForTimeout(500);
});

// ─── Page & structure ─────────────────────────────────────────────────────────

test('page title is correct', async ({ page }) => {
  await expect(page).toHaveTitle(/Thornwood Hollow/i);
});

test('game heading is visible', async ({ page }) => {
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('h1')).toContainText(/Thornwood Hollow/i);
});

test('main canvas is rendered', async ({ page }) => {
  const canvas = page.locator('#gc');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBe(800);
  expect(box?.height).toBe(560);
});

test('canvas has been painted (not blank)', async ({ page }) => {
  // Evaluate pixel data from the top-left region — should not be all-zero
  const hasPixels = await page.evaluate(() => {
    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('gc'));
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, 100, 100).data;
    return data.some(v => v !== 0);
  });
  expect(hasPixels).toBe(true);
});

// ─── UI overlay elements ──────────────────────────────────────────────────────

test('player frame is visible', async ({ page }) => {
  await expect(page.locator('#pf')).toBeVisible();
});

test('player frame shows character name', async ({ page }) => {
  const name = page.locator('#pf .frame-name').first();
  await expect(name).toBeVisible();
  const text = await name.textContent();
  expect(text?.trim().length).toBeGreaterThan(0);
});

test('player level indicator is visible', async ({ page }) => {
  await expect(page.locator('#pf .frame-level')).toBeVisible();
});

test('HP bar is visible in player frame', async ({ page }) => {
  await expect(page.locator('#pf .hp-fill')).toBeVisible();
});

test('MP/Rage bar element exists in player frame', async ({ page }) => {
  // The rage bar starts at 0% width (hidden) but the element must exist in the DOM
  await expect(page.locator('#pf .mp-fill')).toBeAttached();
});

test('action bar is visible', async ({ page }) => {
  await expect(page.locator('#ab')).toBeVisible();
});

test('action bar has ability slots', async ({ page }) => {
  const slots = page.locator('#ab .slot');
  const count = await slots.count();
  expect(count).toBeGreaterThan(0);
});

test('minimap canvas is visible', async ({ page }) => {
  await expect(page.locator('#mm')).toBeVisible();
});

test('combat log is visible', async ({ page }) => {
  await expect(page.locator('#log')).toBeVisible();
});

test('XP bar is present', async ({ page }) => {
  await expect(page.locator('#xpbar')).toBeVisible();
});

// ─── Keyboard input ───────────────────────────────────────────────────────────

test('player moves on WASD input', async ({ page }) => {
  // Capture canvas pixel snapshot before and after movement
  const before = await page.evaluate(() => {
    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('gc'));
    return canvas.toDataURL();
  });

  // Hold W for several frames
  await page.keyboard.down('w');
  await page.waitForTimeout(200);
  await page.keyboard.up('w');
  await page.waitForTimeout(100);

  const after = await page.evaluate(() => {
    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('gc'));
    return canvas.toDataURL();
  });

  expect(after).not.toBe(before);
});

test('arrow key input also changes canvas state', async ({ page }) => {
  const before = await page.evaluate(() => {
    return /** @type {HTMLCanvasElement} */ (document.getElementById('gc')).toDataURL();
  });

  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(200);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(100);

  const after = await page.evaluate(() => {
    return /** @type {HTMLCanvasElement} */ (document.getElementById('gc')).toDataURL();
  });

  expect(after).not.toBe(before);
});

// ─── Game state ───────────────────────────────────────────────────────────────

test('game object exists and is initialised', async ({ page }) => {
  // game is a top-level const — not on window, but accessible in page scope
  const gameExists = await page.evaluate(() => {
    try { return typeof game !== 'undefined'; } catch { return false; }
  });
  expect(gameExists).toBe(true);
});

test('player has positive HP at start', async ({ page }) => {
  const hp = await page.evaluate(() => {
    try { return game.player.hp; } catch { return 0; }
  });
  expect(hp).toBeGreaterThan(0);
});

test('player starts at level 1', async ({ page }) => {
  const level = await page.evaluate(() => {
    try { return game.player.level; } catch { return 0; }
  });
  expect(level).toBe(1);
});

test('enemies array is populated', async ({ page }) => {
  const count = await page.evaluate(() => {
    try { return game.enemies.length; } catch { return 0; }
  });
  expect(count).toBeGreaterThan(0);
});

test('game loop is running (tick increments)', async ({ page }) => {
  const tick1 = await page.evaluate(() => {
    try { return game.tick; } catch { return 0; }
  });
  await page.waitForTimeout(200);
  const tick2 = await page.evaluate(() => {
    try { return game.tick; } catch { return 0; }
  });
  expect(tick2).toBeGreaterThan(tick1);
});
