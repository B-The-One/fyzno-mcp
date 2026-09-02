# Working on this

One file does the work: `server.mjs`. It has no runtime dependencies, and it
must stay that way.

## Layout

```
server.mjs           the server. Tools at the top, JSON-RPC loop at the foot.
server.d.mts         types, so a TypeScript caller can import the exports
test/conformance.mjs drives the server with the REAL MCP SDK client
scripts/check.mjs    guards that run before every publish
```

`@modelcontextprotocol/sdk` is a **devDependency**. It is used only by the
conformance test, to prove this server satisfies the same client that Claude
Code, Claude Desktop, Cursor, Windsurf and Zed all use. It is never shipped.

## Before pushing

```bash
npm test
```

That runs the guards and the conformance suite. The guards fail the build if a
runtime dependency appears, if `SERVER_INFO.version` drifts from
`package.json`, if the shebang goes missing, or if a `console.log` lands in
`server.mjs`.

That last one is not fussiness. **Stdout is the protocol.** A single
`console.log` writes a non-JSON-RPC line into the stream and the client's
parser gives up. Diagnostics go to `console.error`.

## Releasing

1. Bump `version` in `package.json` **and** `SERVER_INFO.version` in
   `server.mjs`. The guard fails if they disagree.
2. Add a `CHANGELOG.md` entry.
3. Commit and push.
4. Create a GitHub Release, or run the `publish` workflow from the Actions tab.

Publishing happens in CI through Trusted Publishing, so there is no npm token
in this repository and every release carries a provenance attestation. Nothing
needs to be published from a laptop.

## What this server may never do

It is read-only by design, and that is the promise on the package page:

- no tool writes anything
- no tool accepts a URL, only a domain name
- the only origin it reads from is `FYZNO_BASE_URL`, default `https://fyzno.com`
- every request has a hard timeout

A tool that broke any of those would need the README, the site copy at
`/health`, and `llms.txt` changed with it.
