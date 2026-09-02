# Changelog

## 1.2.1

Documentation only. No code change; upgrading from 1.2.0 changes nothing at
runtime.

The README claimed there was no hosted endpoint for browser-based assistants.
That stopped being true when https://fyzno.com/mcp shipped, and the README is
what npmjs.com renders, so the package page was telling people a capability
did not exist. It now points at the connector.

Also fixes three rows of the tools table that rendered as a bare colon, and
adds the 1.2.0 entry below, which was missed at the time.

## 1.2.0

Moved to its own repository at https://github.com/B-The-One/fyzno-mcp.

`server.mjs` used to live in the fyzno.com tree and get copied into a package
at pack time. It is now the source. Two copies of one file drift, and this one
had already started to.

No change to the tools. Same seventeen, same arguments, same results.

- Published from CI with a provenance attestation, so the tarball is
  cryptographically tied to the commit that built it. Verify with
  `npm audit signatures`.
- Ships TypeScript types (`server.d.mts`), so callers importing `TOOLS` and
  `callTool` are type-checked.
- Adds `repository`, `author`, `bugs` and a LICENSE file.

## 1.1.0

**No dependencies.** The package installed 96 packages and 25 MB before this
release, all of it from `@modelcontextprotocol/sdk`. It now installs one file,
about 20 KB, and nothing else.

Nothing about the tools changed. Same seventeen, same arguments, same results.

**Why.** Tracing the SDK's server entry point showed that every static import
reachable from `server/index.js`, `server/stdio.js` and `shared/*.js` is either
relative or a `node:` builtin. So express, hono, cors, ajv, eventsource and
cross-spawn were downloaded into every installer's `node_modules` and never
loaded. The SDK also ships its own example code, including a demo that logs an
API key in plaintext, which supply-chain scanners reported against this package
rather than against Anthropic's.

What the SDK provided at this layer was a line reader, a JSON-RPC envelope and
four methods. That is now written out at the foot of `server.mjs`, with the
reasoning beside it.

**Verified, not assumed.** `scripts/audit-mcp.mjs` in the Fyzno repository
drives this server with the real MCP SDK *client*, the one Claude Code, Claude
Desktop, Cursor, Windsurf and Zed all use: protocol negotiation including
version fallback, `tools/list`, `tools/call`, `ping`, in-band tool errors, and
the JSON-RPC edge cases (parse error, unknown method, notifications drawing no
response, batch refusal, bad params). 14/14.

**Faster.** Cold start to a served `tools/list`, median of seven runs:

| | 1.0.0 | 1.1.0 |
| --- | --- | --- |
| Startup | 141.5 ms | 28.9 ms |

Every MCP client spawns the server fresh per session, so this is per session,
not once.

**One behaviour fix found while testing.** Closing stdin used to call
`process.exit(0)` immediately, which truncated any tool call still waiting on
the network: piping a single request in with `echo ... | fyzno-mcp` killed the
process mid-fetch, before the response was written. An ended stdin no longer
holds the event loop open, so the process now exits by itself once the last
request settles, and every request has a hard timeout.

## 1.0.0

First release. Seventeen read-only tools over stdio: the mail health check as
`mail_health_check`, thirteen `check_*` tools projecting one finding each, and
`site_status`, `site_data` and `pages`.
