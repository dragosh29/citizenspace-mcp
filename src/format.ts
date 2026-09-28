// Turn Citizen Space records into compact objects an assistant can read quickly, withholding
// personal data unless it was asked for. Field names follow the JSON examples on the Data API
// "API specification" page and the field list on the Public API "Version 2.4 reference" page.

type Rec = Record<string, any>;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Phone-number-like sequences, a heuristic. Three shapes, digits optionally separated by a space, dot
// or hyphen:
//   international: "+" or "00", a 1-3 digit country code, an optional "(0)" trunk prefix, then 6-14
//     digits (+44 7700 900123, +447700900321, +44 (0)7700 900123, 0044 20 7946 0958);
//   bracketed UK area code: "(0...)" then 5-10 digits ((020) 7946 0958, (0117) 496 0000);
//   UK national: "0" then 8-10 more digits (07700 900789, 020 7946 0958, 07700.900123).
// Bounded by characters other than letters, digits, "_" and "-", so 32-character UIDs, response IDs
// such as ANON-1234-5678-C, numeric IDs and timestamps are left alone. Any other 9-11 digit string
// starting with 0 is redacted too; the raw text is available with include_contact_details.
const PHONE = /(?<![\w-])(?:(?:\+|00)[ .-]?[1-9]\d{0,2}(?:[ .-]?\(0\))?(?:[ .-]?\d){6,14}|\(0\d{0,4}\)(?:[ .-]?\d){5,10}|0(?:[ .-]?\d){8,10})(?![\w-])/g;
// UK postcodes (CF64 3DH, SW1A 1AA, M1 1AE, EC1A1BB, cf64 3dh): one or two letters, a digit, an
// optional letter or digit, an optional space, a digit and two letters, not touching other letters or
// digits, in either case. The last two letters exclude C, I, K, M, O and V, which real postcodes never
// use there; that also keeps "5pm", "3cm" and "2km" out. "B12 5th" still matches (TH is a real ending).
const POSTCODE = /(?<![A-Za-z0-9])[A-Za-z]{1,2}\d[A-Za-z\d]? ?\d[ABD-HJLNP-UW-Zabd-hjlnp-uw-z]{2}(?![A-Za-z0-9])/g;
// A date of birth: a date (dd/mm/yyyy, yyyy-mm-dd, "12 March 1985" or "12th Mar 1985") that follows
// "born", "DOB", "d.o.b.", "date of birth", "birth date" or "birthday" within a few characters. Other
// dates (consultation dates, "since 2019") are left alone.
const DOB = /\b(born|d\.?o\.?b\.?|date of birth|birth ?date|birthday)(?![A-Za-z])((?:[\s:=-]|on|is|was)*)(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?\s+\d{4})/gi;
// An NHS number: ten digits, usually written 3 3 4, whose last digit is the documented modulus-11 check
// digit. The check keeps arbitrary ten-digit numbers (which fail it ten times out of eleven) out.
const NHS = /(?<![\w-])\d{3}[ -]?\d{3}[ -]?\d{4}(?![\w-])/g;
const nhsCheckDigit = (digits: string): boolean => {
  const d = digits.split("").map(Number);
  const sum = d.slice(0, 9).reduce((acc, n, i) => acc + n * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return check !== 10 && check === d[9];
};
// A National Insurance number: two capitals, six digits, a final A to D, with or without spaces
// (QQ 12 34 56 C, QQ123456C). Any two capitals are accepted, not only the prefixes HMRC allocates.
const NI = /(?<![A-Za-z0-9])[A-Z]{2} ?\d{2} ?\d{2} ?\d{2} ?[A-D](?![A-Za-z0-9])/g;
// A payment card number: 13 to 19 digits, optionally in groups separated by spaces or hyphens, that
// pass the Luhn check (which one arbitrary digit string in ten also passes).
const CARD = /(?<![\w-])\d(?:[ -]?\d){12,18}(?![\w-])/g;
const luhn = (digits: string): boolean => {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) n = n > 4 ? n * 2 - 9 : n * 2;
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
};
const onlyDigits = (s: string) => s.replace(/\D/g, "");

const redactString = (text: string) =>
  text
    .replace(EMAIL, "[email redacted]")
    .replace(DOB, (_, word: string, gap: string) => `${word}${gap}[date of birth redacted]`)
    .replace(PHONE, "[phone redacted]")
    .replace(CARD, (m) => (luhn(onlyDigits(m)) ? "[card number redacted]" : m))
    .replace(NHS, (m) => (nhsCheckDigit(onlyDigits(m)) ? "[NHS number redacted]" : m))
    .replace(NI, "[NI number redacted]")
    .replace(POSTCODE, "[postcode redacted]");

/**
 * Replace email addresses, dates of birth, phone-number-like sequences, card numbers, NHS numbers,
 * National Insurance numbers and UK postcodes inside free text (titles, survey text, answers, error
 * messages) unless contact details were requested. A street address, a name, a health condition or
 * a date not introduced as a birth date is not caught by any pattern.
 */
export function redactContacts(text: unknown, includeContact: boolean): string | undefined {
  if (typeof text !== "string") return undefined;
  if (text === "") return undefined;
  return includeContact ? text : redactString(text);
}

// Key names that suggest contact details, personal identifiers or device data. The key is first
// normalised (camelCase split at each capital, then lower-cased: "dateOfBirth" -> "date_of_birth",
// "IPAddress" -> "ip_address") and the words are then matched between non-letters or the ends of the
// key ("contact_email", "__userinfo_ip", "postcode", "e_mail", "address1"), so "description", "title"
// and "hotel" are not caught. Used on records whose shape Delib does not document (users, workspaces,
// mailing list subscribers, activity detail) and on answer component ids.
const CONTACT_WORDS =
  /(^|[^a-z])(e_?mail|phone|telephone|tel|mobile|fax|address|postcode|post_?code|zip|dob|birth(day|date)?|ip|user_?agent|nhs|passport|national_insurance|ni_number|bank|iban|sort_?code|card|user_?name)([^a-z]|$)/;
const normaliseKey = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
export const isContactKey = (key: string): boolean => CONTACT_WORDS.test(normaliseKey(key));
// Answer labels are question text; "name" is added here because the standard respondent-management
// questions ask for it ("What is your name?"). A question about, say, a park's name is withheld by
// default too and available with include_contact_details. Signatures and usernames identify the
// respondent as a name does; demographic questions (age, ethnicity, disability) are not on this list
// because they are usually the equalities-monitoring part of the analysis itself.
const ANSWER_LABEL = /(^|[^a-z])(name|organi[sz]ation|e-?mail|phone|telephone|mobile|address|postcode|post ?code|date of birth|birth ?date|birthday|d\.?o\.?b\.?|nhs|national insurance|ni number|passport|signature|username|user name)([^a-z]|$)/i;
// Component ids of the standard respondent-management and userinfo answers in the documented
// examples: "opsuite.respondentmanagement.name_subquestion", "quickconsult.email_subquestion",
// "__userinfo_ip", "__userinfo_useragent".
const IDENTITY_COMPONENT = /^(opsuite\.respondentmanagement\.|quickconsult\.email|__userinfo_ip|__userinfo_useragent)/;

const MAX_DEPTH = 20;

/**
 * Generic treatment for a record whose shape is not documented: every key that looks like a contact
 * or identity field is withheld (its path is listed in `withheld`), every string is redacted, nested
 * objects and arrays are walked to MAX_DEPTH. With includeContact the value is returned as stored.
 */
export function redactRecord(value: unknown, includeContact: boolean): { value: unknown; withheld: string[] } {
  const withheld: string[] = [];
  const walk = (v: unknown, path: string, depth: number): unknown => {
    if (includeContact) return v;
    if (typeof v === "string") return redactString(v);
    if (Array.isArray(v)) {
      if (depth >= MAX_DEPTH) return `[nested deeper than ${MAX_DEPTH} levels omitted; available with include_contact_details]`;
      return v.map((x, i) => walk(x, `${path}[${i}]`, depth + 1));
    }
    if (v && typeof v === "object") {
      if (depth >= MAX_DEPTH) return `[nested deeper than ${MAX_DEPTH} levels omitted; available with include_contact_details]`;
      const out: Rec = {};
      for (const [k, x] of Object.entries(v as Rec)) {
        const p = path ? `${path}.${k}` : k;
        if (isContactKey(k)) {
          withheld.push(p);
          continue;
        }
        out[redactString(k)] = walk(x, p, depth + 1);
      }
      return out;
    }
    return v;
  };
  return { value: walk(value, "", 0), withheld };
}

const str = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
const num = (v: unknown) => {
  const n = Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(n) ? undefined : n;
};

// GET /api/1/activities record: uid, title, state, start_date, end_date, path (documented example).
export function activity(a: Rec, includeContact: boolean) {
  return {
    uid: str(a.uid),
    title: redactContacts(a.title, includeContact),
    state: str(a.state),
    start_date: str(a.start_date),
    end_date: str(a.end_date),
    path: redactContacts(a.path, includeContact),
  };
}

// GET /api/1/activities/{uid}/survey (documented example).
export function survey(s: Rec, includeContact: boolean) {
  return {
    link_text: redactContacts(s.link_text, includeContact),
    question_numbering: str(s.question_numbering),
    linear: bool(s.linear),
    has_skip_logic: bool(s.has_skip_logic),
    body: redactContacts(s.body, includeContact),
    factbank_heading: redactContacts(s.factbank_heading, includeContact),
    factbank: redactContacts(s.factbank, includeContact),
    thankyou_message: redactContacts(s.thankyou_message, includeContact),
    email_thankyou_message: redactContacts(s.email_thankyou_message, includeContact),
  };
}

// GET /api/1/activities/{uid}/pages (documented example).
export function page(p: Rec, includeContact: boolean) {
  return {
    id: str(p.id),
    title: redactContacts(p.title, includeContact),
    type: str(p.type),
    body: redactContacts(p.body, includeContact),
    factbank_heading: redactContacts(p.factbank_heading, includeContact),
    factbank: redactContacts(p.factbank, includeContact),
    skip_logic_rules: Array.isArray(p.skip_logic_rules) ? (redactRecord(p.skip_logic_rules, includeContact).value as unknown[]) : undefined,
  };
}

// GET /api/1/activities/{uid}/questions (documented example).
export function question(q: Rec, includeContact: boolean) {
  return {
    id: str(q.id),
    page_id: str(q.page_id),
    number: str(q.number),
    title: redactContacts(q.title, includeContact),
    analyst_only: bool(q.analyst_only),
  };
}

// GET /api/1/activities/{uid}/components (documented examples: one with validation_options, one
// with character_limit).
export function component(c: Rec, includeContact: boolean) {
  return {
    id: str(c.id),
    question_id: str(c.question_id),
    page_id: str(c.page_id),
    type: str(c.type),
    label: redactContacts(c.label, includeContact),
    heading: redactContacts(c.heading, includeContact),
    required: bool(c.required),
    visibility: Array.isArray(c.visibility) ? c.visibility.map(String) : undefined,
    validation_options: Array.isArray(c.validation_options) ? (redactRecord(c.validation_options, includeContact).value as unknown[]) : undefined,
    character_limit: num(c.character_limit),
  };
}

/** Split a documented answer key "Label (component_id)" into its parts. */
export function parseAnswerKey(key: string): { label: string; component_id?: string } {
  const m = /^(.*?)\s*\(([^()]+)\)$/.exec(key);
  return m ? { label: m[1], component_id: m[2] } : { label: key };
}

function identifiesRespondent(key: string): boolean {
  const { label, component_id } = parseAnswerKey(key);
  return (component_id !== undefined && IDENTITY_COMPONENT.test(component_id)) || ANSWER_LABEL.test(label) || (component_id !== undefined && isContactKey(component_id));
}

// GET /api/1/activities/{uid}/responses/{id} and each item of responses_batched (documented
// example): id, completed, deleted, answers {"Label (component_id)": string | [string]}.
// Respondent personal data is withheld by default: the standard respondent-management, email and
// userinfo answers and any answer whose label asks for a name, organisation, email, phone, address,
// postcode or date of birth are left out (their keys are listed in withheld_answers), and the
// remaining answers go through the email/phone/postcode redaction. A free-text answer can still
// carry personal data that no pattern catches; include_contact_details returns everything as stored.
export function response(r: Rec, includeContact: boolean) {
  const answers: Rec = {};
  const withheld: string[] = [];
  if (r.answers && typeof r.answers === "object") {
    for (const [k, v] of Object.entries(r.answers as Rec)) {
      if (!includeContact && identifiesRespondent(k)) {
        withheld.push(k);
        continue;
      }
      answers[k] = redactRecord(v, includeContact).value;
    }
  }
  return {
    id: str(r.id),
    completed: bool(r.completed),
    deleted: bool(r.deleted),
    answers,
    ...(withheld.length ? { withheld_answers: withheld } : {}),
  };
}

// Public API v2.4 record (json_search_results and json_consultation_details). Field names and tiers
// from the reference page: basic (id, title, url, status, overview, startdate, enddate), extended
// (department, dept, type, type_string, participation_url, progress, visibility) and all (why,
// what_happens_next, feedbackdate, resultsdate, contact_*, related_links, related_consultations,
// supporting_documents, audiences, areas, interests). On demo.citizenspace.com (one unauthenticated
// request on 28 September 2026) the extended tier spelled two of them participate_url and
// resultdate; both spellings are read.
// Names of audiences, areas and interests, and every URL, go through the same text redaction as any
// other string; ids (slugs) do not.
const idName = (x: unknown, includeContact: boolean) => (x && typeof x === "object" ? { id: str((x as Rec).id), name: redactContacts((x as Rec).name, includeContact) } : undefined);
const link = (x: unknown, includeContact: boolean) => (x && typeof x === "object" ? { url: redactContacts((x as Rec).url, includeContact), title: redactContacts((x as Rec).title, includeContact) } : undefined);
const list = <T>(v: unknown, f: (x: unknown) => T) => (Array.isArray(v) ? v.map(f).filter((x) => x !== undefined) : undefined);

export function publicActivity(a: Rec, includeContact: boolean) {
  const out: Rec = {
    id: str(a.id),
    title: redactContacts(a.title, includeContact),
    url: redactContacts(a.url, includeContact),
    status: str(a.status),
    overview: redactContacts(a.overview, includeContact),
    startdate: str(a.startdate),
    enddate: str(a.enddate),
    // extended
    department: redactContacts(a.department, includeContact),
    dept: str(a.dept),
    type: str(a.type),
    type_string: str(a.type_string),
    participation_url: redactContacts(a.participation_url ?? a.participate_url, includeContact),
    progress: str(a.progress),
    visibility: str(a.visibility),
    // all
    why: redactContacts(a.why, includeContact),
    what_happens_next: redactContacts(a.what_happens_next, includeContact),
    feedbackdate: str(a.feedbackdate),
    resultsdate: str(a.resultsdate ?? a.resultdate),
    contact_name: redactContacts(a.contact_name, includeContact),
    contact_jobtitle: redactContacts(a.contact_jobtitle, includeContact),
    contact_team: redactContacts(a.contact_team, includeContact),
    ...(includeContact ? { contact_phone: str(a.contact_phone), contact_email: str(a.contact_email) } : {}),
    related_links: list(a.related_links, (x) => link(x, includeContact)),
    related_consultations: list(a.related_consultations, (x) => link(x, includeContact)),
    supporting_documents: list(a.supporting_documents, (x) => (x && typeof x === "object" ? { ...link(x, includeContact), size: str((x as Rec).size) } : undefined)),
    audiences: list(a.audiences, (x) => idName(x, includeContact)),
    areas: list(a.areas, (x) => idName(x, includeContact)),
    interests: list(a.interests, (x) => idName(x, includeContact)),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}
