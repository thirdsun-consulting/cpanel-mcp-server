import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import * as https from "node:https";
import { REQUEST_TIMEOUT_MS } from "../constants.js";

interface CpanelAccountConfig {
  host: string;
  port: number;
  user: string;
  token: string;
  insecureTls: boolean;
}

const clients = new Map<string, AxiosInstance>();

/**
 * A problem with how the server is configured (env vars), as opposed to a
 * failure talking to cPanel. Messages must never contain token values.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Read default cPanel config from env. Single-account mode.
 */
function readDefaultConfig(): CpanelAccountConfig {
  const host = process.env.CPANEL_HOST;
  const user = process.env.CPANEL_USER;
  const token = process.env.CPANEL_TOKEN;
  const port = parseInt(process.env.CPANEL_PORT || "2083", 10);
  const insecureTls = (process.env.CPANEL_INSECURE_TLS || "").toLowerCase() === "true";
  if (!host) throw new ConfigError("CPANEL_HOST is not set.");
  if (!user) throw new ConfigError("CPANEL_USER is not set.");
  if (!token) {
    throw new ConfigError(
      "CPANEL_TOKEN is not set. Generate one in cPanel → Security → Manage API Tokens."
    );
  }
  return { host, port, user, token, insecureTls };
}

interface AccountsConfig {
  accounts: Record<string, CpanelAccountConfig>;
  /** Set when CPANEL_ACCOUNTS as a whole could not be used. */
  fatal?: string;
  /** Entries that were skipped, by account name, with the reason. */
  invalid: Record<string, string>;
}

/**
 * Multi-account mode: env var CPANEL_ACCOUNTS holds JSON like
 *   {"main":{"host":"...","user":"...","token":"...","port":2083}}
 * Tools accept an `account` parameter to choose which to use.
 *
 * Problems are recorded rather than swallowed, so a typo is reported at
 * startup and on the tool call that needs the account. The messages name the
 * account and the field only: the raw JSON holds tokens, so neither it nor
 * JSON.parse's own message (which quotes the input) is ever repeated.
 */
export function parseAccounts(json: string | undefined): AccountsConfig {
  const result: AccountsConfig = { accounts: {}, invalid: {} };
  if (!json || !json.trim()) return result;

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    const pos = /position (\d+)/.exec(e instanceof Error ? e.message : "")?.[1];
    result.fatal =
      `CPANEL_ACCOUNTS is not valid JSON${pos ? ` (parse error near character ${pos})` : ""}. ` +
      `No named accounts were loaded. Expected e.g. {"alpha":{"host":"...","user":"...","token":"..."}}.`;
    return result;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    result.fatal =
      "CPANEL_ACCOUNTS must be a JSON object that maps account names to {host, user, token}. " +
      "No named accounts were loaded.";
    return result;
  }

  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      result.invalid[name] = "its value must be an object with host, user and token";
      continue;
    }
    const cfg = value as Record<string, unknown>;
    const missing = ["host", "user", "token"].filter(
      (k) => typeof cfg[k] !== "string" || !(cfg[k] as string).trim()
    );
    if (missing.length) {
      result.invalid[name] = `missing or empty: ${missing.join(", ")}`;
      continue;
    }
    const port = cfg.port === undefined || cfg.port === null ? 2083 : Number(cfg.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      result.invalid[name] = "port must be a number between 1 and 65535";
      continue;
    }
    result.accounts[name] = {
      host: cfg.host as string,
      user: cfg.user as string,
      token: cfg.token as string,
      port,
      insecureTls: cfg.insecureTls === true,
    };
  }
  return result;
}

const accountsConfig = parseAccounts(process.env.CPANEL_ACCOUNTS);
const accounts = accountsConfig.accounts;

function getConfigFor(account?: string): CpanelAccountConfig {
  if (account && Object.hasOwn(accounts, account)) return accounts[account];
  if (account) {
    if (accountsConfig.fatal) {
      throw new ConfigError(`Account '${account}' is not available: ${accountsConfig.fatal}`);
    }
    if (Object.hasOwn(accountsConfig.invalid, account)) {
      throw new ConfigError(
        `Account '${account}' in CPANEL_ACCOUNTS was skipped: ${accountsConfig.invalid[account]}.`
      );
    }
    const names = Object.keys(accounts);
    throw new ConfigError(
      `Unknown account '${account}'. ` +
        (names.length
          ? `Configured accounts: ${names.join(", ")}.`
          : "CPANEL_ACCOUNTS is not set, so there are no named accounts.") +
        " Omit 'account' to use the single-account env vars."
    );
  }
  // No account requested — use single-account env vars
  return readDefaultConfig();
}

function getClientFor(account?: string): { client: AxiosInstance; cfg: CpanelAccountConfig } {
  const cfg = getConfigFor(account);
  const cacheKey = `${cfg.host}:${cfg.port}:${cfg.user}`;
  let client = clients.get(cacheKey);
  if (!client) {
    client = axios.create({
      baseURL: `https://${cfg.host}:${cfg.port}/execute`,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `cpanel ${cfg.user}:${cfg.token}`,
        Accept: "application/json",
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: !cfg.insecureTls }),
    });
    clients.set(cacheKey, client);
  }
  return { client, cfg };
}

/**
 * Call a UAPI function: https://host:port/execute/Module/function?...
 * UAPI return shape: { status: 0|1, errors: [], warnings: [], messages: [], data: ... }
 */
export async function uapi<T = any>(
  module: string,
  fn: string,
  params: Record<string, any> = {},
  options: { account?: string; method?: "GET" | "POST" } = {}
): Promise<T> {
  const { client } = getClientFor(options.account);
  const method = options.method ?? "GET";

  const cleanParams = Object.entries(params).reduce((acc, [k, v]) => {
    if (v === undefined || v === null) return acc;
    if (typeof v === "boolean") acc[k] = v ? 1 : 0;
    else acc[k] = v;
    return acc;
  }, {} as Record<string, any>);

  const cfg: AxiosRequestConfig = {
    method,
    url: `/${module}/${fn}`,
    ...(method === "GET"
      ? { params: cleanParams }
      : {
          data: new URLSearchParams(
            Object.entries(cleanParams).reduce((acc, [k, v]) => {
              if (Array.isArray(v)) v.forEach((vi, i) => (acc[`${k}-${i}`] = String(vi)));
              else acc[k] = String(v);
              return acc;
            }, {} as Record<string, string>)
          ).toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }),
  };

  const res = await client.request<any>(cfg);
  const body = res.data;

  if (body?.status === 0 || body?.status === false) {
    const reason =
      Array.isArray(body.errors) && body.errors.length
        ? body.errors.join("; ")
        : "UAPI call failed";
    throw new UapiError(reason, { module, fn, body });
  }
  return (body?.data ?? body) as T;
}

export class UapiError extends Error {
  details: any;
  constructor(message: string, details: any) {
    super(message);
    this.name = "UapiError";
    this.details = details;
  }
}

export function handleUapiError(error: unknown): string {
  if (error instanceof ConfigError) {
    return `Configuration error: ${error.message}`;
  }
  if (error instanceof UapiError) {
    return `cPanel UAPI error in ${error.details.module}::${error.details.fn}: ${error.message}`;
  }
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      return `Error ${status}: cPanel authentication failed. Check CPANEL_USER / CPANEL_TOKEN.`;
    }
    if (status === 404) {
      return "Error 404: UAPI endpoint not found. Verify module/function names.";
    }
    if (error.code === "ECONNREFUSED") {
      return `Error: Could not connect to cPanel. Verify CPANEL_HOST and CPANEL_PORT (default 2083).`;
    }
    if (
      error.code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
      error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
    ) {
      return "Error: TLS certificate could not be verified. If you trust this host, set CPANEL_INSECURE_TLS=true.";
    }
    if (error.code === "ECONNABORTED") {
      return "Error: Request timed out.";
    }
    return `Error ${status ?? "?"}: ${error.message}`;
  }
  return `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}

export function listConfiguredAccounts(): string[] {
  return Object.keys(accounts);
}

/** Problems found in CPANEL_ACCOUNTS, safe to log (no token values). */
export function listAccountConfigProblems(): string[] {
  return [
    ...(accountsConfig.fatal ? [accountsConfig.fatal] : []),
    ...Object.entries(accountsConfig.invalid).map(
      ([name, reason]) => `Account '${name}' in CPANEL_ACCOUNTS was skipped: ${reason}.`
    ),
  ];
}
