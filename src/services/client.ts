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
 * Read default cPanel config from env. Single-account mode.
 */
function readDefaultConfig(): CpanelAccountConfig {
  const host = process.env.CPANEL_HOST;
  const user = process.env.CPANEL_USER;
  const token = process.env.CPANEL_TOKEN;
  const port = parseInt(process.env.CPANEL_PORT || "2083", 10);
  const insecureTls = (process.env.CPANEL_INSECURE_TLS || "").toLowerCase() === "true";
  if (!host) throw new Error("CPANEL_HOST is not set.");
  if (!user) throw new Error("CPANEL_USER is not set.");
  if (!token) {
    throw new Error(
      "CPANEL_TOKEN is not set. Generate one in cPanel → Security → Manage API Tokens."
    );
  }
  return { host, port, user, token, insecureTls };
}

/**
 * Multi-account mode: env var CPANEL_ACCOUNTS holds JSON like
 *   {"main":{"host":"...","user":"...","token":"...","port":2083}}
 * Tools accept an `account` parameter to choose which to use.
 */
function readAccountsMap(): Record<string, CpanelAccountConfig> {
  const json = process.env.CPANEL_ACCOUNTS;
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as Record<string, Partial<CpanelAccountConfig>>;
    const result: Record<string, CpanelAccountConfig> = {};
    for (const [name, cfg] of Object.entries(raw)) {
      if (!cfg.host || !cfg.user || !cfg.token) continue;
      result[name] = {
        host: cfg.host,
        user: cfg.user,
        token: cfg.token,
        port: cfg.port ?? 2083,
        insecureTls: cfg.insecureTls ?? false,
      };
    }
    return result;
  } catch {
    return {};
  }
}

const accounts = readAccountsMap();

function getConfigFor(account?: string): CpanelAccountConfig {
  if (account && accounts[account]) return accounts[account];
  if (account) {
    throw new Error(
      `Unknown account '${account}'. Configure it in CPANEL_ACCOUNTS env var, or omit 'account' to use defaults.`
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
