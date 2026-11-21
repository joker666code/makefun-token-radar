// Token Radar lane 4A — entrypoint (Node 22, standard library only).
//
//   node main.ts --input <snapshot.json|dir> [--output <dir>]
//
// Reads the sealed snapshot, ranks every rankable pre-token protocol with the
// model in lib/model.ts, and writes the submission shape:
//   board.json      the ranked board (rows: rank, slug, name, implied value,
//                   farm steps, plus the model breakdown the page shows)
//   data.js         the same board in window.RADAR form, beside dashboard/
//   dashboard/      the static page, copied as-is
//   screenshots/    the three captures, copied as-is
//   dossier.json    built last by vendor/makefun-board.ts, so it always
//                   matches the files above byte for byte.
//
// The run is deterministic: same snapshot in, same bytes out, so the grader's
// two runs agree. No network, no clock reads, no randomness anywhere in here.
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, boardIssue } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

// Dossier caps from the kit's gate: dashboard text at most 64 KiB, screenshots
// at most 4 files of 512 KiB, dossier at most 1.5 MiB (enforced by the library).
const TEXT_MAX_BYTES = 65_536;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read --name <value> / --name=<value> from argv, else the fallback. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token-radar-4a: no snapshot at ${inputFile} (pass --input <snapshot.json|dir>)\n`);
  process.exit(2);
}

const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = JSON.parse(readFileSync(inputFile, 'utf8'));
const radar = buildRadar(snapshot);
const issue = boardIssue(radar.rows, snapshot);
if (issue !== null) {
  process.stderr.write(`token-radar-4a: board failed self-check: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: radar.rows })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files, skipping dotfiles, into `to`. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

const dashFiles = copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token-radar-4a: screenshots/ holds ${shots.length} image(s), need 3\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token-radar-4a: screenshots/${name}: bad image name\n`);
    process.exit(1);
  }
}

writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token-radar-4a: ${snapshot.protocols.length} protocols in snapshot, ` +
    `${snapshot.watchlist.length} on watchlist, ${radar.rows.length} rows ranked ` +
    `(top ${radar.rows[0]!.name} at $${radar.rows[0]!.implied_value_usd.toLocaleString('en-US')})\n` +
    `token-radar-4a: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), ` +
    `screenshots/ (${shots.length} images), dossier.json into ${outDir}\n`,
);

/** The dashboard's data file, kept beside main.ts's other writes. */
function dataScript(r: typeof radar): string {
  return `window.RADAR=${JSON.stringify(r)};\n`;
}
