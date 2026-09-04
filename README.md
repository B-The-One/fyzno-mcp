# @fyzno/mcp

A read-only [MCP](https://modelcontextprotocol.io) server for [fyzno.com](https://fyzno.com).

It runs three free reports on any domain, each scored out of 100 with one
finding per section, and each stating plainly what could not be tested rather
than guessing:

- **Mail**: routing, SPF, DKIM, DMARC, MTA-STS fetched over HTTPS, TLS-RPT, a
  live STARTTLS handshake with the mail servers, the certificates behind it,
  and the sending server's Spamhaus ZEN listing.
- **Web security**: HTTPS and the redirect chain, the certificate, TLS, HSTS,
  the Content-Security-Policy judged on what it actually permits, framing and
  MIME handling, referrer and permissions policy, cookie flags, and content
  integrity.
- **DNS hygiene**: name server redundancy and provider spread, CAA, SOA timers,
  and wildcard resolution.

Everything is read-only. No payload is ever sent, no form is probed, no path is
guessed and no port is scanned.

## Use it

No install. Point any MCP client at it:

```json
{
  "mcpServers": {
    "fyzno": {
      "command": "npx",
      "args": ["-y", "@fyzno/mcp"]
    }
  }
}
```

That file is `.mcp.json` in a project for Claude Code, or
`claude_desktop_config.json` for Claude Desktop. Cursor, Windsurf, Zed and
VS Code use the same shape.

The transport is **stdio**, so the client runs it as a local process.

**In a browser?** ChatGPT and claude.ai cannot spawn a local process, so they
use the hosted endpoint instead: add `https://fyzno.com/mcp` as a custom
connector. Same seventeen tools, same results.

**No MCP at all?** Every report is plain JSON over HTTPS, so anything that can
fetch a URL can read one. No key, no account, no client:

```
https://fyzno.com/api/mail?d=example.com
https://fyzno.com/api/web?d=example.com
https://fyzno.com/api/dns?d=example.com
```

That is what this package calls under the hood, so the answers are identical.
Useful for a shell script, a cron job, or an assistant whose tooling stops at
`fetch`.

## Tools

| Tool | Takes | Returns |
| --- | --- | --- |
| `mail_health_check` | `domain` | The full mail report |
| `web_security_check` | `domain` | The full website security report |
| `dns_hygiene_check` | `domain` | The full DNS hygiene report |
| `check_routing` | `domain` | MX records and whether mail can be delivered at all |
| `check_spf` | `domain` | SPF record, lookup count, and the `all` qualifier |
| `check_dkim` | `domain` | DKIM keys found across common selectors |
| `check_dmarc` | `domain` | DMARC policy, alignment, and reporting addresses |
| `check_mta_sts` | `domain` | MTA-STS DNS record and the policy endpoint |
| `check_tls_rpt` | `domain` | TLS-RPT record |
| `check_smtp_tls` | `domain` | Live port-25 reachability and the STARTTLS handshake |
| `check_certificates` | `domain` | Mail server certificate, expiry, and hostname match |
| `check_reputation` | `domain` | Spamhaus ZEN listing for the sending IP |
| `check_bimi` | `domain` | BIMI record (informational) |
| `check_ipv6` | `domain` | IPv6 reachability (informational) |
| `site_status` | (none) | Live service status and the incident record |
| `site_data` | (none) | What Fyzno does, where it runs, how to reach a person |
| `pages` | (none) | The site's pages with one line on each |

The `check_*` tools each return one finding from the **mail** report. There are
no equivalents for the web and DNS reports: thirteen such tools already exist,
and every tool's description is spent from an agent's context on every
conversation.

Every `check_*` tool runs the same report and returns one finding from it, so
the numbers always agree with `mail_health_check`. **If you want more than one
check on the same domain, call `mail_health_check` once** rather than fanning
out, since that is one request instead of thirteen.

## Dependencies

None. The JSON-RPC loop is written out rather than imported, so installing this
package adds exactly one directory and about 20 KB to your `node_modules`.

## What it can and cannot do

- **Read-only.** Every tool is a GET against a public endpoint of fyzno.com. No
  tool writes, and no tool takes a URL.
- **Nothing is stored.** A checked domain goes to DNS and to that domain's own
  mail servers. It is not logged against you or retained.
- **Rate limited.** Roughly ten *new* domain checks per hour per address;
  repeat reads of an already-checked domain are far more generous. Over the
  limit you get a clear error, not a hang.
- **Bounded.** Every request has a hard timeout: 10s for page reads, 30s for
  the health check, which does live DNS, SMTP and TLS work.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `FYZNO_BASE_URL` | `https://fyzno.com` | Origin to read from. Only for developing against a local instance. |

## License

MIT
