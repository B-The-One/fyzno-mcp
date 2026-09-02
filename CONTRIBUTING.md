# Working on this

```
server.mjs           the server: tools at the top, JSON-RPC loop at the foot
server.d.mts         types for TypeScript callers
test/conformance.mjs drives the server with the real MCP SDK client
scripts/check.mjs    pre-publish guards
```

`@modelcontextprotocol/sdk` is a devDependency, used only by the conformance
test. Do not move it to `dependencies`; the point of this package is that
installing it pulls nothing in.

## Before pushing

```bash
npm test
```

Guards plus the conformance suite. The guards fail on a runtime dependency, a
version drift between `SERVER_INFO` and `package.json`, a missing shebang, or a
`console.log` in `server.mjs`.

That last one matters: stdout carries the JSON-RPC stream. One `console.log`
writes a non-protocol line into it and the client's parser gives up.
Diagnostics go to `console.error`.

## Releasing

1. Bump `version` in `package.json` and `SERVER_INFO.version` in `server.mjs`.
2. Add a `CHANGELOG.md` entry.
3. Commit, push.
4. Create a GitHub Release, or run the `publish` workflow from the Actions tab.

CI publishes via Trusted Publishing, so there is no npm token in this repo and
releases carry a provenance attestation.

## Invariants

- no tool writes anything
- no tool accepts a URL, only a domain name
- the only origin read from is `FYZNO_BASE_URL`, default `https://fyzno.com`
- every request has a hard timeout

These are stated on the package page and in the site copy at `/health` and
`llms.txt`. Breaking one means changing those too.
