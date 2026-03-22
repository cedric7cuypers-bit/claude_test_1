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

- `tictactoe.html` — open directly in browser
- `rpg.html` — open directly in browser
- `project 1/index.html` — open directly in browser (requires `style.css` and `app.js` in the same folder)

For `project 1/` specifically, since `app.js` is a separate file, it must be served (not opened as `file://`) to avoid CORS issues in some browsers:
```bash
npx serve "project 1"
# or
python -m http.server 8080 --directory "project 1"
```

## Project structure

- **`tictactoe.html`** — Self-contained two-player Tic Tac Toe. All logic, styles, and markup in one file. State is held in `board[]`, `current`, and `scores` variables; no persistence.
- **`rpg.html`** — Self-contained top-down 2D RPG ("Thornwood Hollow"). Canvas-based rendering with a tile map (50×35), animated sprite drawing via canvas primitives, entity AI, and WoW-style UI overlaid with HTML/CSS. All game state lives in the `game` object. No build step, no dependencies.
- **`project 1/`** — Minimal "Hello World" app split across `index.html`, `style.css`, and `app.js`.

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
