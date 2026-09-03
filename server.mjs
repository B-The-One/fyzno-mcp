#!/usr/bin/env node
// server.mjs
// ============================================================================
// Fyzno MCP server. Stdio transport, local-only, read-only.
// ============================================================================
//
// WHAT THIS IS
//
// A Model Context Protocol server that lets a local agent (Claude, Codex,
// anything that speaks MCP) read this site the way a person would: its
// status, its public facts, its pages, and the three free reports: mail,
// website security, and DNS hygiene. The mail report also exposes each of its
// findings as its own tool (check_spf, check_dkim, ...) for an agent that
// wants one answer rather than the whole thing.
//
// Point any MCP client at:
//
//   npx -y @fyzno/mcp
//
// or `node server.mjs` from a checkout of this repository.
//
// DESIGN BOUNDARIES
//
//   - stdio only. The JSON-RPC stream owns stdout, so every log line goes to
//     stderr. A stray console.log would corrupt the protocol, and there is no
//     recovery from that.
//   - read-only, public surface only. Every tool is a GET against this site's
//     own public endpoints. There is no tool that writes, no tool that takes
//     a URL, and no environment variable that points at anything but this
//     site. The agent can read what a visitor can read, nothing more.
//   - FYZNO_BASE_URL overrides the origin, defaulting to the production
//     domain. Override it to hit a local dev server during work on the site.
//   - ZERO dependencies. The JSON-RPC loop at the foot of this file is written
//     out rather than imported: the official SDK would put 96 packages and
//     25 MB into the node_modules of everyone who installs this, to provide a
//     line reader it never actually loads. See the long note above that loop.
//
// SECURITY POSTURE
//   - The only caller-controlled input is a domain, and it is validated by
//     the API (normaliseDomain) before a single DNS query leaves the box.
//   - Every fetch has a hard timeout (10s for page reads, 30s for the health
//     check, which does live SMTP and TLS probes); a hung upstream is an
//     error, not a wedge.
//   - Errors come back as tool results with isError: true, so the agent sees
//     the failure in-band and can act on it. The process never crashes on a
//     bad tool call.
// ============================================================================

import { pathToFileURL } from "node:url";

const BASE_URL = (process.env.FYZNO_BASE_URL ?? "https://fyzno.com").replace(/\/$/, "");
const FETCH_TIMEOUT_MS = 10_000;
// The health check does real SMTP and HTTPS probes, so it can run well past a
// fast page fetch. Give it a wider ceiling than the other tools.
const HEALTH_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** A GET with a hard ceiling. Returns the parsed body plus the status, and
 *  never throws: network failure and timeout come back as { error }. */
// `opts` exists for the HTTP surface in app/mcp/route.ts, which reuses these
// tools verbatim. It overrides the origin (the app calls itself over loopback,
// not the public name) and adds headers, specifically x-real-ip, so the rate
// limiter still sees the ACTUAL agent rather than 127.0.0.1. Without that
// forwarding, every remote MCP user in the world would share one bucket.
// Stdio callers pass nothing and behave exactly as before.
async function getJson(path, timeoutMs = FETCH_TIMEOUT_MS, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${opts.baseUrl ?? BASE_URL}${path}`, {
      signal: controller.signal,
      headers: { accept: "application/json", ...(opts.headers ?? {}) },
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (err) {
    const reason =
      err?.name === "AbortError"
        ? `timed out after ${FETCH_TIMEOUT_MS}ms`
        : err?.message ?? "request failed";
    return { status: 0, body: null, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/** Wrap a JSON body as MCP text content. */
function jsonContent(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function errorContent(message) {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const DOMAIN_INPUT = {
  type: "object",
  properties: {
    domain: {
      type: "string",
      description: "The domain to check, e.g. example.com.",
    },
  },
  required: ["domain"],
  additionalProperties: false,
};

// One tool per check in the report. Each runs the SAME report as
// mail_health_check (one code path, one rate-limit slot, one set of live
// probes) and returns only the finding for its own check, so an agent can ask
// for SPF without reading the whole report. Nothing in this list re-implements
// a check: the projection below is the only new logic.
const CHECK_TOOLS = [
  {
    tool: "check_routing",
    id: "routing",
    title: "Mail routing check",
    what:
      "The MX records: present, resolvable, no duplicates, a null MX only as a deliberate sink, and the fallback when there are none.",
  },
  {
    tool: "check_spf",
    id: "spf",
    title: "SPF check",
    what:
      "The SPF record: present, syntactically valid, the mechanism walk (a, mx, ip4, ip6, include, ptr), the DNS lookup count, and whether the list actually closes.",
  },
  {
    tool: "check_dkim",
    id: "dkim",
    title: "DKIM check",
    what:
      "DKIM: the selectors receivers try first, the key behind them, its length, and the canonicalization tags.",
  },
  {
    tool: "check_dmarc",
    id: "dmarc",
    title: "DMARC check",
    what:
      "DMARC: the policy (p), the subdomain policy (sp), alignment (adkim, aspf), the reporting addresses (rua, ruf), and pct.",
  },
  {
    tool: "check_mta_sts",
    id: "mta-sts",
    title: "MTA-STS check",
    what:
      "MTA-STS: the _mta-sts TXT record, the policy fetched over HTTPS from mta-sts.<domain>, its mode, MTA-STS-ID, and max_age.",
  },
  {
    tool: "check_tls_rpt",
    id: "tls-rpt",
    title: "TLS-RPT check",
    what:
      "TLS-RPT: the _smtp._tls TXT record and where TLS failure reports between servers are sent (rua).",
  },
  {
    tool: "check_smtp_tls",
    id: "smtp-tls",
    title: "SMTP / TLS check",
    what:
      "A live STARTTLS handshake with the mail servers: TLS supported, the protocol and cipher negotiated. Reported as not tested when this machine cannot reach port 25.",
  },
  {
    tool: "check_certificates",
    id: "certificates",
    title: "Certificates check",
    what:
      "The mail server's certificate: validity period, hostname match, issuer, key strength. Not tested when this machine cannot reach the mail server.",
  },
  {
    tool: "check_reputation",
    id: "reputation",
    title: "Reputation check",
    what:
      "The sending server's IP against Spamhaus ZEN. ZEN only; no other blocklists.",
  },
  {
    tool: "check_bimi",
    id: "bimi",
    title: "BIMI check",
    what:
      "BIMI: the default._bimi TXT record, v=BIMI1, the logo URL, whether the logo is served as SVG, and whether a verified mark (a=) backs it. Optional; never moves the score.",
  },
  {
    tool: "check_ipv6",
    id: "ipv6",
    title: "IPv6 check",
    what:
      "The apex AAAA record and whether advertised mail hosts answer over IPv6. Optional; never moves the score.",
  },
];

// check_web_security and check_dns_hygiene used to sit here. Both projected the
// MAIL report's optional, unscored sections: five headers, and a thin view of
// the zone whose own description said CAA was out of scope. That was accurate
// when they were the only tools of their kind. It stopped being accurate the
// moment real web and DNS reports existed, where CAA alone is worth 30 of 100.
// They are replaced by web_security_check and dns_hygiene_check below, which
// run the actual reports. Removing them is why this is a major version.

const CHECK_BY_TOOL = new Map(CHECK_TOOLS.map((entry) => [entry.tool, entry]));

const TOOLS = [
  {
    name: "site_status",
    title: "Fyzno site status",
    description:
      "Current status of the Fyzno infrastructure: what is running, measured uptime, and the incident record. Read-only.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "site_data",
    title: "Fyzno site facts",
    description:
      "The public facts an agent needs to represent the site: who we are, what we do and what we refuse, how to reach a human, and the list of pages and endpoints. Everything is already public on a page.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "pages",
    title: "Fyzno page index",
    description:
      "The pages of the site with one line on what each contains. Use it to find where a specific fact lives.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "mail_health_check",
    title: "Mail health check",
    description:
      "Run the free mail health check for a domain: mail routing, SPF, DKIM, DMARC, MTA-STS, TLS-RPT, a live SMTP STARTTLS handshake, the mail server's certificate, and the sending server's Spamhaus ZEN listing. Returns a 0-100 score, a verdict, and one finding per check with sub-checks. Optional checks (BIMI, IPv6, web security headers) are informational and never move the score. For a single check use the check_* tools (check_spf, check_dkim, ...) instead. The domain goes to DNS and the mail servers only; nothing is stored.",
    inputSchema: DOMAIN_INPUT,
  },
  {
    name: "web_security_check",
    title: "Website security check",
    description:
      "Run the free website security report for a domain: HTTPS and the redirect chain, the certificate, the TLS protocol and cipher, HSTS, the Content-Security-Policy judged on what it actually permits rather than whether it exists, framing and MIME handling, referrer and permissions policy, cookie flags, and content integrity. Returns a 0-100 score, a verdict, and one finding per section with sub-checks. Read-only: it fetches the home page the way a browser would plus /.well-known/security.txt, and sends no payload, probes no form, guesses no path and scans no port. Nothing is stored.",
    inputSchema: DOMAIN_INPUT,
  },
  {
    name: "dns_hygiene_check",
    title: "DNS hygiene check",
    description:
      "Run the free DNS hygiene report for a domain: name server redundancy and whether the servers sit under more than one provider, CAA records naming which authorities may issue certificates, SOA timers against the RFC 1912 ranges, and whether an unknown subdomain resolves. Returns a 0-100 score, a verdict, and one finding per section. Cache lifetimes are reported but never scored, and DNSSEC is reported as not tested rather than guessed. Read-only, from public records: no zone transfer is attempted and no subdomain is guessed.",
    inputSchema: DOMAIN_INPUT,
  },
  ...CHECK_TOOLS.map((entry) => ({
    name: entry.tool,
    title: entry.title,
    description:
      `${entry.what} Returns only this finding (state, score, sub-checks) from ` +
      `the full mail health report, with the overall score and verdict for ` +
      `context. Same engine and same rate limit as mail_health_check.`,
    inputSchema: DOMAIN_INPUT,
  })),
];

/** The individual check tools: same report as mail_health_check, projected
 *  down to one finding. The projection is the only new logic here; every
 *  check still runs in the site's own engine, so the numbers an agent reads
 *  from check_spf are byte-for-byte the numbers mail_health_check would
 *  report. */
async function runSingleCheck(entry, toolName, args, opts = {}) {
  const domain = typeof args?.domain === "string" ? args.domain.trim() : "";
  if (!domain) {
    return errorContent(`${toolName} requires a domain argument.`);
  }
  const { status, body, error } = await getJson(
    `/api/mail?d=${encodeURIComponent(domain)}`,
    HEALTH_TIMEOUT_MS,
    opts,
  );
  if (error) return errorContent(`${toolName} failed: ${error}`);
  if (status === 429) {
    return errorContent(
      "The health check rate limit is in effect. Wait an hour and try again.",
    );
  }
  if (status !== 200 || !body?.ok || !body.report) {
    const detail = body?.error ? `: ${body.error}` : "";
    return errorContent(`${toolName} returned HTTP ${status}${detail}`);
  }
  const report = body.report;
  const check = [...report.checks, ...report.optional].find(
    (c) => c.id === entry.id,
  );
  if (!check) {
    return errorContent(`${toolName}: the report has no "${entry.id}" check.`);
  }
  return jsonContent({
    domain: report.domain,
    generatedAt: report.generatedAt,
    check,
    report: {
      score: report.score,
      maxScore: report.maxScore,
      verdict: report.verdict,
    },
  });
}

async function callTool(name, args, opts = {}) {
  const single = CHECK_BY_TOOL.get(name);
  if (single) return runSingleCheck(single, name, args, opts);

  switch (name) {
    case "site_status": {
      const { status, body, error } = await getJson("/api/status", FETCH_TIMEOUT_MS, opts);
      if (error) return errorContent(`site_status failed: ${error}`);
      if (status !== 200 || !body)
        return errorContent(`site_status returned HTTP ${status}.`);
      return jsonContent(body);
    }

    case "site_data": {
      const { status, body, error } = await getJson("/api/site-data", FETCH_TIMEOUT_MS, opts);
      if (error) return errorContent(`site_data failed: ${error}`);
      if (status !== 200 || !body)
        return errorContent(`site_data returned HTTP ${status}.`);
      return jsonContent(body);
    }

    case "pages": {
      const { status, body, error } = await getJson("/api/site-data", FETCH_TIMEOUT_MS, opts);
      if (error) return errorContent(`pages failed: ${error}`);
      if (status !== 200 || !body?.pages)
        return errorContent(`pages returned HTTP ${status}.`);
      return jsonContent(body.pages);
    }

    case "web_security_check":
    case "dns_hygiene_check": {
      const domain = typeof args?.domain === "string" ? args.domain.trim() : "";
      if (!domain) return errorContent(`${name} requires a domain argument.`);
      const path = name === "web_security_check" ? "/api/web" : "/api/dns";
      const { status, body, error } = await getJson(
        `${path}?d=${encodeURIComponent(domain)}`,
        HEALTH_TIMEOUT_MS,
        opts,
      );
      if (error) return errorContent(`${name} failed: ${error}`);
      if (status === 429) {
        return errorContent(
          "The check rate limit is in effect. Wait an hour and try again.",
        );
      }
      if (status !== 200 || !body?.ok || !body.report) {
        const detail = body?.error ? `: ${body.error}` : "";
        return errorContent(`${name} returned HTTP ${status}${detail}`);
      }
      return jsonContent(body.report);
    }

    case "mail_health_check": {
      const domain = typeof args?.domain === "string" ? args.domain.trim() : "";
      if (!domain) {
        return errorContent("mail_health_check requires a domain argument.");
      }
      const { status, body, error } = await getJson(
        `/api/mail?d=${encodeURIComponent(domain)}`,
        HEALTH_TIMEOUT_MS,
        opts,
      );
      if (error) return errorContent(`mail_health_check failed: ${error}`);
      if (status === 429) {
        return errorContent(
          "The health check rate limit is in effect. Wait an hour and try again.",
        );
      }
      if (status !== 200 || !body?.ok || !body.report) {
        const detail = body?.error ? `: ${body.error}` : "";
        return errorContent(`mail_health_check returned HTTP ${status}${detail}`);
      }
      return jsonContent(body.report);
    }

    default:
      return errorContent(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Server wiring: JSON-RPC 2.0 over stdio, by hand
// ---------------------------------------------------------------------------
//
// WHY NOT @modelcontextprotocol/sdk HERE
//
// This file is published as @fyzno/mcp, so its dependencies land in the
// node_modules of everyone who installs it. The SDK brings 96 packages and
// 25 MB: express, hono, cors, ajv, eventsource, cross-spawn. None of it is
// reachable from the server entry point -- every static import from
// server/index.js, server/stdio.js and shared/*.js is relative or node: --
// so all of it was downloaded and never loaded. It also ships the SDK's own
// example code, including a demo that logs an API key in plaintext, which
// supply-chain scanners then report against our package rather than Anthropic's.
//
// What the SDK actually provided at this layer is written out below: a line
// reader, a JSON-RPC envelope, and four methods. It costs about eighty lines
// and takes the dependency count to zero.
//
// app/mcp/route.ts still uses the SDK, deliberately. It runs on our server, is
// never distributed, and Streamable HTTP has real machinery worth borrowing:
// sessions, SSE framing, resumability.
//
// STDOUT IS THE PROTOCOL. Every diagnostic goes to stderr. One stray
// console.log corrupts the stream and there is no recovering from it.

// Kept in step with packages/mcp/package.json by hand; build.mjs checks it.
const SERVER_INFO = { name: "fyzno", version: "2.0.0" };

/** Versions whose tools/list and tools/call semantics are the ones below.
 *  Mirrors SUPPORTED_PROTOCOL_VERSIONS in the SDK's types.js. */
const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
  "2024-10-07",
];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const send = (msg) => {
  process.stdout.write(JSON.stringify(msg) + "\n");
};

const respond = (id, result) => send({ jsonrpc: "2.0", id, result });

/** JSON-RPC error codes: -32700 parse, -32600 invalid request,
 *  -32601 method not found, -32602 bad params, -32603 internal. */
const fail = (id, code, message) =>
  send({ jsonrpc: "2.0", id, error: { code, message } });

/**
 * A tool that throws is reported in-band with isError, never as a JSON-RPC
 * error: an agent can read and act on the first, and can only give up on the
 * second. Protocol-level errors are reserved for malformed requests.
 */
async function handleToolCall(id, params) {
  const name = params?.name;
  if (typeof name !== "string") {
    fail(id, -32602, "tools/call requires a string params.name");
    return;
  }
  console.error(`[mcp] tool ${name}`);
  try {
    respond(id, await callTool(name, params?.arguments));
  } catch (err) {
    console.error(`[mcp] tool ${name} threw:`, err);
    respond(
      id,
      errorContent(
        `Tool ${name} failed: ${err instanceof Error ? err.message : "unknown error"}`,
      ),
    );
  }
}

export async function handleMessage(msg) {
  // A notification carries no id and must never be answered, not even to
  // reject it. notifications/initialized is the one every client sends.
  const isNotification = msg.id === undefined || msg.id === null;
  const { id, method, params } = msg;

  if (typeof method !== "string") {
    if (!isNotification) fail(id, -32600, "Invalid Request: no method");
    return;
  }

  switch (method) {
    case "initialize": {
      // Echo the client's version when we know it, otherwise answer with our
      // latest and let the client decide. The whole surface here is tools,
      // which has not changed shape across any version in the list.
      const asked = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(asked)
        ? asked
        : LATEST_PROTOCOL_VERSION;
      respond(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      return;
    }

    case "tools/list":
      respond(id, { tools: TOOLS });
      return;

    case "tools/call":
      await handleToolCall(id, params);
      return;

    case "ping":
      respond(id, {});
      return;

    default:
      // Any notification we do not implement (cancelled, progress) is dropped,
      // which is what the spec asks for.
      if (!isNotification) fail(id, -32601, `Method not found: ${method}`);
  }
}

// The tool list and the dispatcher are the product; stdio is one way to reach
// them. app/mcp/route.ts serves the SAME exports over Streamable HTTP so
// browser-based agents (ChatGPT, claude.ai) can call them, and so there is
// exactly one definition of what a fyzno tool is.
export { TOOLS, callTool, jsonContent, errorContent };

// Only speak stdio when this file IS the program. Imported as a module, which
// is what the HTTP route does, attaching to stdin would steal the Next
// server's input and write JSON-RPC frames into its logs.
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  // setEncoding("utf8") rather than decoding chunks by hand: it holds a
  // partial multi-byte character across a chunk boundary instead of splitting
  // it, which is the bug you get for free by handling Buffers yourself.
  process.stdin.setEncoding("utf8");
  let buffer = "";

  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    // Messages are newline-delimited, and a message never contains a raw
    // newline of its own because JSON.stringify escapes them.
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        fail(null, -32700, "Parse error");
        continue;
      }
      // JSON-RPC batching was removed from MCP in 2025-06-18. Refusing it
      // plainly beats half-implementing it.
      if (Array.isArray(msg)) {
        fail(null, -32600, "Batch requests are not supported");
        continue;
      }
      if (msg === null || typeof msg !== "object") {
        fail(null, -32600, "Invalid Request");
        continue;
      }
      void handleMessage(msg).catch((err) => {
        console.error("[mcp] handler threw:", err);
        if (msg.id !== undefined && msg.id !== null) {
          fail(msg.id, -32603, "Internal error");
        }
      });
    }
  });

  // The client closing the pipe means no MORE requests, NOT abandon the ones
  // in flight. This called process.exit(0) here, and it silently truncated
  // every answer that was still waiting on the network: pipe one tools/call
  // in with `echo ... | node server.mjs` and the process died during the
  // fetch, before writing the response. The SDK does not do that, and neither
  // should this.
  //
  // Nothing is needed to replace it. An ended stdin no longer holds the event
  // loop open, so node exits by itself once the last fetch settles, and every
  // request has a hard timeout (10s, 30s for the health check) so "once" is
  // bounded rather than a promise.
  process.stdin.on("end", () => {
    console.error("[mcp] stdin closed; finishing in-flight work");
  });

  console.error(`[mcp] fyzno server ready (base ${BASE_URL})`);
}
