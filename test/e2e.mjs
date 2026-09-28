// End-to-end test: the schemas written from Delib's documented examples are checked against those
// examples, the fixtures and the mock against the schemas, then the built MCP server is driven over
// stdio by a real MCP client against a local mock of a Citizen Space site (Data API and Public API).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as fx from "./fixtures.mjs";
import * as S from "./schemas.mjs";
import * as doc from "./documented-examples.mjs";
import { startMock, API_KEY, API_SECRET, AUTH, KEY_NAME, BATCH_CAP } from "./mock-server.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

// 1. The OpenAPI document (paths and parameters, no schemas) is downloaded on the first run; the
// schemas come from the documented examples in test/documented-examples.mjs.
const SPEC_URL = "https://demo.citizenspace.com/api/1/openapi.json";
if (!existsSync(`${root}spec.json`)) {
  try {
    writeFileSync(`${root}spec.json`, await (await fetch(SPEC_URL)).text());
  } catch (err) {
    console.error(`Could not download the Citizen Space OpenAPI document (${err?.cause?.code ?? err.message}). Save it manually:\n  curl -o spec.json ${SPEC_URL}`);
    process.exit(1);
  }
}
const spec = JSON.parse(readFileSync(`${root}spec.json`, "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const compiled = new Map();
const validateWith = (schema, obj, label) => {
  if (!compiled.has(schema)) compiled.set(schema, ajv.compile(schema));
  const v = compiled.get(schema);
  assert.ok(v(obj), `${label}: ${ajv.errorsText(v.errors)}`);
};
// The Data API's documented method+path templates come from the OpenAPI document; the Public API's
// two methods from the "Version 2.4 reference" page (they are not in the OpenAPI document).
const dataApiOps = Object.entries(spec.paths).flatMap(([p, ops]) => Object.keys(ops).filter((m) => m !== "parameters").map((m) => ({ m: m.toUpperCase(), path: p })));
const PUBLIC_OPS = [
  { m: "GET", path: "/api/2.4/json_search_results" },
  { m: "GET", path: "/api/2.4/json_consultation_details" },
];
const templates = [...dataApiOps, ...PUBLIC_OPS].map((o) => ({ ...o, re: new RegExp("^" + o.path.replace(/\{[^}]+\}/g, "[^/]+") + "$") }));
const documented = (method, path) => dataApiOps.some((o) => o.m === method && o.path === path);

console.log("schemas vs the documented examples, fixtures vs the schemas");
await check("every schema accepts the documented example it was written from; the OpenAPI document has 26 operations, no schemas and every Data API endpoint used; mock credentials are fake", async () => {
  validateWith(S.WhoAmI, doc.whoami.ok, "whoami 200 example");
  validateWith(S.WhoAmI, doc.whoami.anonymous, "whoami 400 example");
  doc.activities.forEach((a, i) => validateWith(S.Activity, a, `activity example ${i}`));
  validateWith(S.ErrorBody, doc.errors.flat, "error example (specification page)");
  validateWith(S.ErrorBody, doc.errors.wrapped, "error example (Basic Auth page)");
  validateWith(S.Survey, doc.survey, "survey example");
  validateWith(S.Page, doc.page, "page example");
  doc.questions.forEach((q, i) => validateWith(S.Question, q, `question example ${i}`));
  doc.components.forEach((c, i) => validateWith(S.Component, c, `component example ${i}`));
  validateWith(S.Response, doc.response, "response example");
  validateWith(S.Batched, doc.batched, "responses_batched example");
  // Not documentation: one record observed on the demo site, to check the reference's field types once.
  validateWith(S.PublicActivity, doc.observedPublicActivity, "public activity observed on demo.citizenspace.com");
  assert.equal(spec.openapi, "3.0.1");
  assert.equal(dataApiOps.length, 26, "26 operations in the OpenAPI document");
  assert.equal(spec.components, undefined, "the OpenAPI document declares no components (so no schemas and no securitySchemes)");
  for (const [m, p] of [
    ["GET", "/api/1/whoami"],
    ["GET", "/api/1/activities"],
    ["GET", "/api/1/activities/{activity_uid}"],
    ["GET", "/api/1/activities/{activity_uid}/survey"],
    ["GET", "/api/1/activities/{activity_uid}/pages"],
    ["GET", "/api/1/activities/{activity_uid}/questions"],
    ["GET", "/api/1/activities/{activity_uid}/components"],
    ["GET", "/api/1/activities/{activity_uid}/mailinglist"],
    ["GET", "/api/1/activities/{activity_uid}/responses_batched"],
    ["GET", "/api/1/activities/{activity_uid}/responses/{response_id}"],
    ["GET", "/api/1/users"],
    ["GET", "/api/1/workspaces"],
    ["GET", "/api/1/workspaces/{workspace_uid}"],
  ]) assert.ok(documented(m, p), `${m} ${p} is not in the OpenAPI document`);
  const batched = spec.paths["/api/1/activities/{activity_uid}/responses_batched"].get.parameters.filter((x) => x.in === "query").map((x) => x.name).sort();
  assert.deepEqual(batched, ["batch_size", "batch_start"], "the documented batching parameters");
  const users = spec.paths["/api/1/users"].get.parameters.filter((x) => x.in === "query").map((x) => x.name).sort();
  assert.deepEqual(users, ["email", "fullname", "workspace_uid"], "the documented user filters");
  // The write operations exist in the document but their bodies are typed as null ("A mapping of the
  // fields and values to update"), which is why this server has no write tools.
  for (const p of ["/api/1/activities/{activity_uid}", "/api/1/activities/{activity_uid}/responses/{response_id}"]) {
    assert.equal(spec.paths[p].post.requestBody.content["application/json"].schema, null, `${p} POST body has no schema`);
  }
  const texts = JSON.stringify(spec) + JSON.stringify(doc);
  for (const [name, value] of [["API_KEY", API_KEY], ["API_SECRET", API_SECRET]]) {
    assert.match(value, /^cs-test-[a-z]+-not-real$/, `${name} must be an obviously fake, low-entropy value`);
    assert.ok(!texts.includes(value), `${name} must not appear in the documentation or the spec`);
  }
});

await check("activities, surveys, pages, questions, components, responses, batches and public activities (every tier) match the schemas", async () => {
  fx.activities.forEach((a) => validateWith(S.Activity, a, `activity ${a.uid}`));
  Object.values(fx.surveys).forEach((s, i) => validateWith(S.Survey, s, `survey ${i}`));
  Object.values(fx.pages).flat().forEach((p) => validateWith(S.Page, p, `page ${p.id}`));
  Object.values(fx.questions).flat().forEach((q) => validateWith(S.Question, q, `question ${q.id}`));
  Object.values(fx.components).flat().forEach((c) => validateWith(S.Component, c, `component ${c.id}`));
  Object.values(fx.responses).flat().forEach((r) => validateWith(S.Response, r, `response ${r.id}`));
  assert.equal(fx.responses[fx.PARK].length, 24, "the documented batching example has total 24");
  validateWith(S.Batched, { batching: { total: 24, batch_size: 10, batch_start: 20, next_batch_url: null }, responses: fx.responses[fx.PARK].slice(20) }, "a last batch");
  fx.publicActivities.forEach((a) => validateWith(S.PublicActivity, a, `public activity ${a.id}`));
  fx.publicActivities.forEach((a) => validateWith(S.PublicActivityBasicOnly, Object.fromEntries(fx.PUBLIC_BASIC_KEYS.map((k) => [k, a[k]])), `basic tier of ${a.id}`));
  const ids = [...fx.activities.map((a) => a.uid), ...Object.values(fx.responses).flat().map((r) => r.id), ...fx.workspaces.map((w) => w.uid)];
  assert.equal(new Set(ids).size, ids.length, "every fixture id is distinct");
});

// 2. The mock's responses match the documented shapes and behaviours.
const { server: mock, port, requests, arm, arm429, disarm } = await startMock();
const base = `http://127.0.0.1:${port}`;
const raw = async (path, headers = {}) => {
  const res = await fetch(base + path, { headers });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : undefined };
};
await check("mock: Basic-auth 401 with the documented error body, whoami as documented, 404s, batching with next_batch_url, public tiers, a one-off 429", async () => {
  const anon = await raw("/api/1/activities");
  assert.equal(anon.status, 401);
  validateWith(S.ErrorBody, anon.json, "401 body");
  assert.equal((await raw("/api/1/activities", { Authorization: "Basic " + Buffer.from("cs-wrong-key:cs-wrong-secret").toString("base64") })).status, 401);
  const who = await raw("/api/1/whoami", { Authorization: AUTH });
  assert.deepEqual([who.status, who.json], [200, KEY_NAME]);
  validateWith(S.WhoAmI, who.json, "whoami");
  const whoAnon = await raw("/api/1/whoami");
  assert.deepEqual([whoAnon.status, whoAnon.json], [400, "_anonymous_"]);
  const limited = await raw("/api/1/activities", { Authorization: AUTH }); // first call answers 429
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "1");
  const list = await raw("/api/1/activities", { Authorization: AUTH });
  assert.equal(list.status, 200);
  validateWith(S.arrayOf(S.Activity, 1), list.json, "GET /api/1/activities");
  validateWith(S.Activity, (await raw(`/api/1/activities/${fx.PARK}`, { Authorization: AUTH })).json, "GET /api/1/activities/{uid} (mock: list record)");
  assert.equal((await raw("/api/1/activities/0000000000000000000000000000dead", { Authorization: AUTH })).status, 404);
  validateWith(S.Survey, (await raw(`/api/1/activities/${fx.PARK}/survey`, { Authorization: AUTH })).json, "survey");
  validateWith(S.arrayOf(S.Page, 1), (await raw(`/api/1/activities/${fx.PARK}/pages`, { Authorization: AUTH })).json, "pages");
  validateWith(S.arrayOf(S.Question, 1), (await raw(`/api/1/activities/${fx.PARK}/questions`, { Authorization: AUTH })).json, "questions");
  validateWith(S.arrayOf(S.Component, 1), (await raw(`/api/1/activities/${fx.PARK}/components`, { Authorization: AUTH })).json, "components");
  validateWith(S.Response, (await raw(`/api/1/activities/${fx.PARK}/responses/ANON-PARK-0001-C`, { Authorization: AUTH })).json, "one response");
  assert.equal((await raw(`/api/1/activities/${fx.PARK}/responses/ANON-PARK-9999-C`, { Authorization: AUTH })).status, 404);
  const b1 = (await raw(`/api/1/activities/${fx.PARK}/responses_batched?batch_size=10&batch_start=0`, { Authorization: AUTH })).json;
  validateWith(S.Batched, b1, "batch 1");
  assert.deepEqual([b1.batching.total, b1.batching.batch_size, b1.batching.batch_start, b1.responses.length], [24, 10, 0, 10]);
  assert.match(b1.batching.next_batch_url, /batch_start=10$/);
  const b3 = (await raw(`/api/1/activities/${fx.PARK}/responses_batched?batch_size=10&batch_start=20`, { Authorization: AUTH })).json;
  validateWith(S.Batched, b3, "batch 3");
  assert.deepEqual([b3.batching.next_batch_url, b3.responses.length], [null, 4], "the documented last batch: next_batch_url null");
  const capped = (await raw(`/api/1/activities/${fx.PARK}/responses_batched?batch_size=50`, { Authorization: AUTH })).json;
  assert.equal(capped.responses.length, BATCH_CAP, "the mock caps a batch so lists span several batches");
  assert.equal((await raw(`/api/1/activities/${fx.PARK}/mailinglist`, { Authorization: AUTH })).json.length, 3);
  assert.equal((await raw("/api/1/users?fullname=dana", { Authorization: AUTH })).json.length, 1);
  assert.equal((await raw("/api/1/workspaces", { Authorization: AUTH })).json.length, 2);
  assert.equal((await raw(`/api/1/workspaces/${fx.workspaces[1].uid}`, { Authorization: AUTH })).json.title, fx.workspaces[1].title);
  // Public API: no credentials, tiers by `fields`, 404 for an unknown dept/id.
  const basic = (await raw("/api/2.4/json_search_results")).json;
  validateWith(S.arrayOf(S.PublicActivityBasicOnly, 3), basic, "public basic tier");
  const extended = (await raw("/api/2.4/json_search_results?fields=extended")).json;
  assert.deepEqual(Object.keys(extended[0]).sort(), [...fx.PUBLIC_EXTENDED_KEYS].sort());
  validateWith(S.arrayOf(S.PublicActivity, 3), (await raw("/api/2.4/json_search_results?fields=all")).json, "public all tier");
  assert.deepEqual((await raw("/api/2.4/json_search_results?st=closed")).json.map((a) => a.id), ["central-library-opening-hours"]);
  validateWith(S.PublicActivity, (await raw("/api/2.4/json_consultation_details?dept=parks-and-recreation&id=kings-gardens-spring-planting&fields=all")).json, "public details");
  assert.equal((await raw("/api/2.4/json_consultation_details?dept=nope&id=nope")).status, 404);
});
requests.length = 0; // only count what the MCP server does from here on
arm429();

// 3. Drive the server through MCP.
const connect = async ({ key = API_KEY, secret = API_SECRET, extra = {} } = {}) => {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  const env = { ...process.env, CITIZENSPACE_BASE_URL: base, CITIZENSPACE_ALLOW_WRITES: "true", ...extra };
  delete env.CITIZENSPACE_INSTANCE;
  delete env.CITIZENSPACE_API_KEY;
  delete env.CITIZENSPACE_API_SECRET;
  if (key !== null) env.CITIZENSPACE_API_KEY = key;
  if (secret !== null) env.CITIZENSPACE_API_SECRET = secret;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [`${root}dist/index.js`], env, stderr: "ignore" }));
  return client;
};
const call = async (client, name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  return { res, data: res.isError ? undefined : JSON.parse(res.content[0].text), text: res.content[0].text };
};
const since = (n) => requests.slice(n);
const PUBLIC_TOOLS = ["get_public_activity", "search_public_activities"];
const DATA_TOOLS = ["get_activity", "get_mailing_list", "get_response_answers", "get_survey_structure", "list_activities", "list_responses", "list_users", "list_workspaces", "whoami"];
// A street address typed into a free-text answer ("4 Plymouth Road" in the fixtures) is not on this list: no
// pattern here detects one, which the README says. Emails, phone numbers and postcodes are.
const PERSONAL = ["@example.com", "@example.gov.uk", "@example.net", "@example.org", "07700 900123", "07700 900999", "CF64 3DH", "cf64 3dh", "203.0.113.", "0117 496 000", "029 2000 0000", "BS8 1AA", "Person 1", "Person 2", "12/03/1985", "943 476 5919", "QQ 12 34 56 C", "4111 1111", "Jane Doe", "1980-01-02"];
const noLeak = (data, extra = []) => {
  const text = JSON.stringify(data);
  for (const leak of [...PERSONAL, ...extra]) assert.ok(!text.includes(leak), `${leak} leaked in the default output`);
};

const client = await connect();
console.log("mcp tools");

await check("tools/list exposes 11 read-only tools and no write tool even with CITIZENSPACE_ALLOW_WRITES=true; listing makes no API call", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...PUBLIC_TOOLS, ...DATA_TOOLS].sort());
  for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, `${t.name} readOnlyHint`);
  assert.equal(requests.length, 0);
});

await check("without credentials only the two Public API tools are registered; a key without a secret, a bad instance and no instance stop the server at start-up", async () => {
  const pub = await connect({ key: null, secret: null });
  const { tools } = await pub.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), PUBLIC_TOOLS);
  const { data } = await call(pub, "search_public_activities", { state: "open" });
  assert.equal(data.count, 1);
  await pub.close();
  // Starts the server with the given environment and resolves when it exits, which it does on its own
  // for a refused configuration and by being killed once it prints "server running"; a server that does
  // neither within 10 s is killed and reported as a timeout rather than hanging the suite.
  const run = (env) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [`${root}dist/index.js`], { env: { ...process.env, ...env }, stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        resolve({ code: "timeout", stderr });
      }, 10_000);
      child.stderr.on("data", (d) => {
        stderr += d;
        if (/server running/.test(stderr)) child.kill();
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolve({ code, stderr });
      });
    });
  const clean = { CITIZENSPACE_INSTANCE: "", CITIZENSPACE_BASE_URL: "", CITIZENSPACE_API_KEY: "", CITIZENSPACE_API_SECRET: "" };
  const halfKey = await run({ ...clean, CITIZENSPACE_INSTANCE: "acme", CITIZENSPACE_API_KEY: API_KEY });
  assert.equal(halfKey.code, 1);
  assert.match(halfKey.stderr, /CITIZENSPACE_API_KEY and CITIZENSPACE_API_SECRET must be set together/);
  assert.ok(!halfKey.stderr.includes(API_KEY), "the key is not echoed");
  const badInstance = await run({ ...clean, CITIZENSPACE_INSTANCE: "acme.citizenspace.com" });
  assert.equal(badInstance.code, 1);
  assert.match(badInstance.stderr, /CITIZENSPACE_INSTANCE must be the subdomain/);
  const none = await run(clean);
  assert.equal(none.code, 1);
  assert.match(none.stderr, /CITIZENSPACE_INSTANCE is not set/);
  const instanceOnly = await run({ ...clean, CITIZENSPACE_INSTANCE: "acme" });
  assert.match(instanceOnly.stderr, /running against https:\/\/acme\.citizenspace\.com \(Data API tools disabled/, "the instance alone gives the documented host");
  // Start-up makes no request: a server pointed at the mock, with credentials, is up before the mock sees anything.
  const n = requests.length;
  const startedAtMock = await run({ ...clean, CITIZENSPACE_BASE_URL: base, CITIZENSPACE_API_KEY: API_KEY, CITIZENSPACE_API_SECRET: API_SECRET });
  assert.match(startedAtMock.stderr, /server running against http:\/\/127\.0\.0\.1:\d+ \(Data API tools enabled/);
  assert.equal(requests.length, n, "no request is made at start-up");
});

await check("search_public_activities sends no Authorization header, returns the basic tier by default, and passes every documented argument through exactly (tx, pc, st, au, in, de, ar, dk, fd, td, ct, fields)", async () => {
  const n = requests.length;
  const { data } = await call(client, "search_public_activities");
  assert.deepEqual(since(n).map((r) => [r.method, r.path, r.query, r.auth]), [["GET", "/api/2.4/json_search_results", {}, undefined]], "no arguments, no credentials");
  assert.deepEqual([data.count, data.total_matching, data.note], [3, 3, undefined]);
  assert.deepEqual(Object.keys(data.activities[0]).sort(), [...fx.PUBLIC_BASIC_KEYS].sort(), "basic tier: the seven documented fields");
  assert.deepEqual(data.activities.map((a) => [a.id, a.status]), [["kings-gardens-spring-planting", "open"], ["central-library-opening-hours", "closed"], ["budget-2027-priorities", "forthcoming"]]);
  const everything = await call(client, "search_public_activities", {
    text: "planting",
    postcode: "BS8 1",
    state: "open",
    audience_id: "residents",
    interest_id: "parks",
    department_id: "parks-and-recreation",
    area_id: "central",
    date_kind: "op",
    date_from: "2026-01-01",
    date_to: "2026/12/31",
    activity_type: "QuickConsult",
    fields: "extended",
  });
  assert.deepEqual(requests.at(-1).query, { tx: "planting", pc: "BS8 1", st: "open", au: "residents", in: "parks", de: "parks-and-recreation", ar: "central", dk: "op", fd: "2026/01/01", td: "2026/12/31", ct: "QuickConsult", fields: "extended" }, "each argument under its documented name; yyyy-mm-dd converted to the documented yyyy/mm/dd");
  assert.deepEqual(everything.data.activities.map((a) => a.id), ["kings-gardens-spring-planting"]);
  assert.equal(everything.data.activities[0].participation_url, fx.publicActivities[0].participation_url);
  assert.equal(everything.data.activities[0].contact_name, undefined, "extended tier has no contact fields");
  const closeDates = await call(client, "search_public_activities", { date_kind: "cl", date_from: "2027/01/01" });
  assert.deepEqual(closeDates.data.activities.map((a) => a.id), ["budget-2027-priorities"]);
  const byType = await call(client, "search_public_activities", { activity_type: "File" });
  assert.deepEqual([requests.at(-1).query.ct, byType.data.activities.map((a) => a.id)], ["File", ["central-library-opening-hours"]]);
  const limited = await call(client, "search_public_activities", { max_results: 2 });
  assert.deepEqual([limited.data.count, limited.data.total_matching], [2, 3]);
  assert.match(limited.data.note, /first 2 of 3/);
  const before = requests.length;
  for (const [args, why] of [
    [{ date_from: "2026/01/01" }, /need date_kind/],
    [{ date_kind: "op" }, /needs date_from/],
    [{ date_from: "12/08/2026", date_kind: "op" }, /yyyy\/mm\/dd/],
    [{ date_to: "2026/13/45", date_kind: "cl" }, /Not a real date/],
    [{ date_from: "2026/02/30", date_kind: "op" }, /Not a real date/],
    [{ date_to: "2026-04-31", date_kind: "cl" }, /Not a real date/],
    [{ state: "live" }, /./],
    [{ activity_type: "Survey" }, /./],
    [{ department_id: "a/b" }, /slug/],
  ]) {
    const bad = await client.callTool({ name: "search_public_activities", arguments: args });
    assert.ok(bad.isError, `${JSON.stringify(args)} must be refused`);
    assert.match(bad.content[0].text, why);
  }
  assert.equal(requests.length, before, "refused locally, no request");
});

await check("search_public_activities with fields=all withholds the officer's phone and email and redacts contact details in text by default, and returns them on request", async () => {
  const { data } = await call(client, "search_public_activities", { fields: "all" });
  assert.equal(requests.at(-1).query.fields, "all");
  const lib = data.activities[1];
  assert.equal(lib.contact_name, "Dana Barrett", "names are returned");
  assert.equal(lib.contact_jobtitle, "Engagement officer");
  assert.deepEqual([lib.contact_phone, lib.contact_email], [undefined, undefined], "phone and email only on request");
  assert.equal(lib.overview, "<p>Opening hours review. Email [email redacted] or ring [phone redacted] with questions. Drop-in at [postcode redacted].</p>");
  assert.deepEqual(lib.related_links, [{ url: "https://example.gov.uk/contact?officer=[email redacted]", title: "Contact the team" }], "an email in a URL is redacted like any other string");
  assert.deepEqual(lib.supporting_documents, [{ url: "https://mock.citizenspace.test/files/plan.pdf", title: "Planting plan", size: "1.2 MB" }]);
  assert.deepEqual([lib.audiences, lib.interests, lib.areas], [[{ id: "students", name: "Students" }], [{ id: "libraries", name: "Libraries" }], [{ id: "north", name: "North (office [phone redacted])" }]], "a phone number in an area's name is redacted");
  assert.equal(lib.why, "We are consulting because the council must decide by spring.");
  noLeak(data);
  const full = await call(client, "search_public_activities", { fields: "all", include_contact_details: true });
  const libFull = full.data.activities[1];
  assert.deepEqual([libFull.contact_phone, libFull.contact_email], ["0117 496 0000", "dana.barrett@example.gov.uk"]);
  assert.equal(libFull.overview, fx.publicActivities[1].overview);
  assert.deepEqual([libFull.related_links, libFull.areas], [fx.publicActivities[1].related_links, fx.publicActivities[1].areas]);
});

await check("get_public_activity passes dept and id through, defaults to fields=all, gives a clear 404 for an unknown activity, and refuses bad slugs before any call", async () => {
  const n = requests.length;
  const { data } = await call(client, "get_public_activity", { dept: "parks-and-recreation", id: "kings-gardens-spring-planting" });
  assert.deepEqual(since(n).map((r) => [r.path, r.query, r.auth]), [["/api/2.4/json_consultation_details", { dept: "parks-and-recreation", id: "kings-gardens-spring-planting", fields: "all" }, undefined]]);
  assert.deepEqual([data.activity.id, data.activity.title, data.activity.status, data.activity.contact_email], ["kings-gardens-spring-planting", "Kings Gardens spring planting", "open", undefined]);
  const basic = await call(client, "get_public_activity", { dept: "finance", id: "budget-2027-priorities", fields: "basic" });
  assert.equal(requests.at(-1).query.fields, undefined, "basic is the documented default and is not sent");
  assert.deepEqual(Object.keys(basic.data.activity).sort(), [...fx.PUBLIC_BASIC_KEYS].sort());
  const missing = await call(client, "get_public_activity", { dept: "parks-and-recreation", id: "nope" });
  assert.ok(missing.res.isError);
  assert.match(missing.text, /Not found: \/api\/2\.4\/json_consultation_details with dept=parks-and-recreation&id=nope&fields=all\. The Public API answers 404 when dept or id do not exist/);
  const before = requests.length;
  for (const args of [{ dept: "a/b", id: "x" }, { dept: "parks", id: "has space" }, { dept: "", id: "x" }]) {
    const bad = await client.callTool({ name: "get_public_activity", arguments: args });
    assert.ok(bad.isError, `${JSON.stringify(args)} must be refused`);
  }
  assert.equal(requests.length, before);
});

await check("whoami returns the key's name; a key the site does not recognise gives the documented _anonymous_ answer as an actionable error", async () => {
  const n = requests.length;
  const { data } = await call(client, "whoami");
  assert.deepEqual(since(n).map((r) => [r.path, r.auth]), [["/api/1/whoami", AUTH]]);
  assert.deepEqual(data, { api_key_name: KEY_NAME, site: base });
  const wrong = await connect({ key: "cs-wrong-key", secret: "cs-wrong-secret" });
  const anon = await call(wrong, "whoami");
  assert.ok(anon.res.isError);
  assert.match(anon.text, /rejected the API key \(400\)\. Check CITIZENSPACE_API_KEY and CITIZENSPACE_API_SECRET.*Site Settings > API.*_anonymous_/);
  await wrong.close();
});

await check("list_activities (after a 429 retry that waits for Retry-After) returns the documented fields, redacts an email in a title by default, and filters locally by state and keyword", async () => {
  const n = requests.length;
  const { data } = await call(client, "list_activities");
  const tries = since(n).filter((r) => r.path === "/api/1/activities");
  assert.equal(tries.length, 2, "activities should be retried once after the 429");
  const gap = tries[1].t - tries[0].t;
  assert.ok(gap >= 1000 && gap < 1900, `retry should wait the Retry-After of 1 s, not the 2 s fallback (waited ${gap} ms)`);
  assert.deepEqual([data.count, data.total_on_site, data.matching], [3, 3, 3]);
  assert.deepEqual(data.activities[0], { uid: fx.PARK, title: "Kings Gardens spring planting", state: "open", start_date: "2026-09-01T00:00:00", end_date: "2026-11-30T00:00:00", path: "parks-and-recreation/kings-gardens-spring-planting" });
  assert.equal(data.activities[1].title, "Central library opening hours (queries to [email redacted])");
  const open = await call(client, "list_activities", { state: "open" });
  assert.deepEqual(open.data.activities.map((a) => a.uid), [fx.PARK]);
  assert.equal(requests.at(-1).query.state, undefined, "the endpoint documents no parameters; the filter is local");
  const kw = await call(client, "list_activities", { q: "library", include_contact_details: true });
  assert.deepEqual(kw.data.activities.map((a) => a.title), ["Central library opening hours (queries to library@example.gov.uk)"]);
  const limited = await call(client, "list_activities", { max_results: 1 });
  assert.deepEqual([limited.data.count, limited.data.matching], [1, 3]);
  assert.match(limited.data.note, /first 1 of 3/);
});

await check("get_activity passes the (undocumented) record through with redaction and says so; an unknown uid gives a clear 404", async () => {
  const { data } = await call(client, "get_activity", { activity_uid: fx.LIBRARY });
  assert.equal(requests.at(-1).path, `/api/1/activities/${fx.LIBRARY}`);
  assert.equal(data.activity.title, "Central library opening hours (queries to [email redacted])");
  assert.equal(data.activity.uid, fx.LIBRARY);
  assert.match(data.note, /documents no response shape/);
  const missing = await call(client, "get_activity", { activity_uid: "0000000000000000000000000000dead" });
  assert.ok(missing.res.isError);
  assert.match(missing.text, /Not found: \/api\/1\/activities\/0000000000000000000000000000dead\. Check the UID or ID\./);
});

await check("get_survey_structure assembles pages, questions and components into a tree from four documented endpoints, lists orphans, and redacts survey text by default", async () => {
  const n = requests.length;
  const { data } = await call(client, "get_survey_structure", { activity_uid: fx.PARK });
  assert.deepEqual(since(n).map((r) => r.path).sort(), [`/api/1/activities/${fx.PARK}/components`, `/api/1/activities/${fx.PARK}/pages`, `/api/1/activities/${fx.PARK}/questions`, `/api/1/activities/${fx.PARK}/survey`]);
  assert.deepEqual([data.page_count, data.question_count, data.component_count], [2, 4, 6]);
  assert.deepEqual(data.survey, {
    link_text: "Online Survey",
    question_numbering: "continuous",
    linear: true,
    has_skip_logic: false,
    body: "<p>Tell us what you think of the planting plan. Questions: [email redacted] or [phone redacted].</p>",
    factbank_heading: "Related information",
    thankyou_message: "Thank you for your response.",
    email_thankyou_message: "Thank you for your response.",
  });
  assert.deepEqual(data.pages.map((p) => [p.id, p.title, p.questions.map((q) => [q.number, q.id, q.components.map((c) => c.id)])]), [
    ["intro", "About you", [["1", "opsuite.respondentmanagement.name", ["opsuite.respondentmanagement.name_subquestion", "opsuite.respondentmanagement.name-quickconsult.analysis.what_to_analyse_subquestion"]], ["2", "quickconsult.email", ["quickconsult.email_subquestion"]]]],
    ["planting", "The planting plan", [["3", "q_support", ["q_support_subquestion"]], ["4", "q_comments", ["q_comments_subquestion"]]]],
  ]);
  const analyst = data.pages[0].questions[0].components[1];
  assert.deepEqual([analyst.type, analyst.label, analyst.heading, analyst.visibility, analyst.character_limit, analyst.validation_options], ["whattoanalysesubquestion", undefined, "Analyst notes", ["analyst"], 0, undefined]);
  assert.deepEqual(data.pages[1].questions[0].components[0].required, true);
  assert.deepEqual([data.unplaced_questions, data.unplaced_components.map((c) => c.id)], [[], ["orphan_subquestion"]]);
  noLeak(data);
  const full = await call(client, "get_survey_structure", { activity_uid: fx.PARK, include_contact_details: true });
  assert.equal(full.data.survey.body, fx.surveys[fx.PARK].body);
  const noSurvey = await call(client, "get_survey_structure", { activity_uid: fx.BUDGET });
  assert.ok(noSurvey.res.isError);
  assert.match(noSurvey.text, /Not found: \/api\/1\/activities\/.*\/survey/);
});

await check("list_responses pages responses_batched with batch_size/batch_start (0, 10, 20) and stops at the documented next_batch_url null", async () => {
  const n = requests.length;
  const { data } = await call(client, "list_responses", { activity_uid: fx.PARK, max_results: 100 });
  assert.deepEqual(since(n).map((r) => [r.path, r.query.batch_size, r.query.batch_start]), [
    [`/api/1/activities/${fx.PARK}/responses_batched`, "50", "0"],
    [`/api/1/activities/${fx.PARK}/responses_batched`, "50", "10"],
    [`/api/1/activities/${fx.PARK}/responses_batched`, "50", "20"],
  ], "three batches (the mock serves 10 per batch), the next starting where the last ended, no fourth once next_batch_url is null");
  assert.deepEqual([data.count, data.total, data.batch_start, data.complete, data.completed, data.deleted, data.note], [24, 24, 0, true, 22, 1, undefined]);
  assert.deepEqual(data.responses.map((r) => r.id), fx.responses[fx.PARK].map((r) => r.id), "every response once, in order");
  assert.deepEqual([data.responses[3].completed, data.responses[9].deleted], [false, true]);
});

await check("list_responses withholds an answer on its label alone, redacts dates of birth, NHS, NI and card numbers and lower-case postcodes in free text, honours max_results and continues from batch_start; a batch_start past the end is an empty, complete list", async () => {
  const n = requests.length;
  const first = await call(client, "list_responses", { activity_uid: fx.PARK, max_results: 15 });
  assert.deepEqual(since(n).map((r) => [r.query.batch_size, r.query.batch_start]), [["15", "0"], ["5", "10"]], "batch_size never asks for more than is still wanted");
  assert.deepEqual([first.data.count, first.data.complete, first.data.total], [15, false, 24]);
  assert.match(first.data.note, /batch_start 15/);
  const m = requests.length;
  const rest = await call(client, "list_responses", { activity_uid: fx.PARK, max_results: 100, batch_start: 15 });
  assert.deepEqual(since(m).map((r) => [r.query.batch_size, r.query.batch_start]), [["50", "15"]]);
  assert.deepEqual([rest.data.count, rest.data.complete, rest.data.batch_start], [9, true, 15]);
  assert.deepEqual([...first.data.responses, ...rest.data.responses].map((r) => r.id), fx.responses[fx.PARK].map((r) => r.id));
  const past = await call(client, "list_responses", { activity_uid: fx.PARK, batch_start: 30 });
  assert.deepEqual([past.data.count, past.data.complete], [0, true]);
  const lib = await call(client, "list_responses", { activity_uid: fx.LIBRARY });
  assert.deepEqual([lib.data.count, lib.data.total, lib.data.complete, lib.data.responses[0].answers["Hours (q_hours_subquestion)"]], [2, 2, true, ["Saturday morning", "Weekday evenings"]]);
  assert.deepEqual(lib.data.responses[0].withheld_answers, ["Your postcode (q_postcode_subquestion)", "Signature (q_sig_subquestion)"], "an answer is withheld on its label alone when the component id is not a standard one");
  assert.ok(!lib.text.includes("CF64"));
  assert.equal(
    lib.data.responses[1].answers["Anything else (q_more_subquestion)"],
    "born [date of birth redacted], NHS [NHS number redacted], NI [NI number redacted], card [card number redacted], live at 4 Plymouth Road, [postcode redacted]",
    "a date of birth, an NHS number, an NI number, a card number and a lower-case postcode in free text are redacted; a street address is not",
  );
  noLeak(lib.data);
  const libFull = await call(client, "list_responses", { activity_uid: fx.LIBRARY, include_contact_details: true });
  assert.equal(libFull.data.responses[0].answers["Your postcode (q_postcode_subquestion)"], "CF64 3DH");
  assert.equal(libFull.data.responses[1].answers["Anything else (q_more_subquestion)"], fx.responses[fx.LIBRARY][1].answers["Anything else (q_more_subquestion)"]);
});

await check("list_responses withholds respondent identity answers and redacts free text by default, and returns everything as stored on request", async () => {
  const { data } = await call(client, "list_responses", { activity_uid: fx.PARK, max_results: 5 });
  const r = data.responses[0];
  assert.deepEqual(r.withheld_answers, [
    "Name (opsuite.respondentmanagement.name_subquestion)",
    "Email (quickconsult.email_subquestion)",
    "Organisation (opsuite.respondentmanagement.organisation_subquestion)",
    "IP Address (__userinfo_ip)",
    "Browser Identification (__userinfo_useragent)",
  ]);
  assert.deepEqual(Object.keys(r.answers), ["Support (q_support_subquestion)", "Comments (q_comments_subquestion)", "Visited Pages (__userinfo_pages_visited)", "Survey State (__userinfo_state)", "Citizen Space Version (__userinfo_cs_version)"]);
  assert.deepEqual(data.responses.map((x) => x.answers["Comments (q_comments_subquestion)"]), [
    "Please keep the old oak. [email redacted]",
    "Fine as long as the path stays. I live at 4 Plymouth Road, [postcode redacted].",
    "No comment",
    "Love it. Call me on [phone redacted] if you need volunteers.",
    "Please keep the old oak. [email redacted]",
  ]);
  assert.equal(data.responses[0].answers["Support (q_support_subquestion)"], "Yes");
  noLeak(data, ["Mozilla"]);
  const full = await call(client, "list_responses", { activity_uid: fx.PARK, max_results: 2, include_contact_details: true });
  const f = full.data.responses[1];
  assert.equal(f.withheld_answers, undefined);
  assert.deepEqual(f.answers, fx.responses[fx.PARK][1].answers, "as stored, including name, email and IP address");
});

await check("get_response_answers reads one response with the same withholding and redaction; an unknown response id gives a clear 404", async () => {
  const n = requests.length;
  const { data } = await call(client, "get_response_answers", { activity_uid: fx.PARK, response_id: "ANON-PARK-0002-C" });
  assert.deepEqual(since(n).map((r) => r.path), [`/api/1/activities/${fx.PARK}/responses/ANON-PARK-0002-C`]);
  assert.deepEqual([data.response.id, data.response.completed, data.response.deleted], ["ANON-PARK-0002-C", true, false]);
  assert.equal(data.response.answers["Comments (q_comments_subquestion)"], "Fine as long as the path stays. I live at 4 Plymouth Road, [postcode redacted].");
  assert.equal(data.response.answers["Support (q_support_subquestion)"], "Yes");
  assert.equal(data.response.withheld_answers.length, 5);
  noLeak(data, ["Mozilla"]);
  const full = await call(client, "get_response_answers", { activity_uid: fx.PARK, response_id: "ANON-PARK-0002-C", include_contact_details: true });
  assert.equal(full.data.response.answers["Email (quickconsult.email_subquestion)"], "person2@example.com");
  const missing = await call(client, "get_response_answers", { activity_uid: fx.PARK, response_id: "ANON-PARK-9999-C" });
  assert.ok(missing.res.isError);
  assert.match(missing.text, /Not found: \/api\/1\/activities\/.*\/responses\/ANON-PARK-9999-C\. Check the UID or ID\./);
});

await check("list_users passes fullname, email and workspace_uid through as documented, withholds contact fields (listing them) and redacts an email typed into a name; everything on request", async () => {
  const n = requests.length;
  const { data } = await call(client, "list_users");
  assert.deepEqual(since(n).map((r) => [r.path, r.query]), [["/api/1/users", {}]]);
  assert.deepEqual([data.count, data.total_matching], [3, 3]);
  assert.deepEqual(data.users.map((u) => u.fullname), ["Dana Barrett", "Priya Shah ([email redacted])", "Lee Chen"]);
  assert.deepEqual(Object.keys(data.users[0]).sort(), ["fullname", "id", "workspace_uid"]);
  assert.deepEqual(data.withheld_fields, ["email", "telephone", "dateOfBirth", "homeAddress"], "camelCase keys are withheld too");
  noLeak(data, ["Plymouth"]);
  const filtered = await call(client, "list_users", { fullname: "Dana", email: "dana.barrett@example.gov.uk", workspace_uid: fx.workspaces[0].uid });
  assert.deepEqual(requests.at(-1).query, { fullname: "Dana", email: "dana.barrett@example.gov.uk", workspace_uid: fx.workspaces[0].uid });
  assert.deepEqual(filtered.data.users.map((u) => u.fullname), ["Dana Barrett"]);
  const full = await call(client, "list_users", { workspace_uid: fx.workspaces[1].uid, include_contact_details: true });
  assert.deepEqual(full.data.users, [fx.users[1]]);
  assert.equal(full.data.withheld_fields, undefined);
  const dana = await call(client, "list_users", { fullname: "Dana", include_contact_details: true });
  assert.deepEqual(dana.data.users, [fx.users[0]], "as stored on request, camelCase fields included");
});

await check("list_workspaces lists workspaces or one by uid, redacting text; an unknown uid gives a clear 404", async () => {
  const { data } = await call(client, "list_workspaces");
  assert.equal(requests.at(-1).path, "/api/1/workspaces");
  assert.deepEqual([data.count, data.total, data.workspaces.map((w) => w.title)], [2, 2, ["Parks and recreation", "Libraries (front desk [phone redacted])"]]);
  assert.deepEqual(data.withheld_fields, ["owner_email"], "field names without the list index, as list_users reports them");
  noLeak(data);
  const one = await call(client, "list_workspaces", { workspace_uid: fx.workspaces[1].uid, include_contact_details: true });
  assert.equal(requests.at(-1).path, `/api/1/workspaces/${fx.workspaces[1].uid}`);
  assert.deepEqual(one.data.workspace, fx.workspaces[1]);
  const missing = await call(client, "list_workspaces", { workspace_uid: "0000000000000000000000000000dead" });
  assert.ok(missing.res.isError);
  assert.match(missing.text, /Not found: \/api\/1\/workspaces\/0000000000000000000000000000dead/);
});

await check("get_mailing_list returns the subscriber count and non-contact fields by default, never an address, and the addresses on request", async () => {
  const { data } = await call(client, "get_mailing_list", { activity_uid: fx.PARK });
  assert.equal(requests.at(-1).path, `/api/1/activities/${fx.PARK}/mailinglist`);
  assert.deepEqual([data.subscriber_count, data.count, data.withheld_fields], [3, 3, ["email"]]);
  assert.deepEqual(data.subscribers.map((s) => s.name), ["Resident One", "Resident Two", "Resident Three ([phone redacted])"]);
  assert.match(data.note, /withheld/);
  assert.ok(!JSON.stringify(data).includes("@"), "no address in the default output");
  noLeak(data);
  const full = await call(client, "get_mailing_list", { activity_uid: fx.PARK, include_contact_details: true, max_results: 2 });
  assert.deepEqual([full.data.subscriber_count, full.data.count, full.data.subscribers.map((s) => s.email)], [3, 2, ["resident1@example.org", "resident2@example.org"]]);
  const empty = await call(client, "get_mailing_list", { activity_uid: fx.LIBRARY });
  assert.deepEqual([empty.data.subscriber_count, empty.data.subscribers], [0, []]);
  const strings = await call(client, "get_mailing_list", { activity_uid: fx.BUDGET });
  assert.deepEqual([strings.data.subscriber_count, strings.data.count, strings.data.subscribers], [2, 2, []], "a list of bare address strings is withheld entirely");
  assert.ok(!strings.text.includes("@"));
  const stringsFull = await call(client, "get_mailing_list", { activity_uid: fx.BUDGET, include_contact_details: true });
  assert.deepEqual(stringsFull.data.subscribers, ["resident4@example.org", "resident5@example.org"]);
});

await check("bad UIDs and IDs are rejected before any API call", async () => {
  const before = requests.length;
  for (const [tool, args] of [
    ["get_activity", { activity_uid: "../users" }],
    ["get_survey_structure", { activity_uid: "has space" }],
    ["list_responses", { activity_uid: "" }],
    ["get_response_answers", { activity_uid: fx.PARK, response_id: "ANON/1" }],
    ["get_response_answers", { activity_uid: fx.PARK, response_id: "a".repeat(65) }],
    ["list_workspaces", { workspace_uid: "x?y" }],
    ["list_users", { workspace_uid: "x y" }],
    ["get_mailing_list", { activity_uid: "%2e%2e" }],
  ]) {
    const bad = await client.callTool({ name: tool, arguments: args });
    assert.ok(bad.isError, `${tool} should reject ${JSON.stringify(args)}`);
  }
  assert.equal(requests.length, before, "no request for invalid IDs");
});

await check("a persistent 429 gives up after 3 attempts with the rate-limit message", async () => {
  arm429({ persistent: true });
  const n = requests.length;
  const { res, text } = await call(client, "list_activities");
  assert.ok(res.isError);
  assert.equal(since(n).filter((r) => r.path === "/api/1/activities").length, 3, "exactly three attempts");
  assert.match(text, /Citizen Space rate limit reached \(Delib documents no limit\)\. Wait a minute and try again\./);
  disarm();
});

await check("a Retry-After longer than the cap makes the call give up at once, naming the wait", async () => {
  arm429({ retryAfter: "600" });
  const n = requests.length;
  const { res, text } = await call(client, "list_activities");
  assert.ok(res.isError);
  assert.equal(since(n).filter((r) => r.path === "/api/1/activities").length, 1, "no retry when the server asks for a wait longer than the cap");
  assert.match(text, /asked to wait 600 seconds before retrying GET \/api\/1\/activities \(HTTP 429\)/);
  disarm();
});

await check("an HTTP-date Retry-After is honoured", async () => {
  // HTTP-dates have 1 s resolution, so aim at a whole second 4 to 5 s ahead: after the first request's
  // round trip the wait is 3.5 to 5 s, clearly apart from both "retry at once" and the 2 s fallback.
  arm429({ retryAfter: new Date(Math.ceil((Date.now() + 4000) / 1000) * 1000).toUTCString() });
  const n = requests.length;
  const { res } = await call(client, "list_activities");
  assert.ok(!res.isError);
  const tries = since(n).filter((r) => r.path === "/api/1/activities");
  assert.equal(tries.length, 2);
  const gap = tries[1].t - tries[0].t;
  assert.ok(gap >= 3000 && gap < 5600, `retry should wait until the given date (3.5 to 5 s), not retry at once or use the 2 s fallback (waited ${gap} ms)`);
  disarm();
});

await check("a fractional Retry-After is read as seconds, not as a date", async () => {
  arm429({ retryAfter: "1.5" }); // Date.parse("1.5") is a date in 2001, which would mean "retry now"
  const n = requests.length;
  const { res } = await call(client, "list_activities");
  assert.ok(!res.isError);
  const tries = since(n).filter((r) => r.path === "/api/1/activities");
  assert.equal(tries.length, 2);
  const gap = tries[1].t - tries[0].t;
  assert.ok(gap >= 1400 && gap < 1900, `retry should wait 1.5 s (waited ${gap} ms)`);
  disarm();
});

await check("a 429 without Retry-After is retried after the 2 s fallback; the wrapped error shape {error: {error_message}} is read", async () => {
  arm({ method: "GET", path: "/api/1/activities", status: 429, body: { error_message: "Too many requests" } });
  const n = requests.length;
  const { res } = await call(client, "list_activities");
  assert.ok(!res.isError);
  const tries = since(n).filter((r) => r.path === "/api/1/activities");
  assert.equal(tries.length, 2);
  const gap = tries[1].t - tries[0].t;
  assert.ok(gap >= 2000 && gap < 2900, `retry should wait the 2 s fallback (waited ${gap} ms)`);
  disarm();
  arm({ method: "GET", path: "/api/1/workspaces", status: 403, body: doc.errors.wrapped });
  const denied = await call(client, "list_workspaces");
  assert.ok(denied.res.isError);
  assert.match(denied.text, /rejected the API key \(403\).*Forbidden: Unauthorized: activity_search failed permission check/);
  disarm();
});

await check("a GET that keeps failing with 503 gives up after three attempts with advice and without the gateway's HTML; a 502 on a GET is retried once", async () => {
  arm({ method: "GET", path: "/api/1/workspaces", status: 503, times: 3, headers: { "Retry-After": "0" } });
  let n = requests.length;
  const { res, text } = await call(client, "list_workspaces");
  assert.ok(res.isError);
  assert.equal(since(n).filter((r) => r.path === "/api/1/workspaces").length, 3);
  assert.match(text, /Citizen Space returned 503 for GET \/api\/1\/workspaces 3 times in a row\. The site may be unavailable; try again in a few minutes\./);
  assert.ok(!text.includes("<html>"), "gateway HTML should not be passed on");
  disarm();
  arm({ method: "GET", path: "/api/1/workspaces", status: 502, headers: { "Retry-After": "1" } });
  n = requests.length;
  const ok = await call(client, "list_workspaces");
  assert.ok(!ok.res.isError, ok.text);
  assert.equal(ok.data.count, 2);
  assert.equal(since(n).filter((r) => r.path === "/api/1/workspaces").length, 2);
  disarm();
});

await check("a 200 whose body is not JSON is an error naming the instance variables, not an empty list", async () => {
  arm({ method: "GET", path: "/api/1/activities", status: 200 }); // the mock answers with an HTML page
  const { res, text } = await call(client, "list_activities");
  assert.ok(res.isError, `a non-JSON 200 must not be reported as success: ${text}`);
  assert.match(text, /returned 200 for GET \/api\/1\/activities but the body was not JSON \(starts with: "<html>.*Check CITIZENSPACE_INSTANCE \/ CITIZENSPACE_BASE_URL/);
  disarm();
  const ok = await call(client, "list_activities", { max_results: 1 });
  assert.ok(!ok.res.isError);
});

await check("a body that echoes the Authorization header, the key or the secret never puts them into a tool result (400, 401 and a 200 login page)", async () => {
  const basic = AUTH.slice("Basic ".length);
  const echo = `Bad credentials: ${AUTH} (${API_KEY} / ${API_SECRET})`;
  const leaks = [AUTH, basic, basic.slice(0, 12), API_KEY, API_SECRET];
  arm({ method: "GET", path: "/api/1/workspaces", status: 400, body: { error_message: echo } });
  const refused = await call(client, "list_workspaces");
  assert.ok(refused.res.isError);
  assert.match(refused.text, /refused GET \/api\/1\/workspaces \(400\)\. Bad credentials: Basic \[redacted\] \(\[redacted\] \/ \[redacted\]\)/);
  for (const leak of leaks) assert.ok(!refused.text.includes(leak), `${leak} leaked in a 400 message`);
  arm({ method: "GET", path: "/api/1/workspaces", status: 401, body: { error: { error_message: echo } } });
  const denied = await call(client, "list_workspaces");
  assert.ok(denied.res.isError);
  assert.match(denied.text, /rejected the API key \(401\).*Bad credentials: Basic \[redacted\]/);
  for (const leak of leaks) assert.ok(!denied.text.includes(leak), `${leak} leaked in a 401 message`);
  // A login page on a 200 whose first line carries the header: the excerpt is scrubbed before it is cut,
  // so not even a prefix of the credential survives.
  arm({ method: "GET", path: "/api/1/activities", status: 200, raw: `<html>Login for admin@example.com ${AUTH} ${API_KEY}</html>` });
  const page = await call(client, "list_activities");
  assert.ok(page.res.isError);
  assert.match(page.text, /starts with: "<html>Login for \[email redacted\] Basic \[redacted\] \[redacted/);
  for (const leak of leaks) assert.ok(!page.text.includes(leak), `${leak} leaked in the non-JSON excerpt`);
  disarm();
});

await check("an HTML body on a 404 (a proxy's page) is not quoted in the error", async () => {
  arm({ method: "GET", path: "/api/1/workspaces", status: 404 }); // the mock answers with an HTML page
  const { res, text } = await call(client, "list_workspaces");
  assert.ok(res.isError);
  assert.equal(text, "Not found: /api/1/workspaces. Check the UID or ID.");
  disarm();
});

await check("list_responses keeps paging when next_batch_url is absent but total says more exist, or when there is no batching object at all; stops on the documented null; a body without a responses list is an error, not an empty list", async () => {
  const path = `/api/1/activities/${fx.PARK}/responses_batched`;
  const firstTen = fx.responses[fx.PARK].slice(0, 10);
  const all = fx.responses[fx.PARK].map((r) => r.id);
  // next_batch_url missing (not null) on the first batch: total 24 says more exist, so paging continues.
  arm({ method: "GET", path, status: 200, body: { batching: { total: 24, batch_size: 10, batch_start: 0 }, responses: firstTen } });
  let n = requests.length;
  const noUrl = await call(client, "list_responses", { activity_uid: fx.PARK, max_results: 100 });
  assert.ok(!noUrl.res.isError, noUrl.text);
  assert.deepEqual(since(n).map((r) => r.query.batch_start), ["0", "10", "20"]);
  assert.deepEqual([noUrl.data.count, noUrl.data.total, noUrl.data.complete, noUrl.data.responses.map((r) => r.id)], [24, 24, true, all]);
  // No batching object at all: nothing says the list ended, so paging continues until an empty batch or the end.
  arm({ method: "GET", path, status: 200, body: { responses: firstTen } });
  n = requests.length;
  const noBatching = await call(client, "list_responses", { activity_uid: fx.PARK, max_results: 100 });
  assert.ok(!noBatching.res.isError, noBatching.text);
  assert.deepEqual(since(n).map((r) => r.query.batch_start), ["0", "10", "20"]);
  assert.deepEqual([noBatching.data.count, noBatching.data.complete, noBatching.data.responses.map((r) => r.id)], [24, true, all]);
  // The documented null on a batch that total contradicts: null is the documented end and wins.
  arm({ method: "GET", path, status: 200, body: { batching: { total: 24, batch_size: 10, batch_start: 0, next_batch_url: null }, responses: firstTen } });
  n = requests.length;
  const nulled = await call(client, "list_responses", { activity_uid: fx.PARK, max_results: 100 });
  assert.deepEqual([since(n).length, nulled.data.count, nulled.data.complete], [1, 10, true]);
  // total reached with no next_batch_url: complete, no further request.
  const libPath = `/api/1/activities/${fx.LIBRARY}/responses_batched`;
  arm({ method: "GET", path: libPath, status: 200, body: { batching: { total: 2, batch_size: 10, batch_start: 0 }, responses: fx.responses[fx.LIBRARY] } });
  n = requests.length;
  const reached = await call(client, "list_responses", { activity_uid: fx.LIBRARY });
  assert.deepEqual([since(n).length, reached.data.count, reached.data.total, reached.data.complete], [1, 2, 2, true]);
  // The unbatched shape (a bare list) or any other body without a responses list is an error.
  for (const [body, shape] of [
    [firstTen, "a list of 10 items"],
    [{ batching: { total: 24 }, responses: "nope" }, "an object with keys batching, responses"],
    ["_anonymous_", "a string"],
  ]) {
    arm({ method: "GET", path, status: 200, body });
    const bad = await call(client, "list_responses", { activity_uid: fx.PARK });
    assert.ok(bad.res.isError, `${shape} must be an error, not an empty list`);
    assert.match(bad.text, new RegExp(`answered GET /api/1/activities/${fx.PARK}/responses_batched with ${shape}; expected \\{batching: \\{\\.\\.\\.\\}, responses: \\[\\.\\.\\.\\]\\} as documented`));
  }
  disarm();
});

await check("every Data API request used Basic base64(key:secret), every Public API request no credentials, and each matched a documented method and path", async () => {
  assert.ok(requests.length > 40);
  const pub = requests.filter((r) => r.path.startsWith("/api/2.4/"));
  const data = requests.filter((r) => r.path.startsWith("/api/1/"));
  assert.ok(pub.length >= 8 && data.length >= 30);
  assert.equal(pub.length + data.length, requests.length, "nothing outside the two APIs");
  for (const r of pub) assert.equal(r.auth, undefined, `${r.path} must not carry credentials`);
  // The whoami check above connected once with a deliberately wrong key; that single request is the only one allowed to differ.
  const wrongAuth = "Basic " + Buffer.from("cs-wrong-key:cs-wrong-secret").toString("base64");
  const wrong = data.filter((r) => r.auth !== AUTH);
  assert.deepEqual(wrong.map((r) => [r.path, r.auth]), [["/api/1/whoami", wrongAuth]], "every other Data API request carried the configured key and secret");
  for (const r of requests) assert.ok(templates.some((t) => t.m === r.method && t.re.test(r.path)), `undocumented call ${r.method} ${r.path}`);
  const used = new Set(requests.map((r) => `${r.method} ${r.path.replace(/\/0{28}[a-z0-9]{4}(?=\/|$)/g, "/{uid}").replace(/\/ANON-[A-Z]+-\d{4}-C(?=\/|$)/g, "/{id}")}`));
  assert.deepEqual(
    [...used].sort(),
    [
      "GET /api/1/activities",
      "GET /api/1/activities/{uid}",
      "GET /api/1/activities/{uid}/components",
      "GET /api/1/activities/{uid}/mailinglist",
      "GET /api/1/activities/{uid}/pages",
      "GET /api/1/activities/{uid}/questions",
      "GET /api/1/activities/{uid}/responses/{id}",
      "GET /api/1/activities/{uid}/responses_batched",
      "GET /api/1/activities/{uid}/survey",
      "GET /api/1/users",
      "GET /api/1/whoami",
      "GET /api/1/workspaces",
      "GET /api/1/workspaces/{uid}",
      "GET /api/2.4/json_consultation_details",
      "GET /api/2.4/json_search_results",
    ],
  );
});
await client.close();

await check("a wrong key or secret gives an actionable 401 on the Data API tools while the Public API tools keep working", async () => {
  const bad = await connect({ key: API_KEY, secret: "cs-wrong-secret" });
  const { res, text } = await call(bad, "list_activities");
  assert.ok(res.isError);
  assert.match(text, /rejected the API key \(401\)\. Check CITIZENSPACE_API_KEY and CITIZENSPACE_API_SECRET: they are the Key and Secret of an API key created under Site Settings > API.*failed permission check/);
  assert.ok(!text.includes("cs-wrong-secret") && !text.includes(API_KEY), "credentials are not echoed");
  const pub = await call(bad, "search_public_activities", { state: "closed" });
  assert.ok(!pub.res.isError);
  assert.equal(pub.data.count, 1);
  await bad.close();
});

mock.close();
console.log(`\n${passed} checks passed, ${requests.length} API calls made against the mock.`);
