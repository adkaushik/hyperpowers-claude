# hyperpowers-claude

Installs the hyperpowers plugin for Claude Code.

## Install

```bash
npx hyperpowers-claude
```

The installer prints a link and a short code. Open
https://hyperpowers.dev/activate, sign in with GitHub, and enter the code.
The install finishes on its own. Restart Claude Code, open your project and run
`/hyperpower:build` with what you want built.

You need Claude Code and Node.js 18 or newer.

## Install on CI or a server

Create a token on your dashboard at https://hyperpowers.dev/dashboard, then
run:

```bash
npx hyperpowers-claude --token <your-token>
```

You can set `HP_TOKEN` instead of passing `--token`. Keep the token secret. Creating
a new token replaces the old one.

## Uninstall

```bash
npx hyperpowers-claude uninstall
```

This removes the plugin, its marketplace entry and the files in
`~/.claude/hyperpowers-src`. Add `--keep-marketplace` to leave the marketplace entry
in place.

## Exit codes

| Code | Meaning |
|---|---|
| `2` | The install was not activated, or the token was refused |
| `3` | `claude` is not on your PATH |
| `4` | The plugin files could not be unpacked |
| `1` | Anything else |
