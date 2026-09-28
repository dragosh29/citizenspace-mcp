# Citizen Space MCP server

An [MCP](https://modelcontextprotocol.io) server that lets Claude, ChatGPT and other MCP clients work with a [Citizen Space](https://www.delib.net/citizen-space) consultation site: the published consultations anyone can see, and, with a Data API key, the activities, survey structures, responses, users, workspaces and mailing lists a council or government team runs. It is built from Delib's public documentation only: the Data API's OpenAPI document (`/api/1/openapi.json`, paths and parameters, no schemas), the JSON examples on the Data API "API specification" page, and the field list on the Public API "Version 2.4 reference" page.

Once it's connected, an engagement officer can ask things like:

- "Which of our consultations are open right now, and when do they close?"
- "What questions does the Kings Gardens survey ask, and on which pages?"
- "How many responses has it had, how many are complete, and what are people saying about the old oak?"
- "Who on our site is in the Parks workspace?"
- "How many people are on the mailing list for the library consultation?"

## Tools

| Tool | What it does | API calls |
|---|---|---|
| `search_public_activities` | Published, public activities with every documented search argument passed through under its documented name: free text (`tx`), postcode (`pc`), state (`st`), audience (`au`), interest (`in`), department (`de`), area (`ar`), a date range on the open or close date (`dk`, `fd`, `td`), activity type (`ct`) and the `fields` tier (basic, extended, all). No credentials needed. | `GET /api/2.4/json_search_results` |
| `get_public_activity` | One published activity by department id and activity id (the two slugs in its URL). No credentials needed. | `GET /api/2.4/json_consultation_details` |
| `whoami` | The name of the configured API key as the site sees it; a key the site does not recognise (the documented `_anonymous_` answer) is reported as an error that says what to check. | `GET /api/1/whoami` |
| `list_activities` | Every activity the key can see: uid, title, state, start and end date, path. The endpoint documents no parameters, so the `state` and keyword filters are applied locally. | `GET /api/1/activities` |
| `get_activity` | One activity by uid. Delib documents no response shape for this endpoint, so the record is passed through as sent, with contact-like fields withheld and text redacted. | `GET /api/1/activities/{uid}` |
| `get_survey_structure` | The survey as a tree: survey settings, each page with its questions, each question with its components (whose ids key the answers in responses), plus any question or component that does not fit under a page. | `GET /api/1/activities/{uid}/survey`, `/pages`, `/questions`, `/components` |
| `list_responses` | Responses in batches with the documented `batch_size`/`batch_start` parameters, re-requesting with the `batch_start` of each `next_batch_url` (or with `batch_start` plus the number received) while `next_batch_url` or `total` says more exist, and stopping at the documented `null`: id, completed and deleted flags, answers keyed `Label (component_id)`, with counts of completed and deleted responses. Continue with `batch_start`. | `GET /api/1/activities/{uid}/responses_batched` |
| `get_response_answers` | One response with its answers, from the documented single-response body (which includes the `answers` map). | `GET /api/1/activities/{uid}/responses/{id}` |
| `list_workspaces` | The site's workspaces, or one by uid. Response shape not documented; passed through with redaction. | `GET /api/1/workspaces`, `GET /api/1/workspaces/{uid}` |
| `list_users` | Registered user accounts, filtered by the documented `fullname`, `email` and `workspace_uid` parameters, passed through as given. Response shape not documented; names are returned, contact fields withheld by default. | `GET /api/1/users` |
| `get_mailing_list` | An activity's mailing list: the number of subscribers and each record's non-contact fields by default, the addresses only on request. Response shape not documented. | `GET /api/1/activities/{uid}/mailinglist` |

The two Public API tools are always registered. The nine Data API tools are registered only when `CITIZENSPACE_API_KEY` and `CITIZENSPACE_API_SECRET` are set.

**There are no write tools.** The OpenAPI document lists `POST /api/1/activities/{uid}` ("Change the details for an activity") and `POST .../responses/{id}` ("Mark a response as completed / not completed"), but their request bodies are typed as `null` and described only as "A mapping of the fields and values to update": no field names, no example. A tool cannot send a body it cannot validate, so `update_activity` and `update_response` are left out, as are the documented clear, remove and restore actions, answer updates and deletions, response creation, `GET .../responses` (the unbatched list), `GET .../mailinglist/{subscriber_id}`, `GET .../answers`, `GET .../answers/{component_id}` (which the spec says may download a file) and `GET /api/1/users/{user_id}`. `CITIZENSPACE_ALLOW_WRITES` is not read.

## Setup

Requires Node 18 or later.

```bash
npm install
npm run build
```

For the public tools you only need your site's subdomain. For the Data API you need an API key: as the "Generating API keys" page documents, a site admin creates one under **Site Settings > API** (the Data API has to be enabled on the site first; Delib's help site says this is done per customer on request), gives it permissions (the read ones used here are `activities.search`, `activities.read`, `activities.responses.read`, `activities.mailinglist.read`, `users.search`, `users.read`, `workspaces.search`, `workspaces.read`), and copies the Key and Secret. The server sends them as HTTP Basic `key:secret`, as the "Basic Auth headers with Citizen Space" page documents.

**Claude Desktop:** add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "citizenspace": {
      "command": "node",
      "args": ["/absolute/path/to/citizenspace-mcp/dist/index.js"],
      "env": { "CITIZENSPACE_INSTANCE": "your-site", "CITIZENSPACE_API_KEY": "your-key", "CITIZENSPACE_API_SECRET": "your-secret" }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add citizenspace -e CITIZENSPACE_INSTANCE=your-site -e CITIZENSPACE_API_KEY=your-key -e CITIZENSPACE_API_SECRET=your-secret -- node /absolute/path/to/citizenspace-mcp/dist/index.js
```

| Variable | Required | Meaning |
|---|---|---|
| `CITIZENSPACE_INSTANCE` | yes, unless `CITIZENSPACE_BASE_URL` is set | The subdomain of your site: `demo` for `https://demo.citizenspace.com`. Letters, digits and hyphens only; anything else stops the server at start-up. |
| `CITIZENSPACE_API_KEY` | for the Data API tools | The Key of an API key from Site Settings > API. Must be set together with the secret. |
| `CITIZENSPACE_API_SECRET` | for the Data API tools | The Secret of that API key. Never logged; the key, the secret and the base64 credential are replaced by `[redacted]` in any body the site or a proxy echoes into an error message. |
| `CITIZENSPACE_BASE_URL` | no | Overrides the site URL, e.g. `https://demo.citizenspace.com`. Used by the tests. |

## Safety defaults

- Every tool is read-only and carries the MCP `readOnlyHint` annotation. There is no write tool to enable (see above).
- Respondents, subscribers, officers and users are third parties. By default:
  - in responses, the standard respondent-management answers (`opsuite.respondentmanagement.*`: name, organisation), the email answer (`quickconsult.email*`), the IP address and browser answers (`__userinfo_ip`, `__userinfo_useragent`) and any answer whose label asks for a name, organisation, email, phone, address, postcode, date of birth, NHS number, National Insurance number, passport, signature or username are withheld and their keys listed under `withheld_answers`; the remaining answers are returned with email addresses replaced by `[email redacted]`, a date that follows "born", "DOB", "d.o.b.", "date of birth", "birth date" or "birthday" by `[date of birth redacted]`, phone-number-like sequences by `[phone redacted]`, 13-19 digit numbers that pass the Luhn check by `[card number redacted]`, ten-digit numbers that pass the NHS modulus-11 check by `[NHS number redacted]`, National Insurance numbers by `[NI number redacted]` and UK postcodes, in either case, by `[postcode redacted]`. A free-text answer can still contain personal data no pattern catches (a street address such as "4 Plymouth Road", a health condition, a name in a sentence, a date of birth given without one of those words, a passport or driving-licence number), so treat response text as personal data even by default. Demographic questions (age, ethnicity, disability, religion) are not withheld: on a consultation they are usually the equalities-monitoring part of the analysis itself;
  - on public activities, `contact_phone` and `contact_email` are withheld; `contact_name`, `contact_jobtitle` and `contact_team` (the officer's published contact block) are returned;
  - on the records whose shape Delib does not document (users, workspaces, mailing-list subscribers, activity detail), any key whose name contains a word that suggests contact or identity data (email or e_mail, phone, telephone, tel, mobile, fax, address, postcode, zip, dob, birth, birthday, birthdate, ip, user agent, nhs, passport, national insurance, ni number, bank, iban, sort code, card, username) is withheld and listed under `withheld_fields`. The key is normalised first (camelCase split, lower-cased), so `contact_email`, `emailAddress`, `dateOfBirth`, `homeAddress`, `IPAddress`, `nhsNumber` and `address1` are all caught, while `description`, `title`, `hotel` and `shipping` are not; a key that names the data without one of those words (`fullname` is kept on purpose; `identifier`, `contact` on its own) is not. A mailing list served as bare address strings is withheld entirely;
  - every other string (titles, survey and page text, question and component labels, answers, names of people, audiences, areas and interests, URLs, paths, error messages, the excerpt of a non-JSON body) goes through the same redaction. Names are returned, minus any email or phone typed into them.
  - `include_contact_details=true` on any tool returns everything as stored.
  - The text patterns are heuristics. Phone: international numbers written with `+` or `00`, UK numbers with a bracketed area code, and UK-style `0…` numbers of 9 to 11 digits; other digit strings starting with `0` are redacted too, while 32-character uids, response ids such as `ANON-XXXX-YYYY-C` and timestamps are left alone. Postcode: one or two letters, a digit, an optional letter or digit, an optional space, a digit and two letters, upper or lower case, where the last two letters are never C, I, K, M, O or V (as in real postcodes), so "5pm" and "3cm" are not caught but "B12 5th" is redacted. NI number: any two capitals, six digits and A-D, with or without spaces, not only the prefixes HMRC allocates. NHS and card numbers: only digit strings that pass the documented check digit, which one arbitrary string in eleven (NHS) or ten (card) also passes, so a long numeric id can be redacted by mistake. Date of birth: only when introduced by one of the words above, in dd/mm/yyyy, yyyy-mm-dd or "12 March 1985" form. Nothing catches a name, a street address, or a date of birth given without one of those words.
- Nothing is ever downloaded: `GET .../answers/{component_id}` ("Read or download the answer") is not used.
- IDs are checked before any call is made: activity and workspace uids and response ids must be single path segments of letters, digits, `_` and `-` (up to 64 characters; every documented example is 32 lowercase hex characters, but the spec types them as plain strings); Public API `dept` and `id` are slugs of letters, digits, `.`, `_` and `-`. Public API dates take the documented `yyyy/mm/dd` (or `yyyy-mm-dd`, converted) and real calendar dates only, and `date_from`/`date_to` are refused without `date_kind`, because the reference says they "must be used in conjunction with `dk`".
- The Public API tools never send the Authorization header (the reference says no authentication is required and the access level is that of a public visitor); the Data API tools send it on every call.
- Delib documents no rate limit for either API. Requests are spaced 250 ms apart (about four per second). A 429 is retried at most twice, waiting for `Retry-After` (whole or fractional seconds, or an HTTP-date; 2 s then 4 s when the header is absent or unreadable). Each wait is capped at 10 seconds so a single request stays well under the MCP client's default 60-second request timeout: if the site asks for a longer wait the call gives up at once and the message says how long to wait. The cap is per request, not per tool call: `list_responses` can make up to 20 requests in one call.
- 502, 503 and 504 are retried the same way for `GET` only (every call here is a GET); when all three attempts fail the error says the site may be unavailable and to try again in a few minutes, without the gateway's HTML. On any other status a body that is not JSON is quoted (first 300 characters) only when it is not markup, so a proxy's 404 page is not passed on either.
- A 200 whose body is not JSON (a proxy or a login page in the way) is reported as an error naming `CITIZENSPACE_INSTANCE` / `CITIZENSPACE_BASE_URL`, never as an empty list; a `responses_batched` body that is JSON but has no `responses` list (for example the bare list of the unbatched endpoint) is reported as an error naming the shape received, never as an empty list.
- Any text quoted from a body into an error (the documented `error_message`, the excerpt of a non-JSON body) is scrubbed of the configured key, secret and base64 credential before it is cut to length, so a site or proxy that echoes the Authorization header cannot put it, or a prefix of it, into a tool result; the rest of the excerpt goes through the redaction above.
- A rejected key produces a message that names the two variables, where the key comes from, and the permissions the call may be missing; the documented `_anonymous_` answer from `whoami` gets the same treatment. A key without a secret, or a secret without a key, stops the server at start-up.

## Tests

```bash
npm test
```

The test suite:

1. Checks the schemas against the documentation they were written from. Delib's OpenAPI document declares no schemas, so `test/schemas.mjs` was written by hand from the JSON examples on the Data API "API specification" page (copied into `test/documented-examples.mjs`, with the snippets that are not valid JSON as printed, the two `whoami` bodies and list fragments with trailing commas, transcribed into the records they show: every documented key required, no other keys, types as shown). The first check validates each schema against the example it came from (whoami, activities, both documented error shapes, survey, page, two questions, two components, a response, a batched list), confirms the OpenAPI document (downloaded from `demo.citizenspace.com/api/1/openapi.json` to `spec.json` on the first run) has 26 operations, no components, every Data API endpoint this server calls, the documented `batch_size`/`batch_start` and `fullname`/`email`/`workspace_uid` parameters, and `null` request-body schemas on the two update operations, and that the mock's key and secret are obviously fake values that appear nowhere in the documentation. The Public API reference lists fields without a JSON example, so its schema is checked against one record observed on the demo site (see Status) and against the fixtures. The second check validates every fixture record against the schemas, including every `fields` tier of the public records.
2. Starts a local mock of a site: the Data API under `/api/1` with HTTP Basic `key:secret`, a 401 with the documented error body for anything else, `whoami` answering the key's name or the documented `_anonymous_`, 404s for unknown uids and ids, `responses_batched` with the documented batching object and `next_batch_url` (capped at 10 per batch so a 24-response activity spans three batches), the documented user filters, and the Public API under `/api/2.4` with no authentication, the three `fields` tiers, the search arguments and a 404 for an unknown dept/id; injected failures on any endpoint (a JSON body, an HTML page, or a page with a given text), and a one-off 429 on the first `GET /api/1/activities`. The third check validates the mock's responses against the schemas.
3. Starts the built server and drives it over stdio with the official MCP client: 29 checks (32 in the whole suite) covering every tool, tool annotations, no write tool even with `CITIZENSPACE_ALLOW_WRITES=true`, the public-only mode without credentials and the three start-up refusals (key without secret, bad instance, no instance), the host derived from `CITIZENSPACE_INSTANCE` alone and no request at start-up (a server pointed at the mock is up before the mock sees anything), every documented Public API argument passed through under its documented name with `yyyy-mm-dd` converted, the local refusals (date range without `date_kind`, month 13, 30 February and 31 April, bad enums, bad slugs), the `fields` tiers, contact withholding and text redaction by default, including an email in a link's URL and a phone number in an area's name, and their return on request, `get_public_activity` with its 404, `whoami` and its `_anonymous_` error, `list_activities` after a 429 retry that waited for `Retry-After` with its local filters, `get_activity`'s pass-through, the survey tree with orphans, batching across three batches ending at `next_batch_url` null with `max_results` and `batch_start` continuation and a start past the end, batching when `next_batch_url` is absent but `total` says more exist, when there is no `batching` object at all, when `total` is reached without a `next_batch_url`, and when the documented null contradicts `total` (null wins), a bare list or any other body without a `responses` list reported as an error, response withholding and redaction by default (a signature answer withheld on its label; a date of birth, NHS, NI and card number and a lower-case postcode redacted in one free-text answer, the street address in it not) and as stored on request, one response by id, the user filters passed through exactly with contact fields, camelCase ones included, withheld and listed, workspaces with their withheld fields listed by name, the mailing list with no address in the default output (records and bare strings), bad ids refused before any call, the 404 messages, the 429 retry in the seconds, fractional-seconds and HTTP-date forms and the 2 s fallback without the header, the wrapped error shape, giving up after three attempts on a persistent 429 and at once on a `Retry-After` above the cap, a 502 retried and a triple 503 reported with advice and without the gateway HTML, a 200 with a non-JSON body reported as an error, an HTML 404 page not quoted, a 400, a 401 and a 200 login page that echo the Authorization header, the key and the secret never putting them (or a prefix of the credential) into a tool result, that every Data API request carried Basic `base64(key:secret)` and every Public API request no credentials, each to a documented method and path (the Data API templates from the OpenAPI document, the two Public API methods from the reference), and the 401 message for a wrong secret while the public tools keep working. The suite takes about 30 seconds.

## Status

This is a working prototype. It has **not yet been run against the live Data API**, because it was built without a Citizen Space site or API key (there is no self-serve trial; Delib enables the Data API per customer site). The only live requests, all to the documented demo site `demo.citizenspace.com` and none with a real key, were: during the research that chose this prototype, an unauthenticated `GET /api/2.4/json_search_results?st=open` (200, two open activities), `GET /api/1/whoami` both without credentials and with a made-up key (the body was `_anonymous_` both times; the status code was not recorded) and an unauthenticated `GET /api/1/activities` (401 with the documented `"Forbidden: Unauthorized: activity_search failed permission check"` body); and on 28 September 2026, while building, four unauthenticated Public API requests (`json_search_results?st=open`, the same with `fields=all`, `json_consultation_details` for one of the results, and one with an unknown dept and id, which answered 404 as documented) to check the Public API reference against real output. Everything below should be confirmed on a real site:

- The Public API's field names. On the demo site the extended tier spelled `participation_url` as `participate_url` and `resultsdate` as `resultdate`, added `activity_type`, `workspace_id` and `workspace_title` that the reference does not list, and returned `null` for `why` and `what_happens_next` where the reference describes text. The server reads both spellings and tolerates the nulls; the observed record is kept in `test/documented-examples.mjs` marked as observed, not documented.
- `whoami`: the page prints its bodies as `{ "Test Key" }` and `{ "_anonymous_" }`, which is not valid JSON. The server accepts a bare JSON string or an object; the mock answers a bare string. Whether a wrong key gets `_anonymous_` with a 200 or a 400 (the page files it under 400; the research probe saw the `_anonymous_` body but did not record the status): the server reports both as a credentials problem, and the tests cover the 400 form.
- The status code for a missing or wrong key on the other endpoints: the page files the `"Forbidden: Unauthorized: ... failed permission check"` body under a 400 tab; the research probe of `/api/1/activities` got a 401. The server treats 401, 403, and a 400 whose message says unauthorised or permission check, as a credentials problem (the tests cover 401, 403 and the `whoami` 400).
- Which of the two documented error shapes (`{"error_message"}` or `{"error": {"error_message"}}`) the site uses; both are read.
- `GET /api/1/activities`: whether it pages (nothing is documented; the server reads it as one list), whether it includes private, draft or archived activities, and the full set of `state` values (only `open` appears in the examples).
- `responses_batched`: the default and maximum `batch_size` (the examples use 10; the server asks for up to 50), whether `next_batch_url` is absolute or relative (the server only reads its `batch_start`, falling back to `batch_start` plus the number received), whether it is ever absent rather than null (the server then keeps paging while `total` says more exist, or until an empty batch when there is no `batching` object) and whether `total` counts responses that the batches leave out, such as deleted ones (the documented null ends paging even when `total` says otherwise), whether deleted responses are included with `deleted: true` or left out, what a `batch_start` past the end returns (the mock answers an empty batch with `next_batch_url` null), and the order of responses.
- The types of answer values. The examples show strings and lists of strings; anything else is passed through the same redaction.
- The response shapes of `GET /api/1/activities/{uid}`, `/mailinglist`, `/api/1/users` and `/api/1/workspaces`, which the page does not document at all. The mock serves the list record for the activity detail, `{id, fullname, email, workspace_uid, telephone}` users (from the documented filter names), `{uid, title}` workspaces and `{subscriber_id, email, name}` subscribers; the server never depends on those names, but the default output of those tools is only as safe as the key-name heuristic, so check what a real record contains before relying on the default view.
- How the `fullname` and `email` user filters match (substring, exact, case) and whether `GET /api/1/users` pages.
- The permissions each endpoint needs (the "Generating API keys" page lists the names but not which endpoint needs which) and what a key without the right one answers.
- Rate limits: nothing is documented anywhere in the pages read, so the 250 ms spacing here is a guess on the polite side.
- The `pc` (postcode) search argument: the mock accepts and ignores it, so only the pass-through is tested.

## Going to production

This version runs locally over stdio, with the site's own API key, and only reads. For councils to connect from claude.ai or ChatGPT without handling keys, the next step is a remote server (Streamable HTTP) behind OAuth, hosted by Delib, a run of the suite against a real site to settle the points above, and then a listing in the Claude and ChatGPT connector directories.

## Licence

MIT. Built by Alexandru Dragoș (alexandru.dragos96@gmail.com) with an AI agent (Claude) working under his direction.
