/**
 * Conformance: drive the hand-written stdio server with the REAL MCP SDK
 * client. If the SDK's client is happy, Claude Code, Claude Desktop, Cursor,
 * Windsurf and Zed are happy, because they all use it.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` · ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

// --- the SDK client, end to end -------------------------------------------
const client = new Client({ name: "conformance", version: "1.0.0" }, { capabilities: {} });
await client.connect(
  new StdioClientTransport({ command: "node", args: ["server.mjs"] }),
);

const info = client.getServerVersion();
check("initialize negotiates", info?.name === "fyzno", JSON.stringify(info));

const { tools } = await client.listTools();
check("tools/list returns 17", tools.length === 17, `${tools.length}`);
check(
  "every tool has name + description + inputSchema",
  tools.every((t) => t.name && t.description && t.inputSchema),
);

const r = await client.callTool({ name: "check_dmarc", arguments: { domain: "fyzno.com" } });
const rep = JSON.parse(r.content[0].text);
check("tools/call returns live data", rep.check?.id === "dmarc", `state=${rep.check?.state}`);

const bad = await client.callTool({ name: "check_spf", arguments: {} });
check("missing arg -> in-band isError", bad.isError === true, bad.content[0].text);

const unknown = await client.callTool({ name: "no_such_tool", arguments: {} });
check("unknown tool -> in-band isError", unknown.isError === true, unknown.content[0].text);

await client.ping();
check("ping answers", true);

await client.close();

// --- raw protocol edge cases the SDK client will not produce ---------------
const raw = (lines) =>
  new Promise((resolve) => {
    const child = spawn("node", ["server.mjs"], { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => resolve(out.trim().split("\n").filter(Boolean).map(JSON.parse)));
    child.stdin.write(lines.join("\n") + "\n");
    setTimeout(() => child.stdin.end(), 700);
  });

const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "r", version: "1" } } };

const [o1] = await raw([JSON.stringify(init)]);
check("echoes a known older protocol version", o1.result.protocolVersion === "2024-11-05", o1.result.protocolVersion);

const [o2] = await raw([
  JSON.stringify({ ...init, params: { ...init.params, protocolVersion: "1999-01-01" } }),
]);
check("falls back on an unknown version", o2.result.protocolVersion === "2025-11-25", o2.result.protocolVersion);

const o3 = await raw(["{not json"]);
check("parse error -> -32700", o3[0]?.error?.code === -32700, JSON.stringify(o3[0]?.error));

const o4 = await raw([JSON.stringify({ jsonrpc: "2.0", id: 9, method: "nope/nope" })]);
check("unknown method -> -32601", o4[0]?.error?.code === -32601, JSON.stringify(o4[0]?.error));

const o5 = await raw([
  JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }),
]);
check("notification draws no response", o5.length === 1 && o5[0].id === 7, `${o5.length} frame(s)`);

const o6 = await raw([JSON.stringify([init])]);
check("batch is refused, not crashed", o6[0]?.error?.code === -32600, JSON.stringify(o6[0]?.error));

const o7 = await raw([JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: 42 } })]);
check("non-string tool name -> -32602", o7[0]?.error?.code === -32602, JSON.stringify(o7[0]?.error));

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
