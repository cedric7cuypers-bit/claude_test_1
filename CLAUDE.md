# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git workflow

After every commit, always push to GitHub:
```bash
git push
```

Remote: `https://github.com/cedric7cuypers-bit/claude_test_1.git`

## Running the projects

All projects are plain HTML/CSS/JS — no build step or package manager. Open any file directly in a browser:

- `games/tictactoe.html` — open directly in browser
- `games/rpg.html` — open directly in browser
- `projects/hello-world/index.html` — open directly in browser (requires `style.css` and `app.js` in the same folder)

For `projects/hello-world/` specifically, since `app.js` is a separate file, it must be served (not opened as `file://`) to avoid CORS issues in some browsers:
```bash
npx serve "projects/hello-world"
# or
python -m http.server 8080 --directory "projects/hello-world"
```

## Project structure

```
games/
  tictactoe.html     — Self-contained two-player Tic Tac Toe
  rpg.html           — Top-down 2D RPG "Thornwood Hollow"
projects/
  hello-world/       — Minimal Hello World app (index.html + style.css + app.js)
tests/
  tictactoe.spec.js  — 20 Playwright tests for tictactoe
  rpg.spec.js        — 22 Playwright tests for the RPG
bot.js               — XP grind bot for the RPG (A* pathfinding, Playwright)
bots/
  pixel_bot.js       — Visual pixel bot (reads canvas pixels, no game-state JS)
CLAUDE.md
package.json / playwright.config.js / jsconfig.json
```

- **`games/tictactoe.html`** — State held in `board[]`, `current`, `scores`; no persistence.
- **`games/rpg.html`** — Canvas-based, tile map (50×35), all game state in `game` object. Enemy spawns validated by `snapToWalkable()` so no NPC lands on a solid tile.
- **`tests/`** — Run with `npx playwright test`. Uses `file://` URLs, no server needed.
- **`bot.js`** — Run with `node bot.js`. Reads `game` state directly, A* paths around walls/trees, spams abilities, drinks potions below 35% HP.
- **`bots/pixel_bot.js`** — Visual pixel bot: detects HP bar, enemies, and cooldowns from raw canvas pixels (no JS game-state reads). Run with `node bots/pixel_bot.js`.
- **`package.json`** / **`playwright.config.js`** — Playwright setup. Install deps with `npm install` then `npx playwright install chromium`.

## rpg.html architecture

The RPG is the most complex file. Key sections in order:

1. **Constants & tile types** — `T` object defines tile IDs; `SOLID` set drives collision
2. **`buildMap()`** — Procedurally fills the `map[][]` array (grass base → water border → tree clusters → hand-placed village/paths/buildings)
3. **Sprite drawing functions** — `drawPlayer`, `drawWolf`, `drawBandit`, `drawTreant` each draw directly to the main canvas using `ctx.save/restore` + `ctx.translate`
4. **Entity system** — `makeEnemy(type, col, row)` factory; enemies hold their own AI state (`idle/aggro/return`), timers, and stats
5. **`update()`** — Main simulation tick: player input → ability cooldowns → auto-attack → enemy AI → camera
6. **`draw()`** — Renders tiles (only visible viewport), shadows, entities sorted by Y for depth, floating damage numbers, minimap
7. **UI** — HTML/CSS overlay (`#ui`) updated imperatively by `updatePlayerFrame()`, `updateTargetFrame()`, `updateCooldownUI()`
8. **Game loop** — `requestAnimationFrame(loop)` drives both `update()` and `draw()` each frame
