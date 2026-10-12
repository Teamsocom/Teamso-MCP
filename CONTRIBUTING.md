# Contributing

Thanks for helping improve the Teamso MCP server. This repository is maintained by Teamso; anyone can
open issues, comment and send pull requests, and a Teamso maintainer reviews and merges them.

## Before you start

- Check the [open issues](https://github.com/Teamsocom/Teamso-MCP/issues) first. For a larger change,
  open an issue to agree on the approach before you write code.
- Security problems: do **not** open a public issue — see [SECURITY.md](SECURITY.md).

## Development

```bash
git clone https://github.com/<you>/Teamso-MCP.git
cd Teamso-MCP
npm ci
npm run build
npm test
```

- Node.js 20 or newer.
- `npx tsc --noEmit` must pass and every change needs tests in `tests/` (`node --test` against the
  built `dist/`). Use the mocked API in `tests/helpers.mjs`; tests must not call a real Teamso API.
- Tools follow the existing pattern in `src/tools/`: zod input and output schemas, annotations
  (`readOnlyHint`, `destructiveHint`, ...), `structuredContent` plus a short Markdown text, and clear
  error messages. Never log or return the access token.
- Writes must keep the user in control: confirm before acting, and keep Teamso's SMS confirmation
  where Teamso requires it.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep the change focused; update `README.md` and `CHANGELOG.md` (under "Unreleased") when behaviour
   changes.
3. Open the pull request against `main` and fill in the template. CI runs after a maintainer approves
   the workflow run for first-time and external contributors.
4. Pull requests are squash-merged after review and green CI. Releases (tags `v*` and the npm package)
   are made by maintainers only.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
