// Bump the app version before a deploy:  node scripts/release.mjs [patch|minor|major]
// Updates version.js (shown in the app) and sw.js (so phones pick up the new version).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const part = process.argv[2] || 'patch';
const versionFile = path.join(root, 'version.js');
const swFile = path.join(root, 'sw.js');

const current = fs.readFileSync(versionFile, 'utf8').match(/version: '(\d+)\.(\d+)\.(\d+)'/).slice(1).map(Number);
const [maj, min, pat] = current;
const next = part === 'major' ? [maj + 1, 0, 0] : part === 'minor' ? [maj, min + 1, 0] : [maj, min, pat + 1];
const version = next.join('.');
const build = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

fs.writeFileSync(versionFile, `// Written by scripts/release.mjs. Do not edit by hand.\nself.LL_VERSION = { version: '${version}', build: '${build}' };\n`);
const sw = fs.readFileSync(swFile, 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${version}+${build}';`);
fs.writeFileSync(swFile, sw);
console.log(`LittleOne ${version} (${build})`);
