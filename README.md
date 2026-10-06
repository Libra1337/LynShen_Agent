# LynShen Desktop

A desktop workbench for coding agents. One window runs LynShen's own agent,
Claude Code, Codex and any [ACP](https://agentclientprotocol.com) agent side by
side, across projects, with the files, git and terminal of each project next to
the conversation.

Status: closed beta.

## Download

Get the latest build from
[LynShen downloads](https://www.lynshen.org/download):

| Platform | File |
| --- | --- |
| macOS, Apple Silicon | `LynShen_<version>_aarch64.dmg` |
| macOS, Intel | `LynShen_<version>_x64.dmg` |
| Windows x64 | `LynShen_<version>_x64-setup.exe` (or `.msi`) |
| Linux x64 | `LynShen_<version>_amd64.AppImage`, `.deb` or `.rpm` |

The beta builds are not code-signed yet, so macOS and Windows warn on first
launch. [docs/install.md](docs/install.md) shows how to open the app and grant
the permissions it asks for. The app updates itself after that.

The app ships its own LynShen CLI (kept in `~/.lynshen/bin`, updated with the
app; Settings → Agents can make it a `lynshen` terminal command). On first
launch a welcome page opens browser authorization for LynShen, then walks through the coding
agent, the runtime (Git and the bundled engine) and the model. Claude Code and
Codex are optional; it installs them from their official sources when you want
them, and offers their upgrades later.

Sign in or register on the website, compare the code shown in the app, and approve
access. The app receives a separate 30-day device credential, not your password
or website session. Sign out in the app or revoke its key on the website.

## What it does

- **Several agents, one window.** LynShen, Claude Code, Codex and ACP agents,
  each in its own session. A session can also run the real TUI of `lynshen`,
  `codex` or `claude` in a terminal tab.
- **Workbench.** Projects by directory, sessions per project, split panes,
  a right dock with plan, files, git (stage, commit, discard, diff, GitHub pull
  requests), terminal and a built-in browser whose page elements can be
  referenced in a message. The branch under the composer switches or creates
  branches.
- **Agents.** Long-lived agents with a role, memory and schedules. Each task
  runs in its own session; handoff notes carry what earlier sessions concluded.
- **Conversation tools.** Streaming markdown, tool cards with diffs and output,
  approvals, rewind (conversation and files), branch tree, resume, find, slash
  commands, `@` file mentions, images, voice input and screen capture.
- **Models and providers.** The LynShen gateway (sign in with your LynShen
  account), your own API keys, or the tools' own sign-in. Claude Code and Codex
  sessions can run on this machine's login or on the LynShen gateway, with a
  gateway group per session; their plan usage shows in the model menu.
- **Background service.** Every session runs in the local LynShen daemon
  (`lynshen daemon`, started on demand), so it keeps going when the window
  closes and can be followed from the LynShen web app through an end-to-end
  encrypted relay.
- **History.** Import existing Claude Code and Codex conversations of a project
  and continue them.
- **Skills marketplace**, run by the daemon
  ([docs/skills.md](https://github.com/LynShen-Team/LynShen-CLI/blob/main/docs/skills.md) in the CLI repository).

Keyboard: `⌘K` command palette · `⌘F` find · `⌘N` new session · `⌘B` session
list · `⌘,` settings (Ctrl on Windows and Linux).

## Data and privacy

- Credentials live in `~/.lynshen/auth.json`, in plain text unless encryption
  is turned on in settings ([docs/secrets.md](docs/secrets.md)).
- Prompts and code go to the model provider of the session: the LynShen gateway,
  the provider of your own key, or the tool's own service.
- With remote access turned on in settings, the daemon keeps a connection to
  `wss://app.lynshen.net/relay/v1`. Conversation content is
  end-to-end encrypted; the relay sees connection metadata only.
- Voice input sends the recording to the configured speech-to-text service.
- Signed in to LynShen, the daemon reports each coding-agent turn's token
  counts, model, engine and timing to your account (no prompts, code or
  project paths), so usage adds up across your computers. Preferences such as
  language, theme and default model sync through the account; keys, MCP
  servers, skills and agents stay on the computer.
- The app checks the LynShen / Monoize service for signed updates, with a
  second LynShen domain as fallback. It has no analytics.

## Architecture

```
WebView (Svelte 5)  ── WebSocket (ops / events) ──▶  lynshen daemon  ──▶  LynShen, Claude Code, Codex, ACP agents
       │
       └── invoke ──▶  src-tauri (Rust): daemon start, files, git, PTY, config, installers, updates
```

- The daemon (`ws://127.0.0.1:7788`) runs every engine and translates each
  protocol into one event stream; `src/lib/chat.svelte.ts` projects it into
  the conversation state.
- `src-tauri/src/` starts the daemon and hosts the project-side commands.
- `src/routes/+page.svelte` is the shell; `src/lib/workbench/` the split panes.
- Logic without UI lives in plain TypeScript modules with unit tests.

The daemon protocol is documented in the CLI repository:
[docs/daemon-protocol.md](https://github.com/LynShen-Team/LynShen-CLI/blob/main/docs/daemon-protocol.md).

## Development

Requirements: Node with pnpm, a Rust toolchain, the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) of your
platform, and a `lynshen` binary. Check out
[LynShen-CLI](https://github.com/LynShen-Team/LynShen-CLI) next to this repository
and run `cargo build` there, or point `LYNSHEN_BIN` at a binary.

```sh
pnpm install
pnpm tauri dev      # run the app
pnpm check          # svelte-check
pnpm test           # vitest
pnpm tauri build    # package the app
```

Environment variables:

- `LYNSHEN_BIN`, `CLAUDE_BIN`, `CODEX_BIN`: use this binary for the engine.
- `LYNSHEN_CWD`: the directory the agent works in when none is given (default:
  where the app was launched).

Release builds bundle the LynShen CLI release named in
`src-tauri/lynshen-cli.version` (`--config src-tauri/tauri.bundle.conf.json`);
development builds use `LYNSHEN_BIN` or the sibling checkout. Releases and
updates: [docs/updater.md](docs/updater.md).

### Provider catalog

Settings lists providers from `src/lib/providers/catalog.json`, an
agent-capable subset of [models.dev](https://models.dev). Refresh it with
`pnpm catalog:refresh` (needs network access), or from a downloaded response
with `node scripts/refresh-provider-catalog.mjs ./api.json`. Tests read only
the vendored file.

## License

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
Copyright 2026 LynShen Innovations INC.

The license covers the code. The LynShen name and logo are trademarks of LynShen
Innovations INC. and are not licensed for use by forks. Claude Code, Codex and
other tools the app works with belong to their owners and are installed from
their official sources.
