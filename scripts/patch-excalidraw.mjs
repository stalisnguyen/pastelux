/*
 * Makes the Excalidraw grid a backdrop only, like Miro: it is still drawn,
 * but moving, resizing and arrow-key nudges no longer jump to grid cells.
 * Alignment comes from object snapping instead (guides to edges, centres
 * and equal gaps), which the board turns on.
 *
 * Excalidraw has one switch for "draw the grid" and "snap to the grid";
 * the snapping side goes through App.getEffectiveGridSize(), so that one
 * method is changed to always say "no grid". Runs after every install.
 * Excalidraw is pinned to 0.18.1; if a new version changes this code the
 * script stops the install loudly instead of shipping a board that snaps.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../node_modules/@excalidraw/excalidraw/dist/', import.meta.url));
const patches = [
  {
    file: 'dev/index.js',
    from: 'return isGridModeEnabled(this) ? this.state.gridSize : null;',
    to: 'return null; /* pastelux: grid is a backdrop, never snaps */',
  },
  {
    file: 'prod/index.js',
    from: 'C(this,"getEffectiveGridSize",()=>gn(this)?this.state.gridSize:null)',
    to: 'C(this,"getEffectiveGridSize",()=>null)',
  },
];

let failed = false;
for (const p of patches) {
  const path = root + p.file;
  const src = readFileSync(path, 'utf8');
  if (src.includes(p.to)) {
    console.log(`excalidraw patch: ${p.file} already patched`);
    continue;
  }
  const n = src.split(p.from).length - 1;
  if (n !== 1) {
    console.error(`excalidraw patch: expected the grid-snap code once in ${p.file}, found it ${n} times`);
    failed = true;
    continue;
  }
  writeFileSync(path, src.replace(p.from, p.to));
  console.log(`excalidraw patch: ${p.file} patched`);
}
if (failed) process.exit(1);
