// Minimal Citizen Space client used by the MCP tools. Two APIs share one site:
//   Data API v1  https://<instance>.citizenspace.com/api/1/...   HTTP Basic, key:secret (Site Settings > API)
//   Public API   https://<instance>.citizenspace.com/api/2.4/... no authentication (public data only)
// Docs: https://delibdocs.gitbook.io/welcome/citizen-space/data-api and .../citizen-space/public-api
// Spec: https://<instance>.citizenspace.com/api/1/openapi.json (paths and parameters only; no schemas)
import { redactContacts } from "./format.js";

export class CitizenSpaceError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "CitizenSpaceError";
  }
}

// A 429 means the request was not processed, so it is safe to repeat for any method. A 502/503/504
// from a gateway does not prove the upstream did not process the request, so those are only retried
// for GET. Every tool in this server is a GET; the distinction is kept so the client stays safe if
// a write is ever added.
const RETRY_ANY_METHOD = new Set([429]);
const RETRY_GET_ONLY = new Set([502, 503, 504]);
const MAX_ATTEMPTS = 3;
// Longest single wait honoured from Retry-After. The MCP SDK's default request timeout is 60 s, so
// the whole retry budget (at most two waits) must stay well under that; a longer Retry-After makes
// the call give up at once with the wait time in the message.
export const MAX_RETRY_AFTER_S = 10;
// batch_size sent to responses_batched. The documentation shows batch_size=10 in its examples and
// documents no maximum or default; 50 is a guess to be confirmed on a real site.
export const BATCH_SIZE = 50;

export interface Credentials {
  key: string;
  secret: string;
}

// Documented (Data API "List responses (batched)"): {batching: {total, batch_size, batch_start,
// next_batch_url}, responses: [...]}; next_batch_url is null on the last batch.
export interface Batched<T> {
  batching?: { total?: number; batch_size?: number; batch_start?: number; next_batch_url?: string | null };
  responses?: T[];
}

export class CitizenSpaceClient {
  readonly baseUrl: string;
  private readonly authHeader?: string;
  // Every value that must never appear in an error message: the key, the secret and the base64
  // credential. A site or proxy that echoes the Authorization header in an error body (or a login
  // page) would otherwise put them into the tool result. Every body excerpt is scrubbed against this
  // list before it is cut to length, so a prefix of the credential cannot survive either.
  private readonly secrets: string[] = [];
  // Delib documents no rate limit for either API. Space requests at about four per second so a tool
  // call that pages through responses stays polite; 429s are retried using Retry-After.
  private nextSlot = 0;
  private readonly minIntervalMs = 250;

  constructor(baseUrl: string, credentials?: Credentials) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    // Docs ("Basic Auth headers with Citizen Space"): Authorization: Basic base64(key:secret).
    if (credentials) {
      const basic = Buffer.from(`${credentials.key}:${credentials.secret}`, "utf8").toString("base64");
      this.authHeader = "Basic " + basic;
      this.secrets.push(basic, credentials.key, credentials.secret);
    }
  }

  /** Replace every configured credential in a piece of text with "[redacted]". */
  private scrub(text: string): string {
    let out = text;
    for (const secret of this.secrets) if (secret.length >= 4) out = out.split(secret).join("[redacted]");
    return out;
  }

  get hasCredentials(): boolean {
    return this.authHeader !== undefined;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextSlot - now);
    this.nextSlot = Math.max(now, this.nextSlot) + this.minIntervalMs;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  /**
   * One request. `auth: true` (the Data API) sends the Basic header and fails fast without
   * credentials; `auth: false` (the Public API) never sends it.
   */
  async request<T = any>(method: string, path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown; auth?: boolean } = {}): Promise<T> {
    try {
      return await this.requestOnce<T>(method, path, opts);
    } catch (err) {
      // Belt and braces: nothing that escapes the client carries a credential, whatever produced it.
      if (err instanceof CitizenSpaceError) throw new CitizenSpaceError(this.scrub(err.message), err.status);
      if (err instanceof Error) err.message = this.scrub(err.message);
      throw err;
    }
  }

  private async requestOnce<T>(method: string, path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown; auth?: boolean }): Promise<T> {
    const auth = opts.auth ?? true;
    if (auth && !this.authHeader) {
      throw new CitizenSpaceError("This tool needs the Data API: set CITIZENSPACE_API_KEY and CITIZENSPACE_API_SECRET (an API key created under Site Settings > API on your Citizen Space site).");
    }
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));

    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: {
            ...(auth ? { Authorization: this.authHeader! } : {}),
            Accept: "application/json",
            ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });
      } catch (err) {
        throw new CitizenSpaceError(`Could not reach Citizen Space at ${this.baseUrl}: ${(err as Error).message}. Check CITIZENSPACE_INSTANCE (or CITIZENSPACE_BASE_URL).`);
      }

      const retryable = RETRY_ANY_METHOD.has(res.status) || (method === "GET" && RETRY_GET_ONLY.has(res.status));
      if (retryable && attempt < MAX_ATTEMPTS - 1) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        if (retryAfter !== undefined && retryAfter > MAX_RETRY_AFTER_S) {
          throw new CitizenSpaceError(
            `Citizen Space asked to wait ${Math.ceil(retryAfter)} seconds before retrying ${method} ${path} (HTTP ${res.status}). Try again after that.`,
            res.status,
          );
        }
        // A missing or unparsable header falls back to 2 s then 4 s; a Retry-After of 0 (or a date already
        // passed) means retry now, subject to the throttle.
        const delay = retryAfter !== undefined ? retryAfter * 1000 : 2000 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if (res.status === 204) return undefined as T;

      const text = await res.text();
      const json = text ? safeJson(text) : undefined;
      // Anything quoted from a body is scrubbed of credentials first and then redacted like any other
      // free text; the scrub runs on the whole body so that cutting it to length cannot leave a prefix.
      const excerpt = (raw: string | undefined, max: number) => (raw === undefined ? undefined : redactContacts(this.scrub(raw).slice(0, max), false));
      if (res.ok) {
        // Every documented 2xx body is JSON (an object, an array, or for whoami a string). A 200 with
        // HTML (a proxy, a captive portal, a login page) must not be mistaken for an empty list.
        if (json === undefined) {
          throw new CitizenSpaceError(
            `Citizen Space returned ${res.status} for ${method} ${path} but the body was not JSON (starts with: ${JSON.stringify(excerpt(text, 60) ?? "")}). Check CITIZENSPACE_INSTANCE / CITIZENSPACE_BASE_URL and whether a proxy or login page is in the way.`,
            res.status,
          );
        }
        return json as T;
      }

      // The documented error bodies are {"error_message": "..."} and {"error": {"error_message": "..."}}.
      // Their text is free text; redact anything that looks like a contact detail before passing it on.
      // A body that is not JSON is quoted only when it is not markup (a proxy's or gateway's HTML page
      // says nothing useful and can be long).
      const detail = excerpt(describeError(json) ?? (looksLikeMarkup(text) ? undefined : text.slice(0, 300)), 300);
      // Documented for the Data API: whoami answers "_anonymous_" (shown under a 400 tab) and other
      // endpoints answer "Forbidden: Unauthorized: ... failed permission check" (shown under a 400 tab;
      // observed live as a 401) when the key is missing, wrong, or lacks the permission.
      const unauthorised = res.status === 401 || res.status === 403 || (res.status === 400 && (json === "_anonymous_" || /unauthori[sz]ed|permission check/i.test(detail ?? "")));
      if (auth && unauthorised) throw new CitizenSpaceError(credentialAdvice(res.status, detail), res.status);
      if (res.status === 404) {
        throw new CitizenSpaceError(
          auth ? `Not found: ${path}. Check the UID or ID.${detail ? " " + detail : ""}` : `Not found: ${path} with ${url.searchParams.toString()}. The Public API answers 404 when dept or id do not exist or the activity is not public.${detail ? " " + detail : ""}`,
          404,
        );
      }
      if (res.status === 429) throw new CitizenSpaceError("Citizen Space rate limit reached (Delib documents no limit). Wait a minute and try again.", 429);
      if (res.status === 400) throw new CitizenSpaceError(`Citizen Space refused ${method} ${path} (400).${detail ? " " + detail : ""}`, 400);
      if (method !== "GET" && RETRY_GET_ONLY.has(res.status)) {
        throw new CitizenSpaceError(
          `Citizen Space returned ${res.status} for ${method} ${path}. The request was not retried because it may already have been processed: check the record before repeating it.${detail ? " " + detail : ""}`,
          res.status,
        );
      }
      if (RETRY_GET_ONLY.has(res.status)) {
        // A GET that failed MAX_ATTEMPTS times in a row. The gateway body is usually HTML, so only a JSON
        // error message is passed on.
        const jsonDetail = excerpt(describeError(json), 300);
        throw new CitizenSpaceError(
          `Citizen Space returned ${res.status} for ${method} ${path} ${MAX_ATTEMPTS} times in a row. The site may be unavailable; try again in a few minutes.${jsonDetail ? " " + jsonDetail : ""}`,
          res.status,
        );
      }
      throw new CitizenSpaceError(`Citizen Space returned ${res.status} for ${method} ${path}.${detail ? " " + detail : ""}`, res.status);
    }
  }

  /** Data API GET (Basic auth). */
  get<T = any>(path: string, query?: Record<string, string | number | undefined>) {
    return this.request<T>("GET", path, { query, auth: true });
  }

  /** Public API GET (no credentials sent, works without any). */
  publicGet<T = any>(path: string, query?: Record<string, string | number | undefined>) {
    return this.request<T>("GET", path, { query, auth: false });
  }

  /**
   * Page through GET /api/1/activities/{uid}/responses_batched with the documented batch_size and
   * batch_start parameters. Stops at `maxItems`, at `maxPages`, at an empty batch, when
   * `next_batch_url` is null (documented for the last batch), or when the records received reach
   * `batching.total`. The next batch starts where the received records end (`batch_start` plus the
   * number returned), or at the batch_start named in `next_batch_url` when it carries one, so a site
   * that serves fewer than `batch_size` per batch is still read in full.
   *
   * Two signals say whether more exist and either is enough: a non-empty `next_batch_url`, or a
   * `batching.total` above the number read so far. When neither is present (no `batching` object,
   * or one without `total` and without `next_batch_url`), paging continues until an empty batch.
   * Only the documented null stops paging on its own. A body without a `responses` list is an error,
   * never an empty list.
   */
  async listResponses<T = any>(activityUid: string, { maxItems = BATCH_SIZE, maxPages = 20, batchStart = 0 } = {}): Promise<{ items: T[]; total?: number; complete: boolean; next_batch_start?: number }> {
    const items: T[] = [];
    let total: number | undefined;
    let cursor = batchStart;
    const path = `/api/1/activities/${activityUid}/responses_batched`;
    for (let page = 0; page < maxPages; page++) {
      const size = Math.min(BATCH_SIZE, maxItems - items.length);
      const res = await this.get<Batched<T>>(path, { batch_size: size, batch_start: cursor });
      if (!res || typeof res !== "object" || !Array.isArray(res.responses)) {
        throw new CitizenSpaceError(`Citizen Space answered GET ${path} with ${describeShape(res)}; expected {batching: {...}, responses: [...]} as documented. The responses were not read.`);
      }
      const data = res.responses;
      const b = res.batching && typeof res.batching === "object" ? res.batching : undefined;
      if (typeof b?.total === "number" && Number.isFinite(b.total)) total = b.total;
      items.push(...data);
      const next = b?.next_batch_url;
      cursor = batchStartFromUrl(next) ?? cursor + data.length;
      // The documented null is the only signal that ends paging by itself; otherwise a known total decides,
      // and with no total at all only an empty batch does.
      const hasNext = data.length > 0 && next !== null && (total === undefined || cursor < total);
      if (items.length >= maxItems) return { items: items.slice(0, maxItems), total, complete: !hasNext, next_batch_start: hasNext ? cursor : undefined };
      if (!hasNext) return { items, total, complete: true };
    }
    return { items, total, complete: false, next_batch_start: cursor };
  }
}

/** The batch_start query value of a next_batch_url, when it has one. */
export function batchStartFromUrl(next: unknown): number | undefined {
  if (typeof next !== "string" || next === "") return undefined;
  try {
    const v = new URL(next, "https://placeholder.invalid").searchParams.get("batch_start");
    return v !== null && /^\d+$/.test(v) ? Number(v) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Retry-After in seconds, from either form allowed by RFC 9110 (delay-seconds or an HTTP-date).
 * A fractional number is accepted as seconds too. Anything else that is not an HTTP-date (which always
 * names a month, so contains letters) gives undefined, so the caller's fallback applies; without that
 * check Date.parse("1.5") would be read as a date in 2001 and the retry would happen at once.
 */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const h = header.trim();
  if (/^\d+(\.\d+)?$/.test(h)) return Number(h);
  if (!/[A-Za-z]/.test(h)) return undefined;
  const at = Date.parse(h);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, (at - now) / 1000);
}

function credentialAdvice(status: number, detail?: string): string {
  return (
    `Citizen Space rejected the API key (${status}). Check CITIZENSPACE_API_KEY and CITIZENSPACE_API_SECRET: they are the Key and Secret of an API key created under Site Settings > API on your Citizen Space site, sent as HTTP Basic key:secret. ` +
    `If they are right, the key may lack the permission this call needs (for example activities.search, activities.read, activities.responses.read, activities.mailinglist.read, users.search or workspaces.search), or the Data API may not be enabled on the site yet.` +
    (detail ? " " + detail : "")
  );
}

/** A short description of an unexpected body for an error message: "a list of 3 items", "a string", "null". */
function describeShape(v: unknown): string {
  if (v === null || v === undefined) return "an empty body";
  if (Array.isArray(v)) return `a list of ${v.length} item${v.length === 1 ? "" : "s"}`;
  if (typeof v === "object") return `an object with keys ${Object.keys(v as object).slice(0, 8).join(", ") || "(none)"}`;
  return `a ${typeof v}`;
}

/** True when a body starts with a tag (HTML, XML), so it is a page rather than a message. */
function looksLikeMarkup(text: string): boolean {
  return text.trimStart().startsWith("<");
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Documented shapes: {"error_message": "..."} (API specification page) and
// {"error": {"error_message": "..."}} (Basic Auth page). A bare string body is passed on as is.
function describeError(json: any): string | undefined {
  if (typeof json === "string") return json.trim() || undefined;
  if (!json || typeof json !== "object") return undefined;
  const msg = json.error_message ?? json.error?.error_message ?? (typeof json.error === "string" ? json.error : undefined) ?? json.message;
  return typeof msg === "string" && msg.trim() ? msg : undefined;
}
