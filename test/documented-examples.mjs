// The JSON examples Delib publishes for the endpoints this server uses, copied on 28 September 2026
// from https://delibdocs.gitbook.io/welcome/citizen-space/data-api/api-specification (SPEC_PAGE) and
// https://delibdocs.gitbook.io/welcome/citizen-space/data-api/basic-auth-headers-with-citizen-space
// (AUTH_PAGE). The OpenAPI document at /api/1/openapi.json has no schemas, so test/schemas.mjs was
// written from these and e2e.mjs checks each schema against the example it came from.
//
// Several of the page's snippets are not valid JSON as printed and are transcribed here as the records
// they show: the whoami bodies are printed as `{ "Test Key" }` and `{ "_anonymous_" }` (a bare string
// in braces); the activities, pages, questions, components and responses examples are single records
// or fragments of a list with a trailing comma. Field names, values and nesting are unchanged.
export const SPEC_PAGE = "https://delibdocs.gitbook.io/welcome/citizen-space/data-api/api-specification";
export const AUTH_PAGE = "https://delibdocs.gitbook.io/welcome/citizen-space/data-api/basic-auth-headers-with-citizen-space";
export const PUBLIC_REFERENCE = "https://delibdocs.gitbook.io/welcome/citizen-space/public-api/version-2.4-reference";

export const whoami = { ok: "Test Key", anonymous: "_anonymous_" };

// SPEC_PAGE, "List activities" (one record, uid partly masked on the page) and AUTH_PAGE (three records).
export const activities = [
  {
    uid: "67f18beb302944c9944e06521cfxxxxx",
    title: "Smallville resident forum",
    state: "open",
    start_date: "2023-03-29T00:00:00",
    end_date: "2027-03-26T00:00:00",
    path: "demo/smallville-resident-forum",
  },
  {
    uid: "67f18beb302944c9944e06521cf2224e",
    title: "Smallville resident forum",
    state: "open",
    start_date: "2023-03-29T00:00:00",
    end_date: "2027-03-26T00:00:00",
    path: "demo/smallville-resident-forum",
  },
  {
    uid: "ce620a61c70647ea90c8c63e6faefb3f",
    title: "Mediumville resident forum",
    state: "open",
    start_date: "2023-03-29T00:00:00",
    end_date: "2027-03-26T00:00:00",
    path: "demo/mediumville-resident-forum",
  },
  {
    uid: "4c55f1f0f9c34c248fbd6094770fe833",
    title: "Take part in the latest panel survey",
    state: "open",
    start_date: "2023-03-29T00:00:00",
    end_date: "2027-03-25T00:00:00",
    path: "demo/take-part-in-the-latest-panel-survey",
  },
];

// SPEC_PAGE, error bodies shown under the 400 tabs (AUTH_PAGE shows the same message wrapped in "error").
export const errors = {
  flat: { error_message: "Forbidden: Unauthorized: activity_search failed permission check" },
  wrapped: { error: { error_message: "Forbidden: Unauthorized: activity_search failed permission check" } },
};

// SPEC_PAGE, "Inspect survey information".
export const survey = {
  link_text: "Online Survey",
  question_numbering: "continuous",
  linear: true,
  body: "",
  factbank_heading: "Related information",
  factbank: "",
  thankyou_message: "Thank you for your response.",
  email_thankyou_message: "Thank you for your response.",
  has_skip_logic: false,
};

// SPEC_PAGE, "Inspect survey pages".
export const page = {
  id: "intro",
  title: "Introduction",
  body: "",
  factbank: "",
  factbank_heading: "Related information",
  skip_logic_rules: [],
  type: "SubPage",
};

// SPEC_PAGE, "Inspect survey questions" (two records).
export const questions = [
  { page_id: "intro", id: "opsuite.respondentmanagement.name", title: "What is your name?", number: "1", analyst_only: false },
  { page_id: "intro", id: "quickconsult.email", title: "What is your email address?", number: "2", analyst_only: false },
];

// SPEC_PAGE, "Inspect survey components" (two records; note the differing optional keys).
export const components = [
  {
    id: "opsuite.respondentmanagement.name_subquestion",
    type: "textsubquestion",
    visibility: ["analyst", "public"],
    required: false,
    label: "Name",
    heading: "Name",
    validation_options: [],
    page_id: "intro",
    question_id: "opsuite.respondentmanagement.name",
  },
  {
    id: "opsuite.respondentmanagement.name-quickconsult.analysis.what_to_analyse_subquestion",
    type: "whattoanalysesubquestion",
    visibility: ["analyst"],
    required: false,
    label: null,
    heading: "Analyst notes",
    character_limit: 0,
    page_id: "intro",
    question_id: "opsuite.respondentmanagement.name",
  },
];

// SPEC_PAGE, "List responses", "Inspect a response" and the items of "List responses (batched)"
// (the same record in all three).
export const response = {
  id: "ANON-XXXX-YYYY-C",
  completed: true,
  deleted: false,
  answers: {
    "Name (opsuite.respondentmanagement.name_subquestion)": "Test",
    "Email (quickconsult.email_subquestion)": "test@example.com",
    "Organisation (opsuite.respondentmanagement.organisation_subquestion)": "Test Organisation",
    "Visited Pages (__userinfo_pages_visited)": ["intro"],
    "IP Address (__userinfo_ip)": "...",
    "Browser Identification (__userinfo_useragent)": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    "Survey State (__userinfo_state)": "open",
    "Citizen Space Version (__userinfo_cs_version)": ["v7.27.0"],
  },
};

// SPEC_PAGE, "List responses (batched)".
export const batched = {
  batching: { total: 24, batch_size: 10, batch_start: 20, next_batch_url: null },
  responses: [response],
};

// The Public API reference lists fields without a JSON example. This record was observed with one
// unauthenticated request on 28 September 2026: GET https://demo.citizenspace.com/api/2.4/
// json_search_results?st=open&fields=all (the first of two results, HTML overview shortened, the
// area and audience lists cut to two entries). It is NOT documentation: it is kept so the schema
// written from the reference is checked against real output once, and it shows where the site
// departs from the reference (participate_url for participation_url, resultdate for resultsdate,
// extra activity_type, workspace_id and workspace_title, null why and what_happens_next).
export const observedPublicActivity = {
  interests: [{ id: "Cãrs", name: "Schools" }],
  overview: "<p>Thank you for joining us at the recent Education Policy Briefing.</p>",
  audiences: [
    { id: "Yöung People", name: "Young People" },
    { id: "Sëlf-employed", name: "Self-employed" },
  ],
  contact_name: "",
  id: "event-feedback-survey",
  startdate: "2024/11/12",
  contact_jobtitle: "",
  contact_team: "",
  title: "Event feedback survey",
  resultdate: "",
  what_happens_next: null,
  supporting_documents: [],
  participate_url: "https://demo.citizenspace.com/realistic-looking-examples/event-feedback-survey/consultation",
  department: "Realistic-looking examples",
  progress: "published",
  type: "QuickConsult",
  related_consultations: [],
  status: "open",
  type_string: "Online Survey",
  workspace_id: "realistic-looking-examples",
  feedbackdate: "",
  visibility: "public",
  contact_email: "",
  related_links: [],
  why: null,
  areas: [
    { id: ".site.Ashley", name: "Ashley" },
    { id: ".site.Avonmouth", name: "Avonmouth" },
  ],
  enddate: "2027/11/25",
  url: "https://demo.citizenspace.com/realistic-looking-examples/event-feedback-survey/consult_view",
  contact_phone: "0123456789",
  workspace_title: "Realistic-looking examples",
  dept: "realistic-looking-examples",
  activity_type: "basic_survey",
};
