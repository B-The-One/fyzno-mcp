# Working on this

```
server.mjs           the server: tools at the top, JSON-RPC loop at the foot
server.d.mts         types for TypeScript callers
test/conformance.mjs drives the server with the real MCP SDK client
scripts/check.mjs    pre-publish guards
```

The rules this code lives by are in the header of `server.mjs`, next to the
code they apply to, and `scripts/check.mjs` enforces the ones it can. Read
that header before changing anything.

`@modelcontextprotocol/sdk` is a devDependency, used only by the conformance
test. Do not move it to `dependencies`.

## Before pushing

```bash
npm test
```

## Releasing

1. Bump `version` in `package.json` and `SERVER_INFO.version` in `server.mjs`.
2. Add a `CHANGELOG.md` entry.
3. Commit and push. The tag has to point at a commit that already has the new
   version in it, so the bump goes in before the release, not after.
4. Create a GitHub Release with tag `vX.Y.Z`, and write a description; left
   blank, GitHub falls back to the commit message.

CI publishes via Trusted Publishing. There is no npm token in this repo.

Anything listed in `files` in `package.json` ships to npm, `README.md`
included, so a README fix needs a release to reach the package page.
