// Velora Bay round 4 — the entry program (Node 22, standard library
// only). It hands the game in exactly as the bounty asks: copy this
// repository's game/ (the playable open-world game, static files) and
// screenshots/ (four real renders of the game) to /output, and write
// /output/dossier.json with buildDossier from the kit's vendored
// vendor/makefun-game.ts.
//
// Run it locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// and play the game itself with `node serve.ts` (http://localhost:8080).
// The program runs twice in the grader and both runs must write the
// same bytes, so it copies files and nothing else: no timestamps, no
// randomness, no network. Screenshots are checked against the gate's
// own caps before the dossier is written, so a bad shot fails loudly
// here instead of silently at the gate.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps (reference/gate.json): game/ at most 993 files
// and directories and 48 MiB, every path at most 1000 bytes; 3-4
// screenshots at most 256 KiB each; the dossier at most 1.5 MiB with
// at most 160 KiB of source text. Refuse early when the tree would
// break them, so the failure names the file here, not on the site.
function checkGameTree(dir, depth = 0) {
  let files = 0;
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (!st.isFile() && !st.isDirectory()) throw new Error(`not a plain file: ${path}`);
    if (Buffer.byteLength(path, 'utf8') > 1000) throw new Error(`path too long: ${path}`);
    if (st.isDirectory()) {
      const sub = checkGameTree(path, depth + 1);
      files += sub.files; bytes += sub.bytes;
    } else {
      files += 1; bytes += st.size;
    }
  }
  return { files, bytes };
}

const gameStats = checkGameTree(join(here, 'game'));
if (gameStats.files > 993) throw new Error(`game/ has ${gameStats.files} files, over the 993 cap`);
if (gameStats.bytes > 48 * 1024 * 1024) throw new Error(`game/ is ${gameStats.bytes} bytes, over the 48 MiB cap`);

const shotDir = join(here, 'screenshots');
const shots = existsSync(shotDir)
  ? readdirSync(shotDir).filter((n) => !n.startsWith('.')).sort()
  : [];
if (shots.length < 3 || shots.length > 4) throw new Error(`screenshots/ needs 3 or 4 images, found ${shots.length}`);
for (const name of shots) {
  const size = statSync(join(shotDir, name)).size;
  if (size > 256 * 1024) throw new Error(`screenshot ${name} is ${size} bytes, over the 256 KiB cap`);
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(shotDir, join(out, 'screenshots'), { recursive: true });

// buildDossier writes the judge's view of the entry: the Game block,
// every source file, and the screenshots. Its bytes are the entry, so
// the same inputs must always give the same dossier — and they do,
// because the inputs are the repository's files alone.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

console.log(`Velora Bay round 4: game/ (${gameStats.files} files) + ${shots.length} screenshots -> ${out}`);
