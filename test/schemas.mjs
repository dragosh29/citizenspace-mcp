// JSON schemas for the Citizen Space records this server reads. The OpenAPI document at
// /api/1/openapi.json declares no schemas, so these were written from the JSON examples on the Data
// API "API specification" page (test/documented-examples.mjs): every documented key is required, no
// other key is allowed, and the type of each key is the type shown in the example (null only where
// an example shows null; keys that appear in only one of two example records are optional).
// The Public API schema follows the field list on the "Version 2.4 reference" page, which has no
// JSON example; only the basic-tier fields are required because the others depend on `fields`, and
// other keys are allowed because the demo site returns some the reference does not list.
const str = { type: "string" };
const int = { type: "integer" };
const bool = { type: "boolean" };
const nullable = (s) => ({ ...s, type: [s.type, "null"] });
const object = (properties, { optional = [], additional = false } = {}) => ({
  type: "object",
  properties,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
  additionalProperties: additional,
});
export const arrayOf = (items, minItems = 0) => ({ type: "array", items, minItems });

// Dates in the activity example: "2023-03-29T00:00:00".
const DATETIME = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}$" };

// GET /api/1/whoami: the key's name, or "_anonymous_".
export const WhoAmI = { type: "string", minLength: 1 };

// GET /api/1/activities record.
export const Activity = object({ uid: str, title: str, state: str, start_date: DATETIME, end_date: DATETIME, path: str });

// Error bodies: {"error_message"} on the specification page, {"error": {"error_message"}} on the Basic Auth page.
export const ErrorFlat = object({ error_message: str });
export const ErrorWrapped = object({ error: ErrorFlat });
export const ErrorBody = { anyOf: [ErrorFlat, ErrorWrapped] };

// GET /api/1/activities/{uid}/survey
export const Survey = object({
  link_text: str,
  question_numbering: str,
  linear: bool,
  body: str,
  factbank_heading: str,
  factbank: str,
  thankyou_message: str,
  email_thankyou_message: str,
  has_skip_logic: bool,
});

// GET /api/1/activities/{uid}/pages record. skip_logic_rules is an empty list in the example, so
// its item shape is unknown.
export const Page = object({ id: str, title: str, body: str, factbank: str, factbank_heading: str, skip_logic_rules: { type: "array" }, type: str });

// GET /api/1/activities/{uid}/questions record. number is a string ("1") in the example.
export const Question = object({ page_id: str, id: str, title: str, number: str, analyst_only: bool });

// GET /api/1/activities/{uid}/components record. The first example has validation_options (an
// empty list), the second character_limit; label is null in the second.
export const Component = object(
  {
    id: str,
    type: str,
    visibility: arrayOf(str),
    required: bool,
    label: nullable(str),
    heading: str,
    validation_options: { type: "array" },
    character_limit: int,
    page_id: str,
    question_id: str,
  },
  { optional: ["validation_options", "character_limit"] },
);

// A response's answers: "Label (component_id)" keys with string or list-of-string values.
export const Answers = { type: "object", additionalProperties: { anyOf: [str, arrayOf(str)] } };
// GET /api/1/activities/{uid}/responses/{id} and the items of responses_batched.
export const Response = object({ id: str, completed: bool, deleted: bool, answers: Answers });
// GET /api/1/activities/{uid}/responses_batched
export const Batching = object({ total: int, batch_size: int, batch_start: int, next_batch_url: nullable(str) });
export const Batched = object({ batching: Batching, responses: arrayOf(Response) });

// Public API v2.4 record. Dates are "yyyy/mm/dd string, or empty string".
const PUBLIC_DATE = { type: "string", pattern: "^(\\d{4}/\\d{2}/\\d{2})?$" };
const link = object({ url: str, title: str });
const idName = object({ id: str, name: str });
export const PublicActivity = object(
  {
    // basic
    id: str,
    title: str,
    url: str,
    status: { type: "string", enum: ["open", "forthcoming", "closed"] },
    overview: str,
    startdate: PUBLIC_DATE,
    enddate: PUBLIC_DATE,
    // extended and above
    department: str,
    dept: str,
    type: str,
    type_string: str,
    participation_url: str,
    progress: str,
    visibility: { type: "string", enum: ["public", "private"] },
    // all only. The reference describes why and what_happens_next as field contents; the demo site
    // returned null for both on an activity that has none.
    why: nullable(str),
    what_happens_next: nullable(str),
    feedbackdate: str,
    resultsdate: str,
    contact_name: str,
    contact_jobtitle: str,
    contact_team: str,
    contact_phone: str,
    contact_email: str,
    related_links: arrayOf(link),
    related_consultations: arrayOf(link),
    supporting_documents: arrayOf(object({ url: str, title: str, size: str })),
    audiences: arrayOf(idName),
    areas: arrayOf(idName),
    interests: arrayOf(idName),
  },
  {
    optional: [
      "department", "dept", "type", "type_string", "participation_url", "progress", "visibility",
      "why", "what_happens_next", "feedbackdate", "resultsdate", "contact_name", "contact_jobtitle", "contact_team", "contact_phone", "contact_email",
      "related_links", "related_consultations", "supporting_documents", "audiences", "areas", "interests",
    ],
    additional: true,
  },
);
export const PublicActivityBasicOnly = { ...PublicActivity, additionalProperties: false, properties: Object.fromEntries(Object.entries(PublicActivity.properties).slice(0, 7)) };
