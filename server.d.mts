// Types for mcp/server.mjs, which is plain ESM on purpose: it is published to
// npm as @fyzno/mcp and must run under a bare `node` with no build step. These
// declarations exist only so app/mcp/route.ts can import it type-checked.

export interface ToolDefinition {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/** The index signature is not decoration: the SDK's CallToolRequest handler is
 *  typed against `ServerResult`, a union whose members carry an open
 *  `[x: string]: unknown`. A closed interface is rejected as not assignable
 *  even though the shape is right. Arrays are mutable for the same reason. */
export interface ToolContent {
  [x: string]: unknown;
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
}

/** Per-call overrides. `baseUrl` retargets the origin the tools read from;
 *  `headers` are merged into each request, which is how the HTTP surface
 *  forwards the caller's real IP so rate limiting stays per-agent. */
export interface CallOptions {
  readonly baseUrl?: string;
  readonly headers?: Record<string, string>;
}

export declare const TOOLS: readonly ToolDefinition[];

export declare function callTool(
  name: string,
  args: unknown,
  opts?: CallOptions,
): Promise<ToolContent>;

export declare function jsonContent(value: unknown): ToolContent;
export declare function errorContent(message: string): ToolContent;

/** Dispatch one parsed JSON-RPC message, writing any response to stdout.
 *  Exported for tests; the stdio loop is the only caller in production. */
export declare function handleMessage(msg: Record<string, unknown>): Promise<void>;
