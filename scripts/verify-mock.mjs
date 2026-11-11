#!/usr/bin/env node
/**
 * Regression checks that need no cPanel server.
 *
 * Starts a mock UAPI endpoint, drives every tool through a real MCP client,
 * and checks behaviour that does not depend on what cPanel's functions are
 * called or return:
 *
 *   1. Every tool result is accepted by the MCP client whatever shape UAPI's
 *      `data` has (object, string, number, array, boolean, null).
 *   2. A failing UAPI call is reported as a tool error carrying cPanel's
 *      reason, with no second call substituted for it.
 *   3. Problems in CPANEL_ACCOUNTS are reported, without echoing tokens.
 *   4. Passwords and tokens never appear in a request URL.
 *
 * This does NOT check that the UAPI modules, functions and parameters the
 * tools use exist. That needs cPanel's OpenAPI spec.
 *
 * Usage: npm run build && npm run verify:mock
 * Needs the `openssl` CLI to create a throwaway certificate for the mock.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "dist", "index.js");
const TOKEN = "TOKEN-do-not-leak";
const PASSWORD = "Passw0rd-do-not-leak!";

const failures = [];
let checks = 0;
function check(condition, message) {
  checks++;
  if (!condition) failures.push(message);
}

// ---------------------------------------------------------------- mock UAPI

const certDir = mkdtempSync(join(tmpdir(), "cpanel-mcp-verify-"));
const keyFile = join(certDir, "key.pem");
const certFile = join(certDir, "cert.pem");
try {
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyFile, "-out", certFile, "-days", "1", "-subj", "/CN=127.0.0.1"],
    { stdio: "ignore" }
  );
} catch (e) {
  rmSync(certDir, { recursive: true, force: true });
  console.error(`Could not create a test certificate with openssl: ${e.message}`);
  process.exit(2);
}

const mock = {
  requests: [],
  /** What `data` holds in the next responses. */
  data: {},
  /** "Module/function" names that answer with status 0. */
  failing: new Set(),
};

const httpsServer = createServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const url = new URL(req.url, "https://mock");
    const fn = url.pathname.replace(/^\/execute\//, "");
    mock.requests.push({ method: req.method, fn, query: url.search, body, auth: req.headers.authorization });
    res.setHeader("content-type", "application/json");
    if (mock.failing.has(fn)) {
      res.end(JSON.stringify({ status: 0, errors: [`mock failure in ${fn}`], messages: null, warnings: null, data: null }));
      return;
    }
    res.end(JSON.stringify({ status: 1, errors: null, messages: null, warnings: null, metadata: {}, data: mock.data }));
  });
});
await new Promise((resolve) => httpsServer.listen(0, "127.0.0.1", resolve));
const port = httpsServer.address().port;

// ---------------------------------------------------------------- MCP client

async function withServer(extraEnv, fn) {
  const env = { ...process.env, ...extraEnv };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  const transport = new StdioClientTransport({ command: process.execPath, args: [ENTRY], env, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => (stderr += chunk));
  const client = new Client({ name: "verify-mock", version: "0" });
  await client.connect(transport);
  try {
    return await fn(client, () => stderr);
  } finally {
    await client.close();
  }
}

const singleAccountEnv = {
  CPANEL_HOST: "127.0.0.1",
  CPANEL_PORT: String(port),
  CPANEL_USER: "acct",
  CPANEL_TOKEN: TOKEN,
  CPANEL_INSECURE_TLS: "true",
  CPANEL_ACCOUNTS: undefined,
};

/** Fill in every required argument of a tool with a plausible value. */
function sampleArgs(tool) {
  const args = {};
  for (const name of tool.inputSchema.required ?? []) {
    const schema = tool.inputSchema.properties[name];
    if (schema.type === "number" || schema.type === "integer") args[name] = 5;
    else if (schema.type === "boolean") args[name] = true;
    else if (/pass/i.test(name)) args[name] = PASSWORD;
    else args[name] = `${name}-value`;
  }
  return args;
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (result) => result.content?.map((c) => c.text ?? "").join("\n") ?? "";

try {
  // ---- 1 + 4: every tool, every response shape
  const shapes = {
    object: { some: "value" },
    string: "support+example.com",
    number: 648,
    array: [{ some: "value" }],
    "empty array": [],
    boolean: true,
    null: null,
  };
  await withServer(singleAccountEnv, async (client) => {
    const { tools } = await client.listTools();
    check(tools.length > 0, "the server lists no tools");
    for (const [shapeName, data] of Object.entries(shapes)) {
      mock.data = data;
      for (const tool of tools) {
        for (const format of ["markdown", "json"]) {
          const before = mock.requests.length;
          let result;
          try {
            result = await client.callTool({ name: tool.name, arguments: { ...sampleArgs(tool), response_format: format } });
          } catch (e) {
            check(false, `${tool.name} (${format}): the MCP client rejected the result when UAPI data is a ${shapeName}: ${String(e.message).split("\n")[0]}`);
            continue;
          }
          check(mock.requests.length > before, `${tool.name}: made no UAPI request`);
          check(!result.isError, `${tool.name} (${format}): returned an error for a successful UAPI call (${shapeName}): ${text(result).slice(0, 120)}`);
          check(
            result.structuredContent === undefined || isPlainObject(result.structuredContent),
            `${tool.name}: structuredContent is not an object when UAPI data is a ${shapeName}`
          );
        }
      }
    }
    const inUrl = mock.requests.filter((r) => r.query.includes("do-not-leak") || r.fn.includes("do-not-leak"));
    check(inUrl.length === 0, `secrets appeared in ${inUrl.length} request URL(s), e.g. ${inUrl[0]?.fn}${inUrl[0]?.query}`);
    check(
      mock.requests.every((r) => r.auth === `cpanel acct:${TOKEN}`),
      "a request was sent without the expected 'cpanel user:token' Authorization header"
    );

    // ---- 2: a failing call is reported, not replaced
    mock.data = [];
    for (const tool of tools) {
      const before = mock.requests.length;
      // Find the function this tool calls first, then make it fail.
      await client.callTool({ name: tool.name, arguments: sampleArgs(tool) }).catch(() => undefined);
      const firstFn = mock.requests[before]?.fn;
      if (!firstFn) continue;
      mock.failing = new Set([firstFn]);
      const start = mock.requests.length;
      let result;
      let rejected;
      try {
        result = await client.callTool({ name: tool.name, arguments: sampleArgs(tool) });
      } catch (e) {
        rejected = String(e.message).split("\n")[0];
      }
      mock.failing = new Set();
      const made = mock.requests.slice(start).map((r) => r.fn);
      check(made.length === 1, `${tool.name}: after ${firstFn} failed it went on to call ${made.slice(1).join(", ")}`);
      check(!rejected, `${tool.name}: the MCP client rejected the result after ${firstFn} failed: ${rejected}`);
      if (rejected) continue;
      check(result.isError === true, `${tool.name}: ${firstFn} failed but the tool reported success: ${text(result).slice(0, 120)}`);
      check(text(result).includes(`mock failure in ${firstFn}`), `${tool.name}: the error does not carry cPanel's reason for ${firstFn}`);
    }
  });

  // ---- 3: CPANEL_ACCOUNTS problems are reported, without leaking tokens
  const accountCases = [
    {
      name: "invalid JSON",
      json: `{"alpha": {"host":"127.0.0.1","user":"acct","token":"${TOKEN}",}}`,
      account: "alpha",
      expect: /not valid JSON/,
      warns: true,
    },
    {
      name: "not an object",
      json: `["${TOKEN}"]`,
      account: "alpha",
      expect: /must be a JSON object/,
      warns: true,
    },
    {
      name: "entry missing its token",
      json: JSON.stringify({ alpha: { host: "127.0.0.1", user: "acct" }, beta: { host: "127.0.0.1", user: "acct", token: TOKEN, port } }),
      account: "alpha",
      expect: /'alpha'.*skipped.*token/,
      warns: true,
    },
    {
      name: "unknown account name",
      json: JSON.stringify({ beta: { host: "127.0.0.1", user: "acct", token: TOKEN, port } }),
      account: "gamma",
      expect: /Unknown account 'gamma'.*Configured accounts: beta/,
      warns: false,
    },
  ];
  for (const c of accountCases) {
    await withServer({ ...singleAccountEnv, CPANEL_ACCOUNTS: c.json }, async (client, stderr) => {
      const before = mock.requests.length;
      const result = await client.callTool({ name: "cpanel_list_domains", arguments: { account: c.account } });
      const message = text(result);
      check(result.isError === true, `CPANEL_ACCOUNTS ${c.name}: the tool did not report an error`);
      check(c.expect.test(message), `CPANEL_ACCOUNTS ${c.name}: unhelpful error: ${message}`);
      check(mock.requests.length === before, `CPANEL_ACCOUNTS ${c.name}: a request was sent anyway`);
      check(!message.includes(TOKEN), `CPANEL_ACCOUNTS ${c.name}: the tool error contains the token`);
      check(!stderr().includes(TOKEN), `CPANEL_ACCOUNTS ${c.name}: stderr contains the token`);
      check(/WARNING/.test(stderr()) === c.warns, `CPANEL_ACCOUNTS ${c.name}: ${c.warns ? "no startup warning on stderr" : "unexpected startup warning"}`);
    });
  }

  // A valid named account still works, alongside one that was skipped.
  mock.data = { main_domain: "example.com" };
  await withServer(
    {
      ...singleAccountEnv,
      CPANEL_HOST: undefined,
      CPANEL_USER: undefined,
      CPANEL_TOKEN: undefined,
      CPANEL_ACCOUNTS: JSON.stringify({
        good: { host: "127.0.0.1", user: "named", token: TOKEN, port, insecureTls: true },
        bad: { host: "127.0.0.1" },
      }),
    },
    async (client) => {
      const before = mock.requests.length;
      const result = await client.callTool({ name: "cpanel_list_domains", arguments: { account: "good" } });
      check(!result.isError, `a valid named account failed: ${text(result)}`);
      check(mock.requests[before]?.auth === `cpanel named:${TOKEN}`, "the named account's credentials were not used");
    }
  );
} finally {
  httpsServer.close();
  rmSync(certDir, { recursive: true, force: true });
}

if (failures.length) {
  const unique = [...new Set(failures)];
  console.error(`FAILED: ${unique.length} problem(s) in ${checks} checks`);
  for (const f of unique.slice(0, 40)) console.error(`  - ${f}`);
  if (unique.length > 40) console.error(`  … and ${unique.length - 40} more`);
  process.exit(1);
}
console.log(`OK: ${checks} checks — result shapes, error reporting, CPANEL_ACCOUNTS handling, no secrets in URLs`);
