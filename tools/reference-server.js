#!/usr/bin/env node
'use strict';

// NON-PRODUCTION reference for the activation contract. No auth, no
// entitlement check, in-memory state, key read from HP_KEY. Test harness only.
//   HP_KEY=... node tools/reference-server.js 8787

const http = require('http');
const crypto = require('crypto');

const KEY = process.env.HP_KEY;
if (!KEY) { console.error('set HP_KEY'); process.exit(1); }
const PORT = Number(process.argv[2] || 8787);
const codes = new Map(); // device_code -> { user_code, status }

const body = (req) => new Promise((r) => {
  let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } });
});
const send = (res, obj, code = 200) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};

http.createServer(async (req, res) => {
  const b = await body(req);
  if (req.url === '/device/code') {
    const device_code = crypto.randomBytes(16).toString('hex');
    const user_code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.set(device_code, { user_code, status: 'pending' });
    return send(res, { device_code, user_code, verification_uri: `http://localhost:${PORT}/activate`, interval: 2, expires_in: 600 });
  }
  if (req.url === '/device/token') {
    const e = codes.get(b.device_code);
    if (!e) return send(res, { status: 'expired' });
    if (e.status !== 'ok') return send(res, { status: e.status });
    return send(res, { status: 'ok', key: KEY });
  }
  if (req.url === '/portal/claim') {
    // PRODUCTION: authenticate the user and check a paid entitlement here.
    for (const e of codes.values()) if (e.user_code === b.user_code) { e.status = 'ok'; return send(res, { ok: true }); }
    return send(res, { ok: false }, 404);
  }
  send(res, { error: 'not found' }, 404);
}).listen(PORT, () => console.log(`reference portal on http://localhost:${PORT}`));
