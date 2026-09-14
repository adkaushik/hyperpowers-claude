#!/usr/bin/env node
'use strict';

// OWNER ONLY. Never published (see package.json "files").
//   node tools/pack-payload.js --gen-key
//   node tools/pack-payload.js <src-dir> --key "<key>" --out payload.enc

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const EXCLUDE = ['.git', '.github', 'node_modules', '.DS_Store'];

// ponytail: must match bin/cli.js keyBytes(). Two copies of three lines beats
// shipping a shared module that the published package would have to carry.
const keyBytes = (s) => crypto.createHash('sha256').update(s.trim(), 'utf8').digest();

function args(argv) {
  const f = {}; const pos = [];
  const val = new Set(['--key', '--out']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    if (val.has(a)) { f[a.slice(2)] = argv[++i]; continue; }
    f[a.slice(2)] = true;
  }
  return { pos, f };
}

const { pos, f } = args(process.argv.slice(2));

if (f['gen-key']) {
  console.log(crypto.randomBytes(24).toString('base64url')); // 192-bit
  process.exit(0);
}

const src = pos[0];
const key = f.key || process.env.HP_KEY;
const out = f.out || 'payload.enc';
if (!src || !key) {
  console.error('usage: pack-payload.js <src-dir> --key "<key>" [--out payload.enc]');
  process.exit(64);
}
if (!fs.existsSync(path.join(src, '.claude-plugin'))) {
  console.error(`error: ${src} has no .claude-plugin/ — is it the plugin marketplace root?`);
  process.exit(65);
}
if (key.trim().length < 20) console.error('WARNING: weak key. Use --gen-key.');

const tmp = path.join(os.tmpdir(), `hp-pack-${process.pid}.tgz`);
const tarArgs = ['-czf', tmp, ...EXCLUDE.flatMap((e) => ['--exclude', e]), '-C', src, '.'];
const r = spawnSync('tar', tarArgs, { encoding: 'utf8' });
if (r.status !== 0) { console.error(`tar failed: ${r.stderr}`); process.exit(1); }

const plain = fs.readFileSync(tmp);
fs.rmSync(tmp, { force: true });

const iv = crypto.randomBytes(12);
const c = crypto.createCipheriv('aes-256-gcm', keyBytes(key), iv);
const ct = Buffer.concat([c.update(plain), c.final()]);
fs.writeFileSync(out, Buffer.concat([iv, c.getAuthTag(), ct]));

console.log(`${out}: ${plain.length} bytes plain -> ${fs.statSync(out).size} bytes encrypted`);
