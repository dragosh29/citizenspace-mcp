// Local stand-in for a Citizen Space site: the Data API under /api/1 (HTTP Basic key:secret) and the
// Public API under /api/2.4 (no authentication), serving the fixtures.
import http from "node:http";
import * as fx from "./fixtures.mjs";

// Obviously fake credentials: never the example header printed on the documentation page.
export const API_KEY = "cs-test-key-not-real";
export const API_SECRET = "cs-test-secret-not-real";
export const AUTH = "Basic " + Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64");
export const KEY_NAME = "Test Key"; // the documented whoami example

// Documented error body ({"error_message": ...}); the 404 text is the mock's own, Delib documents none.
const PERMISSION = { error_message: "Forbidden: Unauthorized: activity_search failed permission check" };
const notFoundBody = (what) => ({ error_message: `Not found: ${what}` });

// The mock serves at most this many responses per batch whatever batch_size asks for, so a 24-response
// activity spans three batches. Delib documents no maximum; its examples use batch_size=10.
export const BATCH_CAP = 10;

export function startMock() {
  const requests = [];
  // Injected failures: { method, path, status, times, headers, body, raw }. Each matching request consumes
  // one "time" and gets that status instead of the normal answer: `body` is sent as JSON, `raw` as an
  // HTML page with exactly that text, neither as the mock's own HTML page. The suite starts with a
  // single 429 on GET /api/1/activities so the retry path is exercised.
  const failure429 = () => ({ method: "GET", path: "/api/1/activities", status: 429, times: 1, headers: { "Retry-After": "1" }, body: { error_message: "Too many requests" } });
  let failures = [failure429()];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization, body: body ? JSON.parse(body) : undefined, t: Date.now() });

    const send = (status, json, headers = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(json === undefined ? "" : JSON.stringify(json));
    };

    // Injected failures apply to Public API requests as they come, and to Data API requests only once
    // their credentials have been accepted (a wrong key gets its 401 whatever is armed).
    const injected = () => {
      const failure = failures.find((f) => f.times > 0 && f.method === req.method && f.path === path);
      if (!failure) return false;
      failure.times--;
      if (failure.body === undefined) {
        // Gateway-style error (or a login page on a 200): not JSON.
        res.writeHead(failure.status, { "Content-Type": "text/html", ...(failure.headers ?? {}) });
        res.end(failure.raw ?? `<html><body><h1>${failure.status}</h1></body></html>`);
      } else send(failure.status, failure.body, failure.headers ?? {});
      return true;
    };

    const p = path.split("/").filter(Boolean);
    const m = req.method;

    // ---- Public API v2.4: no authentication, public activities only.
    if (p[0] === "api" && p[1] === "2.4" && m === "GET") {
      if (injected()) return;
      const tier = url.searchParams.get("fields") || "basic";
      const strip = (a) => {
        if (tier === "all") return a;
        const keys = tier === "extended" ? fx.PUBLIC_EXTENDED_KEYS : fx.PUBLIC_BASIC_KEYS;
        return Object.fromEntries(keys.map((k) => [k, a[k]]));
      };
      if (p[2] === "json_search_results" && p.length === 3) {
        const q = url.searchParams;
        const tx = q.get("tx")?.toLowerCase();
        const inRange = (a) => {
          const dk = q.get("dk");
          if (!dk || !["op", "cl"].includes(dk)) return true; // fd/td only apply with dk, as documented
          const d = dk === "op" ? a.startdate : a.enddate;
          const fd = q.get("fd");
          const td = q.get("td");
          return (!fd || d >= fd) && (!td || d <= td);
        };
        const items = fx.publicActivities.filter(
          (a) =>
            (!tx || a.title.toLowerCase().includes(tx) || a.overview.toLowerCase().includes(tx)) &&
            (!q.get("st") || a.status === q.get("st")) &&
            (!q.get("de") || a.dept === q.get("de")) &&
            (!q.get("ct") || a.type === q.get("ct")) &&
            (!q.get("au") || a.audiences.some((x) => x.id === q.get("au"))) &&
            (!q.get("in") || a.interests.some((x) => x.id === q.get("in"))) &&
            (!q.get("ar") || a.areas.some((x) => x.id === q.get("ar"))) &&
            inRange(a),
          // pc (postcode) is accepted and ignored by the mock: the site's postcode matching is not something a fixture can imitate.
        );
        return send(200, items.map(strip));
      }
      if (p[2] === "json_consultation_details" && p.length === 3) {
        const a = fx.publicActivities.find((x) => x.dept === url.searchParams.get("dept") && x.id === url.searchParams.get("id"));
        // Documented: "If dept or id are not specified or do not exist, a 404 status code is returned" (no body documented).
        if (!a) return send(404, { error: "Not found" });
        return send(200, strip(a));
      }
      return send(404, { error: "Not found" });
    }

    // ---- Data API v1: HTTP Basic key:secret.
    if (p[0] !== "api" || p[1] !== "1") return send(404, notFoundBody(path));
    const authed = req.headers.authorization === AUTH;
    if (p[2] === "whoami" && p.length === 3 && m === "GET") {
      // Documented: 200 with the key's name; "_anonymous_" under the 400 tab when not recognised.
      return authed ? send(200, KEY_NAME) : send(400, "_anonymous_");
    }
    if (!authed) return send(401, PERMISSION);
    if (injected()) return;

    if (p[2] === "activities" && m === "GET") {
      if (p.length === 3) return send(200, fx.activities);
      const a = fx.activities.find((x) => x.uid === p[3]);
      if (!a) return send(404, notFoundBody(`activity ${p[3]}`));
      // GET /api/1/activities/{uid} has no documented body; the mock answers with the list record.
      if (p.length === 4) return send(200, a);
      const sub = p[4];
      if (p.length === 5 && sub === "survey") return fx.surveys[a.uid] ? send(200, fx.surveys[a.uid]) : send(404, notFoundBody("survey"));
      if (p.length === 5 && sub === "pages") return send(200, fx.pages[a.uid] ?? []);
      if (p.length === 5 && sub === "questions") return send(200, fx.questions[a.uid] ?? []);
      if (p.length === 5 && sub === "components") return send(200, fx.components[a.uid] ?? []);
      if (p.length === 5 && sub === "mailinglist") return send(200, fx.mailingList[a.uid] ?? []);
      if (p.length === 5 && sub === "responses") return send(200, fx.responses[a.uid] ?? []);
      if (p.length === 5 && sub === "responses_batched") {
        const all = fx.responses[a.uid] ?? [];
        const requested = Number(url.searchParams.get("batch_size") || BATCH_CAP);
        const size = Math.min(Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : BATCH_CAP, BATCH_CAP);
        const start = Math.max(0, Number(url.searchParams.get("batch_start") || 0));
        const data = all.slice(start, start + size);
        const more = start + data.length < all.length;
        // Documented shape; next_batch_url is null on the last batch.
        return send(200, {
          batching: { total: all.length, batch_size: size, batch_start: start, next_batch_url: more ? `${path}?batch_size=${size}&batch_start=${start + data.length}` : null },
          responses: data,
        });
      }
      if (p.length >= 6 && sub === "responses") {
        const r = (fx.responses[a.uid] ?? []).find((x) => x.id === p[5]);
        if (!r) return send(404, notFoundBody(`response ${p[5]}`));
        if (p.length === 6) return send(200, r);
      }
    }
    if (p[2] === "users" && m === "GET" && p.length === 3) {
      // Documented query parameters: fullname, email, workspace_uid (how the site matches them is not).
      const q = url.searchParams;
      const items = fx.users.filter(
        (u) =>
          (!q.get("fullname") || u.fullname.toLowerCase().includes(q.get("fullname").toLowerCase())) &&
          (!q.get("email") || u.email.toLowerCase() === q.get("email").toLowerCase()) &&
          (!q.get("workspace_uid") || u.workspace_uid === q.get("workspace_uid")),
      );
      return send(200, items);
    }
    if (p[2] === "workspaces" && m === "GET") {
      if (p.length === 3) return send(200, fx.workspaces);
      const w = fx.workspaces.find((x) => x.uid === p[3]);
      if (!w) return send(404, notFoundBody(`workspace ${p[3]}`));
      if (p.length === 4) return send(200, w);
    }
    return send(404, notFoundBody(path));
  });

  /** Queue a failure for the next `times` requests matching method+path (body undefined = non-JSON page, its text `raw` when given). */
  const arm = ({ method, path, status, times = 1, headers, body, raw }) => {
    failures.push({ method, path, status, times, headers, body, raw });
  };
  const arm429 = ({ persistent = false, retryAfter = "1" } = {}) => {
    failures = [{ ...failure429(), times: persistent ? Infinity : 1, headers: { "Retry-After": retryAfter } }];
  };
  const disarm = () => {
    failures = [];
  };
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, requests, arm, arm429, disarm })));
}
