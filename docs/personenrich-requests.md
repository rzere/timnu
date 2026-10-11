# Timnu × PersonEnrich: feasibility and requests

_Checked against the public REST docs at https://www.personenrich.com/api-docs on 2026-10-11. Live calls without a key return `401 {"error":"Invalid or missing x-api-key","refusal_code":"bad_key"}`. No authenticated calls have been made yet._

## What Timnu needs to do

1. Ask the user a few questions: what they sell, who signs the check, and where those buyers are.
2. Turn the answers into an ICP: industries, company size, geographies, titles and seniority.
3. **Find companies** that match the ICP.
4. **Find people** at those companies who match the buyer persona.
5. **Score fit** with Jev. Jev returns typed `boolean`, `choice` and `score` answers, so we get a probability per lead and no text to parse.
6. Optionally reveal a verified work email for the leads the user picks.

## What already works (endpoint → step)

| Step | Endpoint | Status |
|---|---|---|
| Company lookup by name or domain | `POST /api/v1/search/companies` | ✅ works, but only when we already know the company (see gap 1) |
| Firmographics for scoring | `POST /api/v1/enrich/company` → `industry`, `employee_range`, `website` | ✅ |
| People at a known company | `POST /api/v1/company/employees` with `job_titles`, `locations`, `seniority` | ✅ this is the core of the account-based path |
| Full profile | `POST /api/v1/enrich` | ✅ |
| Verified email, paid only when found | `POST /api/v1/enrich` with `include_email: true` | ✅ |
| Signal-based discovery (people engaging with niche content) | `POST /api/v1/discover` → `POST /api/v1/engagers` | ✅ works today with no company list |
| Show cost before running | `GET /api/v1/balance` | ✅ |

**Verdict: an MVP is possible today**, with two pipelines:

- **Signal path, no company list needed.** ICP answers → niche keywords → `discover` → `engagers` → Jev scores each `headline` → `enrich` the top N → optional email. This is the most "Timnu points her cane" path, and every call it needs already exists.
- **Account path.** The user pastes target domains or company names, or we derive them from their customer list. Then `search/companies` → `enrich/company` (Jev scores firmographics) → `company/employees` filtered by title, location and seniority → Jev scores each person → `enrich` the top N.

What's missing is **open-ended discovery**: "find me Series A–C B2B SaaS companies in the US with 50–200 people" when the user has no list. Timnu can't do that with the current API.

## Requests for the PersonEnrich team (priority order)

### P0: blocks the core experience

1. **Company search by firmographics.** Add filters to `POST /api/v1/search/companies`, or add a new `POST /api/v1/search/companies/filter`, covering `industries[]`, `employee_ranges[]`, `locations[]` (HQ), `keywords` (description or specialties), and ideally `founded_after`, `funding_stage` and `hiring_for[]`. Today search only accepts `query` (name) and `domain`, and caps `limit` at 10. Without this, Timnu can't find companies the user hasn't already heard of, and that discovery is the product's main promise.
2. **People search across companies.** Add `POST /api/v1/search/people` with `job_titles[]`, `seniority[]`, `locations[]`, `industries[]`, `employee_ranges[]` and `keywords`. It's basically `company/employees` without the `company` requirement. That would make Timnu one search call plus a Jev scoring pass.
3. **Pagination.** Add a `cursor` / `next_cursor` on `company/employees` (max 100), `engagers` (max 500), `discover` (max 25) and any new search endpoints. Right now there's no way to get past the first page.
4. **Document the `seniority` codes.** The docs show `"300"` and `"310"` with no mapping. Please publish the full enum (e.g. `{ "300": "VP", "310": "CXO", … }`) or accept readable values like `"vp"` and `"director"`. Jev `choice` questions need a closed, known option set.

### P1: needed for a solid open-source and hosted product

5. **Structured person fields on `enrich`.** Return `current_title`, `current_company { name, linkedin_url, domain }`, `seniority`, and ideally `experience[]` (title, company, start/end) and `skills[]`. Today it returns `headline`, `company` and `location`. Scoring fit from the headline alone is noisy.
6. **Bulk enrich.** Add `POST /api/v1/enrich/bulk` taking up to 100 inputs, possibly async with a webhook or polling. Scoring 200 people means 200 sequential calls today.
7. **A published OpenAPI spec**, e.g. `/api/v1/openapi.json` (currently 404). We'd generate a typed TypeScript client from it, and so could every other open-source user.
8. **Documented errors and rate limits.** Publish the full `refusal_code` list (we've seen `bad_key`; we'd also expect `insufficient_credits`, `rate_limited`, `invalid_input` and `provider_error`), the HTTP status for each, `Retry-After` headers, and the per-key rate limits.
9. **Per-key spend caps.** Let a key have a `max_credits_per_day` and/or `max_credits_per_request`. That lets open-source users protect themselves from runaway loops, and lets us run the hosted demo on one key safely. A `dry_run: true` flag that returns the estimated cost would also help.
10. **Define `engagers[].signals[]`.** Document what values it can contain (reacted, commented, reposted, follower?). We'd weight these in scoring.

### P2: nice to have

11. **Lookalikes.** `POST /api/v1/search/companies/similar` with `{ domain }` returns companies similar to a customer. It's the fastest way to get from "who are your best customers?" to an ICP.
12. **Company signals.** Recent funding, headcount growth, open roles, and tech stack on `enrich/company`.
13. **An official TypeScript SDK** (`@personenrich/sdk`), or at least the OpenAPI spec so we can generate one.
14. **Attribution or partner param.** Something like an `x-client: timnu` header so you can see Timnu traffic, and maybe credit or referral for hosted signups.

## Note on Jev

Jev (TypeSafe AI, `typesafe-ai/jev`, also available through the Vercel AI Gateway at `POST https://ai-gateway.vercel.sh/v1/evaluate` and as `experimental_evaluate` in the `ai` SDK) is a **decision** model. It answers `boolean`, `choice` and `score` questions about a `state` string, and it does **not** generate text. That makes it a strong fit for ICP fit scoring and routing, but it can't write search keywords or title variants. Timnu will either:

- map the iPad answers onto closed taxonomies (industries, seniority, title families, regions) with Jev `choice` questions, which is another reason the request 4 enums matter, or
- use a small generative model through the same AI Gateway key for keyword expansion only.
