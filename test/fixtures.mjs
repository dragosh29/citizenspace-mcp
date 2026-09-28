// Fake Citizen Space data shaped like the documented examples (validated against test/schemas.mjs in
// e2e.mjs). Every id is an obviously fake, low-entropy value; every person is invented.

// Activity uids: the documented ones are 32 hex characters; these are 32 characters of zeros and a tag.
export const PARK = "0000000000000000000000000000pa01"; // open survey with 24 responses
export const LIBRARY = "0000000000000000000000000000li02"; // closed survey with 2 responses
export const BUDGET = "0000000000000000000000000000bu03"; // forthcoming, no survey yet

export const activities = [
  { uid: PARK, title: "Kings Gardens spring planting", state: "open", start_date: "2026-09-01T00:00:00", end_date: "2026-11-30T00:00:00", path: "parks-and-recreation/kings-gardens-spring-planting" },
  { uid: LIBRARY, title: "Central library opening hours (queries to library@example.gov.uk)", state: "closed", start_date: "2026-03-01T00:00:00", end_date: "2026-05-31T00:00:00", path: "libraries/central-library-opening-hours" },
  { uid: BUDGET, title: "Budget 2027 priorities", state: "forthcoming", start_date: "2027-01-10T00:00:00", end_date: "2027-03-10T00:00:00", path: "finance/budget-2027-priorities" },
];

export const surveys = {
  [PARK]: {
    link_text: "Online Survey",
    question_numbering: "continuous",
    linear: true,
    body: "<p>Tell us what you think of the planting plan. Questions: parks@example.gov.uk or 0117 496 0000.</p>",
    factbank_heading: "Related information",
    factbank: "",
    thankyou_message: "Thank you for your response.",
    email_thankyou_message: "Thank you for your response.",
    has_skip_logic: false,
  },
  [LIBRARY]: {
    link_text: "Online Survey",
    question_numbering: "continuous",
    linear: true,
    body: "",
    factbank_heading: "Related information",
    factbank: "",
    thankyou_message: "Thank you for your response.",
    email_thankyou_message: "Thank you for your response.",
    has_skip_logic: false,
  },
};

export const pages = {
  [PARK]: [
    { id: "intro", title: "About you", body: "", factbank: "", factbank_heading: "Related information", skip_logic_rules: [], type: "SubPage" },
    { id: "planting", title: "The planting plan", body: "<p>Three beds are proposed.</p>", factbank: "", factbank_heading: "Related information", skip_logic_rules: [], type: "SubPage" },
  ],
  [LIBRARY]: [{ id: "intro", title: "About you", body: "", factbank: "", factbank_heading: "Related information", skip_logic_rules: [], type: "SubPage" }],
};

export const questions = {
  [PARK]: [
    { page_id: "intro", id: "opsuite.respondentmanagement.name", title: "What is your name?", number: "1", analyst_only: false },
    { page_id: "intro", id: "quickconsult.email", title: "What is your email address?", number: "2", analyst_only: false },
    { page_id: "planting", id: "q_support", title: "Do you support the planting plan?", number: "3", analyst_only: false },
    { page_id: "planting", id: "q_comments", title: "Any other comments?", number: "4", analyst_only: false },
  ],
  [LIBRARY]: [{ page_id: "intro", id: "q_hours", title: "Which opening hours suit you?", number: "1", analyst_only: false }],
};

export const components = {
  [PARK]: [
    { id: "opsuite.respondentmanagement.name_subquestion", type: "textsubquestion", visibility: ["analyst", "public"], required: false, label: "Name", heading: "Name", validation_options: [], page_id: "intro", question_id: "opsuite.respondentmanagement.name" },
    { id: "opsuite.respondentmanagement.name-quickconsult.analysis.what_to_analyse_subquestion", type: "whattoanalysesubquestion", visibility: ["analyst"], required: false, label: null, heading: "Analyst notes", character_limit: 0, page_id: "intro", question_id: "opsuite.respondentmanagement.name" },
    { id: "quickconsult.email_subquestion", type: "textsubquestion", visibility: ["analyst", "public"], required: false, label: "Email", heading: "Email", validation_options: [], page_id: "intro", question_id: "quickconsult.email" },
    { id: "q_support_subquestion", type: "radiosubquestion", visibility: ["analyst", "public"], required: true, label: "Support", heading: "Support", validation_options: [], page_id: "planting", question_id: "q_support" },
    { id: "q_comments_subquestion", type: "textareasubquestion", visibility: ["analyst", "public"], required: false, label: "Comments", heading: "Comments", character_limit: 2000, page_id: "planting", question_id: "q_comments" },
    { id: "orphan_subquestion", type: "textsubquestion", visibility: ["analyst"], required: false, label: "Orphan", heading: "Orphan", validation_options: [], page_id: "gone", question_id: "q_gone" },
  ],
  [LIBRARY]: [{ id: "q_hours_subquestion", type: "checkboxsubquestion", visibility: ["analyst", "public"], required: true, label: "Hours", heading: "Hours", validation_options: [], page_id: "intro", question_id: "q_hours" }],
};

const COMMENTS = [
  "Love it. Call me on 07700 900123 if you need volunteers.",
  "Please keep the old oak. sam.evans@example.com",
  "Fine as long as the path stays. I live at 4 Plymouth Road, CF64 3DH.",
  "No comment",
];
const mkResponse = (n, activityTag, { completed = true, deleted = false } = {}) => ({
  id: `ANON-${activityTag}-${String(n).padStart(4, "0")}-C`,
  completed,
  deleted,
  answers: {
    "Name (opsuite.respondentmanagement.name_subquestion)": `Person ${n}`,
    "Email (quickconsult.email_subquestion)": `person${n}@example.com`,
    "Organisation (opsuite.respondentmanagement.organisation_subquestion)": n % 5 === 0 ? "Friends of Kings Gardens" : "",
    "Support (q_support_subquestion)": n % 3 === 0 ? "No" : "Yes",
    "Comments (q_comments_subquestion)": COMMENTS[n % COMMENTS.length],
    "Visited Pages (__userinfo_pages_visited)": ["intro", "planting"],
    "IP Address (__userinfo_ip)": `203.0.113.${n}`,
    "Browser Identification (__userinfo_useragent)": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    "Survey State (__userinfo_state)": "open",
    "Citizen Space Version (__userinfo_cs_version)": ["v7.27.0"],
  },
});

// 24 responses, as in the documented batching example (total 24). Two are incomplete, one is deleted.
export const responses = {
  [PARK]: Array.from({ length: 24 }, (_, i) => mkResponse(i + 1, "PARK", { completed: i !== 3 && i !== 17, deleted: i === 9 })),
  [LIBRARY]: [
    { id: "ANON-LIB-0001-C", completed: true, deleted: false, answers: { "Hours (q_hours_subquestion)": ["Saturday morning", "Weekday evenings"], "Your postcode (q_postcode_subquestion)": "CF64 3DH", "Signature (q_sig_subquestion)": "Jane Doe", "Visited Pages (__userinfo_pages_visited)": ["intro"], "Survey State (__userinfo_state)": "closed" } },
    // A free-text answer with the identifiers the text patterns are meant to catch (all invented; the
    // NHS number passes the modulus-11 check, the card number the Luhn check) and one they cannot (a
    // street address).
    { id: "ANON-LIB-0002-C", completed: false, deleted: false, answers: { "Hours (q_hours_subquestion)": ["Sunday"], "Anything else (q_more_subquestion)": "born 12/03/1985, NHS 943 476 5919, NI QQ 12 34 56 C, card 4111 1111 1111 1111, live at 4 Plymouth Road, cf64 3dh", "Visited Pages (__userinfo_pages_visited)": ["intro"], "Survey State (__userinfo_state)": "closed" } },
  ],
};

// The shapes below are NOT documented by Delib (no example on the specification page). They are the
// mock's own choice: the users list uses the names of the documented query parameters (fullname,
// email, workspace_uid); workspaces and mailing-list subscribers are minimal records. The server
// passes these records through generically and never depends on these key names.
export const workspaces = [
  { uid: "0000000000000000000000000000ws01", title: "Parks and recreation", owner_email: "parks-owner@example.gov.uk" },
  { uid: "0000000000000000000000000000ws02", title: "Libraries (front desk 029 2000 0000)" },
];
export const users = [
  // camelCase keys, as a site written in another convention might use: the key matcher must catch them too.
  { id: "user-1", fullname: "Dana Barrett", email: "dana.barrett@example.gov.uk", workspace_uid: workspaces[0].uid, telephone: "0117 496 0001", dateOfBirth: "1980-01-02", homeAddress: "4 Plymouth Road" },
  { id: "user-2", fullname: "Priya Shah (priya@example.net)", email: "priya.shah@example.gov.uk", workspace_uid: workspaces[1].uid, telephone: "" },
  { id: "user-3", fullname: "Lee Chen", email: "lee.chen@example.gov.uk", workspace_uid: workspaces[0].uid, telephone: "" },
];
export const mailingList = {
  [PARK]: [
    { subscriber_id: "sub-1", email: "resident1@example.org", name: "Resident One" },
    { subscriber_id: "sub-2", email: "resident2@example.org", name: "Resident Two" },
    { subscriber_id: "sub-3", email: "resident3@example.org", name: "Resident Three (07700 900999)" },
  ],
  [LIBRARY]: [],
  // The literal reading of "a list of email addresses": bare strings.
  [BUDGET]: ["resident4@example.org", "resident5@example.org"],
};

// Public API v2.4 records (every tier); the mock strips them to the requested `fields` tier.
const pub = (dept, department, id, title, status, startdate, enddate, extra = {}) => ({
  id,
  title,
  url: `https://mock.citizenspace.test/${dept}/${id}/`,
  status,
  overview: `<p>${title}.</p>`,
  startdate,
  enddate,
  department,
  dept,
  type: "QuickConsult",
  type_string: "Online Survey",
  participation_url: `https://mock.citizenspace.test/${dept}/${id}/consultation/`,
  progress: "published",
  visibility: "public",
  why: "We are consulting because the council must decide by spring.",
  what_happens_next: "The results will be reported to the cabinet.",
  feedbackdate: "",
  resultsdate: "",
  contact_name: "Dana Barrett",
  contact_jobtitle: "Engagement officer",
  contact_team: "Parks",
  contact_phone: "0117 496 0000",
  contact_email: "dana.barrett@example.gov.uk",
  related_links: [{ url: "https://example.gov.uk/parks", title: "Parks strategy" }],
  related_consultations: [],
  supporting_documents: [{ url: "https://mock.citizenspace.test/files/plan.pdf", title: "Planting plan", size: "1.2 MB" }],
  audiences: [{ id: "residents", name: "Residents" }],
  areas: [{ id: "central", name: "Central" }],
  interests: [{ id: "parks", name: "Parks and open spaces" }],
  ...extra,
});
export const publicActivities = [
  pub("parks-and-recreation", "Parks and recreation", "kings-gardens-spring-planting", "Kings Gardens spring planting", "open", "2026/09/01", "2026/11/30"),
  pub("libraries", "Libraries", "central-library-opening-hours", "Central library opening hours", "closed", "2026/03/01", "2026/05/31", {
    overview: "<p>Opening hours review. Email library@example.gov.uk or ring 029 2000 0000 with questions. Drop-in at BS8 1AA.</p>",
    type: "File",
    type_string: "Email/Postal Activity",
    audiences: [{ id: "students", name: "Students" }],
    interests: [{ id: "libraries", name: "Libraries" }],
    // A phone number in an area's name and an email in a link's URL: every string is redacted.
    areas: [{ id: "north", name: "North (office 029 2000 0000)" }],
    related_links: [{ url: "https://example.gov.uk/contact?officer=dana.barrett@example.gov.uk", title: "Contact the team" }],
  }),
  pub("finance", "Finance", "budget-2027-priorities", "Budget 2027 priorities", "forthcoming", "2027/01/10", "2027/03/10", { type: "Link", type_string: "Link", areas: [] }),
];
export const PUBLIC_BASIC_KEYS = ["id", "title", "url", "status", "overview", "startdate", "enddate"];
export const PUBLIC_EXTENDED_KEYS = [...PUBLIC_BASIC_KEYS, "department", "dept", "type", "type_string", "participation_url", "progress", "visibility"];
