# @fyzno/mcp

A read-only [MCP](https://modelcontextprotocol.io) server for [fyzno.com](https://fyzno.com).

Its main use is the **mail health check**: give it a domain and it reports mail
routing, SPF, DKIM, DMARC, MTA-STS, TLS-RPT, a live SMTP STARTTLS handshake, the
mail server's certificate, and the sending server's Spamhaus ZEN listing: as a
0–100 score with one finding per check. BIMI, IPv6, web security headers and DNS
hygiene are reported for information and never move the score.

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

The transport is **stdio**, so the client runs it as a local process. There is
no hosted endpoint to point a browser-based assistant at.

## Tools

| Tool | Takes | Returns |
| --- | --- | --- |
| `mail_health_check` | `domain` | The full report: score, verdict, every check |
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
| `check_web_security` | `domain` | Website transport and headers (informational) |
| `check_dns_hygiene` | `domain` | Zone consistency (informational) |
| `site_status` |: | Live service status and the incident record |
| `site_data` |: | What Fyzno does, where it runs, how to reach a person |
| `pages` |: | The site's pages with one line on each |

Every `check_*` tool runs the same report and returns one finding from it, so
the numbers always agree with `mail_health_check`. **If you want more than one
check on the same domain, call `mail_health_check` once** rather than fanning
out: it is a single request instead of thirteen.

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
