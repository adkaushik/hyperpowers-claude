#!/usr/bin/env node
'use strict';

// hyperpowers-claude — installs the `hyperpower` Claude Code plugin.
// The plugin source ships here as payload.enc (AES-256-GCM). The key is not in
// this package: it is handed out by the activation portal to entitled accounts.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

// --- config seams (set before publishing) --------------------------------
const DEFAULT_ACTIVATE_URL = ''; // portal API base, e.g. https://portal.example.com/api
const DEFAULT_PAYLOAD_URL = '';  // only for a fetched payload (Option A); unused for bundled
// -------------------------------------------------------------------------

const MARKETPLACE = 'hyperpowers';
const PLUGIN = 'hyperpower';
const SRC_DIR = path.join(os.homedir(), '.claude', 'hyperpowers-src');
const VALUE_FLAGS = new Set(['--key', '--token', '--activate-url', '--payload-url', '--payload', '--dir']);

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      if (VALUE_FLAGS.has(a)) { flags[a.slice(2)] = argv[++i]; continue; }
      flags[a.slice(2)] = true;
      continue;
    }
    positional.push(a); // value-flags already consumed, so this is a real subcommand
  }
  return { cmd: positional[0] || 'install', flags };
}

// ponytail: sha256 of the key string, no salt — the key string is already
// 192 bits of CSPRNG output, and the packer and CLI must agree with no state.
function keyBytes(keyString) {
  return crypto.createHash('sha256').update(keyString.trim(), 'utf8').digest();
}

function decrypt(buf, keyString) {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', keyBytes(keyString), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!json) throw new Error(`${url} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  if (!res.ok && !json.status) throw new Error(`${url} failed (${res.status}): ${text.slice(0, 200)}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function deviceFlow(base) {
  const start = await postJSON(`${base.replace(/\/$/, '')}/device/code`, {});
  console.log('');
  console.log('  Activate this install:');
  console.log(`    1. open  ${start.verification_uri}`);
  console.log(`    2. enter  ${start.user_code}`);
  console.log('');
  process.stdout.write('  waiting for activation');
  const interval = Math.max(1, Number(start.interval) || 5) * 1000;
  const deadline = Date.now() + (Number(start.expires_in) || 600) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    process.stdout.write('.');
    const r = await postJSON(`${base.replace(/\/$/, '')}/device/token`, { device_code: start.device_code });
    if (r.status === 'ok') { console.log(' activated.\n'); return r.key; }
    if (r.status === 'denied') { console.log(''); throw new Error('Activation denied.'); }
    if (r.status === 'expired') { console.log(''); throw new Error('Activation code expired. Run the installer again.'); }
  }
  console.log('');
  throw new Error('Timed out waiting for activation.');
}

async function tokenKey(base, token) {
  const r = await postJSON(`${base.replace(/\/$/, '')}/token/key`, { token });
  if (r.status === 'ok' && typeof r.key === 'string') return r.key;
  const reason = r.status === 'slow_down'
    ? 'Too many token requests. Wait 15 minutes, then try again.'
    : r.status === 'unavailable'
      ? 'Activation is not available yet.'
      : r.reason || 'That token was refused.';
  const err = new Error(reason);
  err.exitCode = 2;
  throw err;
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(question, (a) => { rl.close(); r(a); }));
}

async function resolveKey(flags) {
  const direct = (typeof flags.key === 'string' && flags.key) || process.env.HP_LICENSE_KEY;
  if (direct) return direct;

  const base = (typeof flags['activate-url'] === 'string' && flags['activate-url'])
    || process.env.HP_ACTIVATE_URL || DEFAULT_ACTIVATE_URL;

  const token = (typeof flags.token === 'string' && flags.token) || process.env.HP_TOKEN;
  if (token) {
    if (!base) {
      const err = new Error('--token needs an activation URL. Pass --activate-url or set HP_ACTIVATE_URL.');
      err.exitCode = 2;
      throw err;
    }
    return tokenKey(base, token.trim());
  }

  if (base) return deviceFlow(base);

  if (process.stdin.isTTY && !flags['no-prompt']) {
    const k = await prompt('Paste your hyperpowers key: ');
    if (k.trim()) return k.trim();
  }

  const err = new Error('No key available. Pass --key or --token, set HP_LICENSE_KEY or HP_TOKEN, or configure --activate-url.');
  err.exitCode = 2;
  throw err;
}

function claude(args, { check = true } = {}) {
  const r = spawnSync('claude', args, { encoding: 'utf8' });
  if (r.error && r.error.code === 'ENOENT') {
    const e = new Error('`claude` not found on PATH. Install Claude Code first: https://claude.com/claude-code');
    e.exitCode = 3;
    throw e;
  }
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (check && r.status !== 0) throw new Error(`claude ${args.join(' ')} failed:\n${out.trim()}`);
  return { code: r.status, out };
}

function has(args, needle) {
  const { out } = claude(args, { check: false });
  return out.includes(needle);
}

function extract(tgz, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(os.tmpdir(), `hp-${process.pid}.tgz`);
  fs.writeFileSync(tmp, tgz);
  try {
    const r = spawnSync('tar', ['-xzf', tmp, '-C', dir], { encoding: 'utf8' });
    if (r.error && r.error.code === 'ENOENT') throw new Error('`tar` not found on PATH.');
    if (r.status !== 0) throw new Error(`tar extract failed: ${(r.stderr || '').trim()}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function install(flags) {
  const payloadPath = (typeof flags.payload === 'string' && flags.payload)
    || path.join(__dirname, '..', 'payload.enc');
  if (!fs.existsSync(payloadPath)) throw new Error(`payload not found: ${payloadPath}`);
  const enc = fs.readFileSync(payloadPath);
  if (enc.length < 29) throw new Error('payload.enc is truncated or a placeholder.');

  const key = await resolveKey(flags);

  let tgz;
  try {
    tgz = decrypt(enc, key);
  } catch {
    const e = new Error('Could not decrypt the payload — the key is wrong, or payload.enc is damaged.');
    e.exitCode = 4;
    throw e;
  }

  if (flags['dry-run']) {
    console.log(`dry-run: key ok, payload decrypts to ${tgz.length} bytes. Nothing installed.`);
    return;
  }

  extract(tgz, SRC_DIR);
  console.log(`extracted to ${SRC_DIR}`);

  if (has(['plugin', 'marketplace', 'list'], MARKETPLACE)) {
    claude(['plugin', 'marketplace', 'update', MARKETPLACE]);
  } else {
    claude(['plugin', 'marketplace', 'add', SRC_DIR]);
  }

  if (has(['plugin', 'list'], PLUGIN)) {
    claude(['plugin', 'update', PLUGIN]);
  } else {
    claude(['plugin', 'install', `${PLUGIN}@${MARKETPLACE}`]);
  }

  console.log(`\n  ${PLUGIN} installed. Restart Claude Code, then try /hyperpower:help\n`);
}

function uninstall(flags) {
  if (has(['plugin', 'list'], PLUGIN)) claude(['plugin', 'uninstall', PLUGIN], { check: false });
  if (!flags['keep-marketplace'] && has(['plugin', 'marketplace', 'list'], MARKETPLACE)) {
    claude(['plugin', 'marketplace', 'remove', MARKETPLACE], { check: false });
  }
  fs.rmSync(SRC_DIR, { recursive: true, force: true });
  console.log('hyperpower removed.');
}

const USAGE = `
hyperpowers-claude — install the hyperpower Claude Code plugin

  npx hyperpowers-claude [install]      activate and install
  npx hyperpowers-claude uninstall      remove plugin, marketplace and source

Options
  --key <k>            use this key directly (or set HP_LICENSE_KEY)
  --token <t>          use a CI token from your dashboard (or set HP_TOKEN)
  --activate-url <u>   portal API base for device activation (or HP_ACTIVATE_URL)
  --no-prompt          never prompt; fail instead (for CI)
  --dry-run            verify the key decrypts the payload, install nothing
  --payload <path>     use a different payload.enc
  --keep-marketplace   uninstall only the plugin
`;

(async () => {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  try {
    if (flags.help || cmd === 'help') { console.log(USAGE); return; }
    if (cmd === 'uninstall') return uninstall(flags);
    if (cmd !== 'install') throw Object.assign(new Error(`Unknown command: ${cmd}${USAGE}`), { exitCode: 64 });
    await install(flags);
  } catch (e) {
    console.error(`\nerror: ${e.message}\n`);
    process.exit(e.exitCode || 1);
  }
})();
