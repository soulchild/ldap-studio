# LDAP Studio

A fast, modern desktop LDAP browser and editor. It's built with Electron, React and TypeScript, and needs no Java.

## Prerequisites

- Node.js 22.12 or newer
- pnpm 11 (`packageManager` in `package.json` pins the version)
- Docker with Compose, for the integration tests only

## Setup

```sh
pnpm install
```

Electron downloads its binary the first time it starts (for example on the first `pnpm dev`). To download it up front, for example in CI, run:

```sh
pnpm exec install-electron
```

## Commands

| Command                 | What it does                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm dev`              | Start the app in development mode with hot reload                                           |
| `pnpm build`            | Build main, preload and renderer into `out/`                                                |
| `pnpm preview`          | Run the production build                                                                    |
| `pnpm typecheck`        | Type-check the main/preload and renderer projects                                           |
| `pnpm lint`             | Lint, including the curly-brace and import-boundary rules                                   |
| `pnpm format`           | Format all files with Prettier                                                              |
| `pnpm format:check`     | Check formatting without writing                                                            |
| `pnpm test`             | Run the unit tests                                                                          |
| `pnpm test:integration` | Run the integration tests against the Docker test servers (skipped if they are not running) |
| `pnpm test:env:up`      | Start and seed the Docker test servers (see `test/ldap/README.md`)                          |
| `pnpm test:env:down`    | Stop the test servers and delete their data                                                 |
| `pnpm test:e2e`         | Build, then run the Playwright tests against the app (most need the test servers)           |
| `pnpm dist`             | Build installers for the current platform into `dist/`                                      |
| `pnpm dist:mac`         | Build macOS DMGs (Apple Silicon and Intel)                                                  |
| `pnpm dist:win`         | Build Windows NSIS installers (x64 and Arm64)                                               |
| `pnpm dist:linux`       | Build a Linux AppImage and deb                                                              |

## Installers

`electron-builder.yml` configures the installers. They are unsigned, so on first launch macOS Gatekeeper asks for confirmation (right-click the app and choose Open) and Windows SmartScreen shows a warning. Windows and Linux installers can be built on a Mac.

To check a build, `node test/package/launch.mjs <executable>` launches it and waits for the workspace. `sh test/package/linux-check.sh [arm64|amd64]` installs the Linux packages in a clean Debian container and launches them. Chromium does not run under Docker's x86 emulation, so on Apple Silicon only `arm64` works. CI (`.github/workflows/ci.yml`) builds and launches the installers on macOS, Windows and Linux runners.

## Project layout

```
src/
  main/       Electron main process: window, IPC handlers, LDAP, schema, storage
  preload/    The only bridge between the renderer and main (contextBridge)
  renderer/   React UI (sandboxed: no Node, no network, no file access)
  shared/     Pure TypeScript used by both sides: IPC contract, DN, filter, formatters
```

Lint enforces the boundaries: `src/shared` may not import Electron, Node built-ins or app layers, and the renderer may not import Electron, Node built-ins or main-process code.
