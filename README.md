# hyperpowers-claude

Installer for the **hyperpower** Claude Code plugin.

```bash
npx hyperpowers-claude
```

It shows a one-time activation code. Open the portal link, sign in, enter the
code, and the install continues on its own: the bundled payload is decrypted to
`~/.claude/hyperpowers-src`, registered as a local marketplace, and the plugin
is installed. Restart Claude Code, then try `/hyperpower:help`.

Remove everything:

```bash
npx hyperpowers-claude uninstall
```

## Options

| Flag | Meaning |
|---|---|
| `--key <k>` | use a key directly (also `HP_LICENSE_KEY`) |
| `--activate-url <u>` | portal API base (also `HP_ACTIVATE_URL`) |
| `--no-prompt` | never prompt, fail instead — for CI |
| `--dry-run` | check the key decrypts the payload, install nothing |
| `--keep-marketplace` | uninstall the plugin only |

Key resolution order: `--key`/`HP_LICENSE_KEY` → device activation → interactive
paste (TTY only) → fail with exit 2.

## For the owner

`tools/` is not published (`package.json` `files` covers `bin/`, `payload.enc`,
`README.md` only — verify with `npm pack --dry-run`).

```bash
npm run gen-key
npm run pack-payload -- /path/to/hyperpowers --key "<key>" --out payload.enc
# set DEFAULT_ACTIVATE_URL in bin/cli.js
npm version patch && npm publish
```

The portal's `/device/token` must return that same key.

### Portal contract

```
POST /device/code   -> { device_code, user_code, verification_uri, interval, expires_in }
POST /device/token  { device_code } -> { status: "pending" }
                                    -> { status: "ok", key: "<decryption key>" }
                                    -> { status: "denied" | "expired" }
POST /portal/claim  { user_code }   -- logged-in page action, marks a code authorized
```

`tools/reference-server.js` implements this contract with no auth and no
entitlement check. It is a test stand-in, not a production portal.
