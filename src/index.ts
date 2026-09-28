#!/usr/bin/env node
// Citizen Space MCP server: lets Claude, ChatGPT and other MCP clients work with a Citizen Space
// consultation site (Delib). Public consultations need no credentials; the Data API tools need an
// API key and secret from Site Settings > API.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CitizenSpaceClient, CitizenSpaceError, BATCH_SIZE } from "./client.js";
import * as fmt from "./format.js";

const instance = process.env.CITIZENSPACE_INSTANCE?.trim();
const baseUrlEnv = process.env.CITIZENSPACE_BASE_URL?.trim();
if (instance && !/^[A-Za-z0-9-]+$/.test(instance)) {
  console.error(`CITIZENSPACE_INSTANCE must be the subdomain of your Citizen Space site (letters, digits and hyphens: "demo" for https://demo.citizenspace.com), not "${instance}".`);
  process.exit(1);
}
if (baseUrlEnv && !/^https?:\/\/[^\s/]+/.test(baseUrlEnv)) {
  console.error(`CITIZENSPACE_BASE_URL must be an http(s) origin such as https://demo.citizenspace.com, not "${baseUrlEnv}".`);
  process.exit(1);
}
if (!instance && !baseUrlEnv) {
  console.error('CITIZENSPACE_INSTANCE is not set. Use the subdomain of your Citizen Space site ("demo" for https://demo.citizenspace.com).');
  process.exit(1);
}
const baseUrl = baseUrlEnv || `https://${instance}.citizenspace.com`;

const apiKey = process.env.CITIZENSPACE_API_KEY?.trim();
const apiSecret = process.env.CITIZENSPACE_API_SECRET?.trim();
if ((apiKey && !apiSecret) || (!apiKey && apiSecret)) {
  console.error("CITIZENSPACE_API_KEY and CITIZENSPACE_API_SECRET must be set together: they are the Key and Secret of an API key created under Site Settings > API on your Citizen Space site.");
  process.exit(1);
}
const api = new CitizenSpaceClient(baseUrl, apiKey && apiSecret ? { key: apiKey, secret: apiSecret } : undefined);

const server = new McpServer(
  { name: "citizenspace", version: "0.1.0" },
  {
    instructions: [
      "Tools for a Citizen Space consultation site (Delib).",
      "search_public_activities and get_public_activity use the unauthenticated Public API: only published, public activities, identified by department id (dept) and activity id (slugs from their URLs).",
      api.hasCredentials
        ? "The other tools use the Data API with the configured key: activities are identified by a 32-character uid, responses by ids such as ANON-XXXX-YYYY-C."
        : "The Data API tools (activities, survey structure, responses, users, workspaces, mailing lists) are not registered because CITIZENSPACE_API_KEY and CITIZENSPACE_API_SECRET are not set.",
      "Typical flow for 'summarise the responses to X': list_activities (or search_public_activities) to find the activity, get_survey_structure for the questions, then list_responses.",
      "Respondent and contact personal data (names, emails, phone numbers, addresses, IP addresses) is only returned when explicitly requested with include_contact_details.",
    ].join("\n"),
  },
);

const READ = { readOnlyHint: true, openWorldHint: true } as const;

// Activity uids in every documented example are 32 lowercase hex characters, but the spec types
// them as plain strings, so only reject values that could not be a path segment.
const uid = (what: string) => z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, `${what} UIDs are short strings of letters, digits, _ and -, e.g. 67f18beb302944c9944e06521cf2224e`);
// Response ids look like ANON-XXXX-YYYY-C in the documented examples.
const responseId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Response IDs are short strings of letters, digits, _ and -, e.g. ANON-XXXX-YYYY-C");
// Public API dept and id are the slugs in an activity's URL (documented examples:
// "parks-and-recreation", "spring-planting-in-kings-gardens").
const slug = (what: string) => z.string().regex(/^[\p{L}\p{N}._-]{1,200}$/u, `${what} is the slug from the activity's URL, e.g. parks-and-recreation`);
// The Public API's date arguments are documented as yyyy/mm/dd; yyyy-mm-dd is accepted and converted.
// A date is real only when parsing it and printing it back gives the same day: Date.parse alone rolls
// 2026-02-30 into March.
const isCalendarDate = (iso: string) => {
  const t = Date.parse(iso);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === iso;
};
const publicDate = z
  .string()
  .regex(/^\d{4}[/-]\d{2}[/-]\d{2}$/, "Dates are yyyy/mm/dd")
  .transform((s) => s.replace(/-/g, "/"))
  .refine((s) => isCalendarDate(s.replace(/\//g, "-")), "Not a real date");

const STATES = ["open", "forthcoming", "closed"] as const;
const ACTIVITY_TYPES = ["QuickConsult", "File", "Document", "Link"] as const;
const FIELDS = ["basic", "extended", "all"] as const;

type Json = Record<string, unknown> | unknown[];
const ok = (data: Json) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (err: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: err instanceof CitizenSpaceError ? err.message : `Unexpected error: ${(err as Error)?.message ?? String(err)}` }],
});
const safe = <A>(fn: (args: A) => Promise<Json>) => async (args: A) => {
  try {
    return ok(await fn(args));
  } catch (err) {
    return fail(err);
  }
};
const asArray = (v: unknown): Record<string, any>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
// Withheld paths of a list of records, without the "[i]." prefix and without repeats: the field names.
const fieldNames = (withheld: string[]) => [...new Set(withheld.map((w) => w.replace(/^\[\d+\]\./, "")))];
const UNDOCUMENTED = "Delib documents no response shape for this endpoint; the record is returned as the API sent it, with contact-like fields withheld and free text redacted unless include_contact_details is set.";

// ---------------------------------------------------------------------------------------------
// Public API v2.4 (no credentials)

server.registerTool(
  "search_public_activities",
  {
    title: "Search public activities",
    description:
      "Published, public consultations and other activities on the site, from the unauthenticated Public API (json_search_results). Every documented search argument is passed through: free text, postcode, state, audience, interest, department, area, a date range on the open or close date, activity type. fields=basic gives id, title, url, status, overview and dates; extended adds department, type and participation URL; all adds the 'why' and 'what happens next' text, contact details, related links, documents, audiences, areas and interests. Officer contact phone and email are only returned with include_contact_details.",
    inputSchema: {
      text: z.string().min(1).max(200).optional().describe("Free text search on title and overview, case-insensitive (argument tx)"),
      postcode: z.string().min(1).max(20).optional().describe("Postcode, partial allowed, e.g. BS8 (argument pc)"),
      state: z.enum(STATES).optional().describe("open, forthcoming or closed (argument st)"),
      audience_id: z.string().min(1).max(200).optional().describe("One of the audience IDs configured on the site (argument au)"),
      interest_id: z.string().min(1).max(200).optional().describe("One of the interest IDs configured on the site (argument in)"),
      department_id: slug("Department ID").optional().describe("The ID of the department the activity sits within (argument de)"),
      area_id: z.string().min(1).max(200).optional().describe("One of the area IDs configured on the site (argument ar)"),
      date_kind: z.enum(["op", "cl"]).optional().describe("Which date the range applies to: op (open date) or cl (close date); required with date_from/date_to (argument dk)"),
      date_from: publicDate.optional().describe("Start of the date range, yyyy/mm/dd (argument fd)"),
      date_to: publicDate.optional().describe("End of the date range, yyyy/mm/dd (argument td)"),
      activity_type: z.enum(ACTIVITY_TYPES).optional().describe("QuickConsult (online survey), File (email/postal), Document (offline) or Link (argument ct)"),
      fields: z.enum(FIELDS).default("basic").describe("Which groups of fields to return"),
      max_results: z.number().int().min(1).max(500).default(50).describe("The API returns every match in one response; only the first max_results are shown"),
      include_contact_details: z.boolean().default(false).describe("Include the activity's contact phone and email (fields=all) and stop redacting emails, phone numbers and postcodes from text"),
    },
    annotations: READ,
  },
  safe(async (a) => {
    // Reference: fd and td "must be used in conjunction with dk".
    if ((a.date_from || a.date_to) && !a.date_kind) throw new CitizenSpaceError("date_from and date_to need date_kind (op for the open date, cl for the close date); the Public API ignores them otherwise.");
    if (a.date_kind && !a.date_from && !a.date_to) throw new CitizenSpaceError("date_kind needs date_from and/or date_to.");
    const raw = await api.publicGet("/api/2.4/json_search_results", {
      tx: a.text,
      pc: a.postcode,
      st: a.state,
      au: a.audience_id,
      in: a.interest_id,
      de: a.department_id,
      ar: a.area_id,
      dk: a.date_kind,
      fd: a.date_from,
      td: a.date_to,
      ct: a.activity_type,
      fields: a.fields === "basic" ? undefined : a.fields,
    });
    const all = asArray(raw);
    const shown = all.slice(0, a.max_results);
    return {
      count: shown.length,
      total_matching: all.length,
      note: all.length > shown.length ? `Only the first ${shown.length} of ${all.length} matching activities are shown; raise max_results or narrow the search.` : undefined,
      activities: shown.map((x) => fmt.publicActivity(x, a.include_contact_details)),
    };
  }),
);

server.registerTool(
  "get_public_activity",
  {
    title: "Get a public activity",
    description: "Overview of one published activity by department id and activity id (the two slugs in its URL), from the unauthenticated Public API (json_consultation_details). Same fields as search_public_activities.",
    inputSchema: {
      dept: slug("dept").describe("Department ID, e.g. parks-and-recreation"),
      id: slug("id").describe("Activity ID, e.g. spring-planting-in-kings-gardens"),
      fields: z.enum(FIELDS).default("all"),
      include_contact_details: z.boolean().default(false).describe("Include the activity's contact phone and email and stop redacting text"),
    },
    annotations: READ,
  },
  safe(async ({ dept, id, fields, include_contact_details }) => {
    const raw = await api.publicGet("/api/2.4/json_consultation_details", { dept, id, fields: fields === "basic" ? undefined : fields });
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CitizenSpaceError(`The Public API answered GET /api/2.4/json_consultation_details with ${Array.isArray(raw) ? "a list" : typeof raw} instead of one activity.`);
    return { activity: fmt.publicActivity(raw, include_contact_details) };
  }),
);

// ---------------------------------------------------------------------------------------------
// Data API v1 (HTTP Basic key:secret), registered only when credentials are configured.

if (api.hasCredentials) {
  server.registerTool(
    "whoami",
    {
      title: "Check the API key",
      description: "Returns the name of the configured API key as Citizen Space sees it (GET /api/1/whoami). Use it to confirm the key and secret work before other calls.",
      inputSchema: {},
      annotations: READ,
    },
    safe(async () => {
      const raw = await api.get("/api/1/whoami");
      // Documented: the body is the key's name; "_anonymous_" means the request was not recognised.
      const name = typeof raw === "string" ? raw : typeof raw === "object" && raw !== null ? String((raw as any).name ?? (raw as any).key ?? JSON.stringify(raw)) : String(raw);
      if (name === "_anonymous_") {
        throw new CitizenSpaceError(
          "Citizen Space answered whoami with _anonymous_: the key and secret were not recognised. Check CITIZENSPACE_API_KEY and CITIZENSPACE_API_SECRET against Site Settings > API on your site, that the key is not disabled, and that the Data API is enabled for the site.",
        );
      }
      return { api_key_name: fmt.redactContacts(name, false), site: api.baseUrl };
    }),
  );

  server.registerTool(
    "list_activities",
    {
      title: "List activities",
      description: "Every activity the API key can see (GET /api/1/activities): uid, title, state, start and end date, path. Optionally filtered locally by state or by a keyword in the title; the endpoint documents no parameters.",
      inputSchema: {
        state: z.string().min(1).max(40).optional().describe("Keep only activities whose state equals this (the documented example shows 'open')"),
        q: z.string().min(1).max(200).optional().describe("Case-insensitive keyword filter on the title"),
        max_results: z.number().int().min(1).max(1000).default(100),
        include_contact_details: z.boolean().default(false).describe("Stop redacting emails, phone numbers and postcodes from titles"),
      },
      annotations: READ,
    },
    safe(async ({ state, q, max_results, include_contact_details }) => {
      const all = asArray(await api.get("/api/1/activities"));
      const kw = q?.toLowerCase();
      const matching = all.filter((a) => (!state || String(a.state) === state) && (!kw || String(a.title ?? "").toLowerCase().includes(kw)));
      const shown = matching.slice(0, max_results);
      return {
        count: shown.length,
        total_on_site: all.length,
        matching: matching.length,
        note: matching.length > shown.length ? `Only the first ${shown.length} of ${matching.length} matching activities are shown; raise max_results.` : undefined,
        activities: shown.map((a) => fmt.activity(a, include_contact_details)),
      };
    }),
  );

  server.registerTool(
    "get_activity",
    {
      title: "Get an activity",
      description: `Key information about one activity by uid (GET /api/1/activities/{uid}). ${UNDOCUMENTED}`,
      inputSchema: {
        activity_uid: uid("Activity").describe("Activity UID (from list_activities)"),
        include_contact_details: z.boolean().default(false),
      },
      annotations: READ,
    },
    safe(async ({ activity_uid, include_contact_details }) => {
      const raw = await api.get(`/api/1/activities/${activity_uid}`);
      const { value, withheld } = fmt.redactRecord(raw, include_contact_details);
      return { activity: value as Json, ...(withheld.length ? { withheld_fields: withheld } : {}), note: UNDOCUMENTED };
    }),
  );

  server.registerTool(
    "get_survey_structure",
    {
      title: "Get survey structure",
      description:
        "The survey of an activity as a tree: survey settings, then each page with its questions and each question's components (GET /api/1/activities/{uid}/survey, /pages, /questions, /components). Component ids are the keys used in response answers.",
      inputSchema: {
        activity_uid: uid("Activity").describe("Activity UID (from list_activities)"),
        include_contact_details: z.boolean().default(false).describe("Stop redacting emails, phone numbers and postcodes from survey text"),
      },
      annotations: READ,
    },
    safe(async ({ activity_uid, include_contact_details }) => {
      const base = `/api/1/activities/${activity_uid}`;
      // The four calls run together; all are awaited before any error is reported so that no request is
      // left in flight behind an error message.
      const results = await Promise.allSettled([api.get(`${base}/survey`), api.get(`${base}/pages`), api.get(`${base}/questions`), api.get(`${base}/components`)]);
      const failed = results.find((r) => r.status === "rejected");
      if (failed) throw (failed as PromiseRejectedResult).reason;
      const [survey, pages, questions, components] = results.map((r) => (r as PromiseFulfilledResult<any>).value);
      const qs = asArray(questions).map((q) => fmt.question(q, include_contact_details));
      const cs = asArray(components).map((c) => fmt.component(c, include_contact_details));
      const tree = asArray(pages).map((p) => {
        const pg = fmt.page(p, include_contact_details);
        return {
          ...pg,
          questions: qs.filter((q) => q.page_id === pg.id).map((q) => ({ ...q, components: cs.filter((c) => c.question_id === q.id) })),
        };
      });
      const placed = new Set(tree.flatMap((p) => p.questions.map((q) => q.id)));
      const placedComponents = new Set(tree.flatMap((p) => p.questions.flatMap((q) => q.components.map((c) => c.id))));
      return {
        survey: fmt.survey(survey && typeof survey === "object" ? survey : {}, include_contact_details),
        page_count: tree.length,
        question_count: qs.length,
        component_count: cs.length,
        pages: tree,
        unplaced_questions: qs.filter((q) => !placed.has(q.id)),
        unplaced_components: cs.filter((c) => !placedComponents.has(c.id)),
      };
    }),
  );

  server.registerTool(
    "list_responses",
    {
      title: "List responses",
      description:
        "Responses to an activity's survey in batches (GET /api/1/activities/{uid}/responses_batched with batch_size and batch_start, continuing while next_batch_url or total says more exist): id, completed and deleted flags, and the answers keyed 'Label (component_id)'. Respondent personal data (the name, organisation, email, IP address and browser answers, and any answer whose label asks for contact or identity details) is withheld by default and listed under withheld_answers; other text is redacted. Continue a long list with batch_start.",
      inputSchema: {
        activity_uid: uid("Activity").describe("Activity UID (from list_activities)"),
        max_results: z.number().int().min(1).max(500).default(BATCH_SIZE),
        batch_start: z.number().int().min(0).default(0).describe("Index of the first response to return (for continuing a previous call)"),
        include_contact_details: z.boolean().default(false).describe("Return every answer as stored, including respondent names, emails and IP addresses"),
      },
      annotations: READ,
    },
    safe(async ({ activity_uid, max_results, batch_start, include_contact_details }) => {
      const r = await api.listResponses(activity_uid, { maxItems: max_results, maxPages: 20, batchStart: batch_start });
      const responses = r.items.map((x) => fmt.response(x, include_contact_details));
      return {
        count: responses.length,
        total: r.total,
        batch_start,
        complete: r.complete,
        completed: responses.filter((x) => x.completed === true).length,
        deleted: responses.filter((x) => x.deleted === true).length,
        note: r.complete ? undefined : `More responses exist; call again with batch_start ${r.next_batch_start} to continue.`,
        responses,
      };
    }),
  );

  server.registerTool(
    "get_response_answers",
    {
      title: "Get one response",
      description:
        "One response with its answers (GET /api/1/activities/{uid}/responses/{id}, whose documented body includes the answers keyed 'Label (component_id)'). The same withholding and redaction as list_responses applies.",
      inputSchema: {
        activity_uid: uid("Activity").describe("Activity UID"),
        response_id: responseId.describe("Response ID, e.g. ANON-XXXX-YYYY-C (from list_responses)"),
        include_contact_details: z.boolean().default(false).describe("Return every answer as stored"),
      },
      annotations: READ,
    },
    safe(async ({ activity_uid, response_id, include_contact_details }) => {
      const raw = await api.get(`/api/1/activities/${activity_uid}/responses/${response_id}`);
      return { response: fmt.response(raw && typeof raw === "object" ? raw : {}, include_contact_details) };
    }),
  );

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description: `Workspaces on the site (GET /api/1/workspaces), or one workspace by uid (GET /api/1/workspaces/{uid}). ${UNDOCUMENTED}`,
      inputSchema: {
        workspace_uid: uid("Workspace").optional().describe("Return just this workspace"),
        max_results: z.number().int().min(1).max(1000).default(100),
        include_contact_details: z.boolean().default(false),
      },
      annotations: READ,
    },
    safe(async ({ workspace_uid, max_results, include_contact_details }) => {
      if (workspace_uid) {
        const { value, withheld } = fmt.redactRecord(await api.get(`/api/1/workspaces/${workspace_uid}`), include_contact_details);
        return { workspace: value as Json, ...(withheld.length ? { withheld_fields: withheld } : {}), note: UNDOCUMENTED };
      }
      const all = asArray(await api.get("/api/1/workspaces"));
      const { value, withheld } = fmt.redactRecord(all.slice(0, max_results), include_contact_details);
      return { count: Math.min(all.length, max_results), total: all.length, workspaces: value as Json, ...(withheld.length ? { withheld_fields: fieldNames(withheld) } : {}), note: UNDOCUMENTED };
    }),
  );

  server.registerTool(
    "list_users",
    {
      title: "List users",
      description: `Registered user accounts on the site (GET /api/1/users), filtered by the documented fullname, email and workspace_uid parameters, which are passed through as given. Names are returned; email addresses and other contact fields only with include_contact_details (note that filtering by email still confirms whether such an account exists). ${UNDOCUMENTED}`,
      inputSchema: {
        fullname: z.string().min(1).max(200).optional().describe("Filter users by full name (documented parameter fullname)"),
        email: z.string().min(1).max(200).optional().describe("Filter users by email address (documented parameter email)"),
        workspace_uid: uid("Workspace").optional().describe("Filter users by workspace UID (documented parameter workspace_uid)"),
        max_results: z.number().int().min(1).max(1000).default(100),
        include_contact_details: z.boolean().default(false).describe("Include email addresses and other contact fields"),
      },
      annotations: READ,
    },
    safe(async ({ fullname, email, workspace_uid, max_results, include_contact_details }) => {
      const all = asArray(await api.get("/api/1/users", { fullname, email, workspace_uid }));
      const { value, withheld } = fmt.redactRecord(all.slice(0, max_results), include_contact_details);
      return {
        count: Math.min(all.length, max_results),
        total_matching: all.length,
        note: all.length > max_results ? `Only the first ${max_results} of ${all.length} users are shown; raise max_results or filter.` : undefined,
        users: value as Json,
        ...(withheld.length ? { withheld_fields: fieldNames(withheld) } : {}),
        shape_note: UNDOCUMENTED,
      };
    }),
  );

  server.registerTool(
    "get_mailing_list",
    {
      title: "Get an activity's mailing list",
      description: `The email addresses subscribed to an activity's mailing list (GET /api/1/activities/{uid}/mailinglist). By default only the number of subscribers and the non-contact fields of each record are returned; the addresses themselves need include_contact_details. ${UNDOCUMENTED}`,
      inputSchema: {
        activity_uid: uid("Activity").describe("Activity UID"),
        max_results: z.number().int().min(1).max(5000).default(200),
        include_contact_details: z.boolean().default(false).describe("Return the subscribers' email addresses"),
      },
      annotations: READ,
    },
    safe(async ({ activity_uid, max_results, include_contact_details }) => {
      const raw = await api.get(`/api/1/activities/${activity_uid}/mailinglist`);
      const all: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
      const shown = all.slice(0, max_results);
      // A bare list of address strings is the literal reading of "a list of email addresses"; those
      // strings are contact details and are withheld outright unless asked for.
      const records = include_contact_details ? shown : shown.filter((x) => typeof x !== "string");
      const { value, withheld } = fmt.redactRecord(records, include_contact_details);
      return {
        subscriber_count: all.length,
        count: shown.length,
        note: include_contact_details ? undefined : "Email addresses are withheld; call again with include_contact_details=true to see them.",
        subscribers: value as Json,
        ...(withheld.length ? { withheld_fields: fieldNames(withheld) } : {}),
        shape_note: UNDOCUMENTED,
      };
    }),
  );
}

await server.connect(new StdioServerTransport());
console.error(`Citizen Space MCP server running against ${baseUrl} (Data API tools ${api.hasCredentials ? "enabled" : "disabled: no CITIZENSPACE_API_KEY/CITIZENSPACE_API_SECRET"}; no write tools).`);
