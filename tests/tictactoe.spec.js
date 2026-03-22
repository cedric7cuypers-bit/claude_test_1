// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../tictactoe.html').replace(/\\/g, '/');

test.beforeEach(async ({ page }) => {
  await page.goto(FILE_URL);
});

// ─── Initial state ────────────────────────────────────────────────────────────

test('page title is "Tic Tac Toe"', async ({ page }) => {
  await expect(page).toHaveTitle('Tic Tac Toe');
});

test('heading is visible', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('TIC TAC TOE');
});

test('status starts as Player X\'s turn', async ({ page }) => {
  await expect(page.locator('#status')).toHaveText("Player X's turn");
});

test('board has 9 empty cells', async ({ page }) => {
  const cells = page.locator('.cell');
  await expect(cells).toHaveCount(9);
  for (let i = 0; i < 9; i++) {
    await expect(cells.nth(i)).toHaveText('');
  }
});

test('all scores start at 0', async ({ page }) => {
  await expect(page.locator('#score-x')).toHaveText('0');
  await expect(page.locator('#score-o')).toHaveText('0');
  await expect(page.locator('#score-d')).toHaveText('0');
});

test('New Game button is visible', async ({ page }) => {
  await expect(page.locator('#restart')).toBeVisible();
});

// ─── Turn mechanics ───────────────────────────────────────────────────────────

test('clicking a cell places X on first move', async ({ page }) => {
  await page.locator('[data-i="0"]').click();
  await expect(page.locator('[data-i="0"]')).toHaveText('X');
});

test('status switches to Player O after X moves', async ({ page }) => {
  await page.locator('[data-i="0"]').click();
  await expect(page.locator('#status')).toHaveText("Player O's turn");
});

test('second click places O', async ({ page }) => {
  await page.locator('[data-i="0"]').click();
  await page.locator('[data-i="1"]').click();
  await expect(page.locator('[data-i="1"]')).toHaveText('O');
});

test('clicking an already-taken cell does nothing', async ({ page }) => {
  await page.locator('[data-i="4"]').click(); // X
  await page.locator('[data-i="4"]').click(); // should be ignored
  await expect(page.locator('[data-i="4"]')).toHaveText('X');
  await expect(page.locator('#status')).toHaveText("Player O's turn");
});

// ─── Win detection ────────────────────────────────────────────────────────────

test('X wins with top row (0-1-2)', async ({ page }) => {
  // X: 0,1,2  O: 3,4
  await page.locator('[data-i="0"]').click(); // X
  await page.locator('[data-i="3"]').click(); // O
  await page.locator('[data-i="1"]').click(); // X
  await page.locator('[data-i="4"]').click(); // O
  await page.locator('[data-i="2"]').click(); // X wins
  await expect(page.locator('#status')).toHaveText('Player X wins!');
});

test('O wins with middle column (1-4-7)', async ({ page }) => {
  // X: 0,2,5  O: 1,4,7
  await page.locator('[data-i="0"]').click(); // X
  await page.locator('[data-i="1"]').click(); // O
  await page.locator('[data-i="2"]').click(); // X
  await page.locator('[data-i="4"]').click(); // O
  await page.locator('[data-i="5"]').click(); // X
  await page.locator('[data-i="7"]').click(); // O wins
  await expect(page.locator('#status')).toHaveText('Player O wins!');
});

test('X wins with diagonal (0-4-8)', async ({ page }) => {
  // X: 0,4,8  O: 1,2
  await page.locator('[data-i="0"]').click(); // X
  await page.locator('[data-i="1"]').click(); // O
  await page.locator('[data-i="4"]').click(); // X
  await page.locator('[data-i="2"]').click(); // O
  await page.locator('[data-i="8"]').click(); // X wins
  await expect(page.locator('#status')).toHaveText('Player X wins!');
});

test('win cells get the "win" CSS class', async ({ page }) => {
  await page.locator('[data-i="0"]').click();
  await page.locator('[data-i="3"]').click();
  await page.locator('[data-i="1"]').click();
  await page.locator('[data-i="4"]').click();
  await page.locator('[data-i="2"]').click(); // X wins 0-1-2
  for (const i of [0, 1, 2]) {
    await expect(page.locator(`[data-i="${i}"]`)).toHaveClass(/win/);
  }
});

test('no more moves accepted after a win', async ({ page }) => {
  await page.locator('[data-i="0"]').click();
  await page.locator('[data-i="3"]').click();
  await page.locator('[data-i="1"]').click();
  await page.locator('[data-i="4"]').click();
  await page.locator('[data-i="2"]').click(); // X wins
  await page.locator('[data-i="5"]').click(); // should be ignored
  await expect(page.locator('[data-i="5"]')).toHaveText('');
});

// ─── Score tracking ───────────────────────────────────────────────────────────

test('X win increments X score', async ({ page }) => {
  await page.locator('[data-i="0"]').click();
  await page.locator('[data-i="3"]').click();
  await page.locator('[data-i="1"]').click();
  await page.locator('[data-i="4"]').click();
  await page.locator('[data-i="2"]').click();
  await expect(page.locator('#score-x')).toHaveText('1');
  await expect(page.locator('#score-o')).toHaveText('0');
});

test('O win increments O score', async ({ page }) => {
  await page.locator('[data-i="0"]').click();
  await page.locator('[data-i="1"]').click();
  await page.locator('[data-i="2"]').click();
  await page.locator('[data-i="4"]').click();
  await page.locator('[data-i="5"]').click();
  await page.locator('[data-i="7"]').click(); // O wins
  await expect(page.locator('#score-o')).toHaveText('1');
  await expect(page.locator('#score-x')).toHaveText('0');
});

// ─── Draw detection ───────────────────────────────────────────────────────────

test('draw is detected and draw score increments', async ({ page }) => {
  // X O X
  // X X O
  // O X O  — no winner
  const moves = [0, 1, 2, 5, 3, 8, 4, 6, 7]; // alternates X/O
  for (const i of moves) {
    await page.locator(`[data-i="${i}"]`).click();
  }
  await expect(page.locator('#status')).toHaveText("It's a draw!");
  await expect(page.locator('#score-d')).toHaveText('1');
});

// ─── Restart ──────────────────────────────────────────────────────────────────

test('New Game clears the board', async ({ page }) => {
  await page.locator('[data-i="0"]').click();
  await page.locator('[data-i="1"]').click();
  await page.locator('#restart').click();
  const cells = page.locator('.cell');
  for (let i = 0; i < 9; i++) {
    await expect(cells.nth(i)).toHaveText('');
  }
});

test('New Game resets status to Player X\'s turn', async ({ page }) => {
  await page.locator('[data-i="0"]').click();
  await page.locator('#restart').click();
  await expect(page.locator('#status')).toHaveText("Player X's turn");
});

test('scores persist across New Game', async ({ page }) => {
  // win one game then restart
  await page.locator('[data-i="0"]').click();
  await page.locator('[data-i="3"]').click();
  await page.locator('[data-i="1"]').click();
  await page.locator('[data-i="4"]').click();
  await page.locator('[data-i="2"]').click(); // X wins
  await page.locator('#restart').click();
  await expect(page.locator('#score-x')).toHaveText('1'); // score retained
});
