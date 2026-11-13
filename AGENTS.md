# Agent guidelines

## The project

LDAP Studio is a desktop LDAP browser and editor, a modern alternative to Apache Directory Studio that needs no Java. It targets OpenLDAP, 389 Directory Server and Active Directory.

**Stack:** Electron, TypeScript (strict), React, Tailwind with Radix UI components (shadcn/ui style, in `src/renderer/src/components/ui`), Zustand, zod, ldapts, CodeMirror (search filter), TanStack Virtual (long lists). Built with electron-vite, packaged with electron-builder, managed with pnpm.

## Layout and boundaries

```
src/main/       Electron main process: LDAP sessions (ldap/), schema (schema/), storage and secrets (store/), IPC (ipc/, app/handlers.ts)
src/preload/    The only bridge to the renderer: exposes window.api
src/renderer/   React UI, sandboxed: no Node, no network, no file access. Feature folders (connections, tree, editor, search, shell, actions) and Zustand stores in state/
src/shared/     Pure TypeScript for both sides: IPC contract, DN and filter parsing, binary formatters, password hashing
test/           integration/, e2e/ (Playwright), ldap/ (Docker test servers), package/ (installer launch checks)
openspec/       Specs: specs/<capability>/spec.md is the current behavior; changes/archive/ holds past changes with their design
```

- Lint enforces the process boundaries: `src/shared` may not import Electron, Node built-ins or app layers. The renderer may not import Electron, Node or main-process code. Use Web Crypto and `TextEncoder` instead of Node APIs there.
- Everything between renderer and main goes through `src/shared/ipc.ts`. Each operation has zod schemas, and main validates every payload. To add an operation: define it in `ipc.ts`, handle it in `src/main/app/handlers.ts`, and call it with `window.api.invoke(name, request)`, which returns `{ ok, value }` or `{ ok: false, error }`. Long-running work (searches, child lists, subtree deletes) uses `window.api.stream(name, request, onEvent)`, which can be cancelled.
- Binary values are `Uint8Array` end to end and are never decoded as text. Saving must leave untouched binary values byte-identical.
- Passwords never reach the renderer or the log: profiles only expose `hasSavedPassword`, and the operation log redacts binds.

## Specs

Behavior is specified with OpenSpec in `openspec/specs/` (capabilities: app-shell, connection-management, directory-tree, entry-editing, directory-search, schema-model). Code comments point to the requirement they implement, e.g. `(entry-editing spec: choose DN values)`. When behavior changes, update the matching requirement and scenarios, and keep `docs/spec-coverage.md` (scenario → test) current. Larger features go through an OpenSpec change (`/opsx:propose`, `/opsx:apply`, `/opsx:archive`).

## Testing

| Kind        | Where                                       | Run                                                             |
| ----------- | ------------------------------------------- | --------------------------------------------------------------- |
| Unit        | `src/**/*.test.ts`, next to the code        | `pnpm test`                                                     |
| Integration | `*.int.test.ts`, `test/integration/`        | `pnpm test:env:up`, then `pnpm test:integration`                |
| End-to-end  | `test/e2e/*.spec.ts` (Playwright, Electron) | `pnpm test:env:up`, then `pnpm test:e2e` (builds the app first) |

- Integration and end-to-end tests are **skipped** when the Docker test servers are down. A skipped run is not a passing run, so start them first. Servers, ports and test accounts are described in `test/ldap/README.md`.
- The e2e tests need working password storage and stop at once without it. macOS and Windows have it built in. On Linux they need an unlocked keyring through the Secret Service (see the e2e step in `.github/workflows/ci.yml`).
- To rerun one e2e file after `pnpm build`: `pnpm exec playwright test test/e2e/editor.spec.ts`.
- E2E tests find elements by role and accessible name (`getByRole('button', { name: … })`). Give interactive elements meaningful roles and `aria-label`s, and keep them stable.
- Before calling work done, run `pnpm format:check`, `pnpm lint`, `pnpm typecheck` and `pnpm test`, plus the e2e tests for UI changes.

## Code style

- Always use curly braces, even for one-line `if` bodies (ESLint `curly: all`).
- Prettier formats everything, including Markdown and YAML.
- Comments explain why, briefly. Doc comments state what a function returns or guarantees.
- UI text is plain and short, in full sentences for messages ("The passwords do not match.").

## Commit messages

Write commit messages as [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). The changelog and release notes are generated from them by git-cliff (`cliff.toml`), so the subject is what users read.

```
<type>(<optional scope>): <description>

<optional body>

<optional footers>
```

**Types:**

| Type       | Use for                                                         | In the changelog |
| ---------- | --------------------------------------------------------------- | ---------------- |
| `feat`     | A new feature or a visible change in behavior                   | yes              |
| `fix`      | A bug fix                                                       | yes              |
| `perf`     | A performance improvement                                       | yes              |
| `revert`   | Reverting an earlier commit                                     | yes              |
| `refactor` | A code change that neither fixes a bug nor changes behavior     | no               |
| `test`     | Adding or changing tests only                                   | no               |
| `docs`     | Documentation only (README, specs, comments)                    | no               |
| `build`    | Dependencies, packaging, electron-builder                       | no               |
| `ci`       | GitHub Actions workflows                                        | no               |
| `chore`    | Anything else that users don't notice (tooling, config, format) | no               |

**Scopes** (optional): `connections`, `tree`, `editor`, `search`, `schema`, `shell` (layout, themes, shortcuts, command palette, log), `release`.

**Description:**

- Imperative mood, lowercase first letter, no period at the end: `feat(editor): set userPassword values in a password dialog`.
- Say what changes for the user, not how the code changes.
- Keep the subject line under about 72 characters. Put the why in the body when it isn't obvious.

**Breaking changes:** add `!` after the type or scope (`feat(connections)!: …`) and a `BREAKING CHANGE: …` footer that says what users have to do.

One logical change per commit. If a change needs two types, it is usually two commits.
