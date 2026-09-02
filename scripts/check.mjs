/**
 * Guards that run before every publish.
 *
 * The point of this package is that installing it pulls nothing else in, and
 * that it reports the version it actually is. Both are easy to break by
 * accident and neither is visible in a diff, so they are enforced rather than
 * remembered.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const server = await readFile(path.join(root, "server.mjs"), "utf8");

const problems = [];

// A runtime dependency would land in the node_modules of everyone who installs
// this. devDependencies are fine: they are for the conformance test and are
// never shipped.
const deps = Object.keys(pkg.dependencies ?? {});
if (deps.length > 0) {
  problems.push(`must stay dependency-free, found: ${deps.join(", ")}`);
}

// A server reporting 1.1.0 from inside a 1.2.0 tarball is a debugging trap.
const declared = /version: "([^"]+)" \};/.exec(server)?.[1];
if (declared !== pkg.version) {
  problems.push(
    `SERVER_INFO.version is ${declared}, package.json is ${pkg.version}`,
  );
}

// npm's generated launcher execs this file directly on POSIX.
if (!server.startsWith("#!/usr/bin/env node")) {
  problems.push("server.mjs is missing its shebang");
}

// STDOUT IS THE PROTOCOL. A console.log anywhere in the server writes a
// non-JSON-RPC line into the stream and the client's parser gives up.
const stray = server
  .split("\n")
  .map((line, i) => [i + 1, line])
  .filter(([, line]) => /(^|[^.\w])console\.log\(/.test(line));
if (stray.length > 0) {
  problems.push(
    `console.log on line(s) ${stray.map(([n]) => n).join(", ")}; diagnostics go to stderr`,
  );
}

// The repository field is what lets a scanner tie the tarball to a source.
if (/CHANGE-ME/.test(pkg.repository?.url ?? "")) {
  problems.push("repository.url still has the CHANGE-ME placeholder in it");
}

if (problems.length > 0) {
  console.error("check failed:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.error(`check ok: v${pkg.version}, 0 runtime deps, stdout clean`);
