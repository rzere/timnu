# timnu

> seo is dead.
> social is dead.
> cold email is dead.
>
> the only reliable channel is kayaking to a desert island and consulting Timnu, the oracle of recurring revenue, for a direction to find leads in. Timnu will slowly point her cane in the right direction, then reveal an iPad with a screen that's just going to ask you a few questions
>
> — [@james406](https://x.com/james406/status/2108965943732756712)

**Timnu is an open-source, AI-based ICP lead finder.** Answer a few questions, Timnu points her cane, and you get leads that fit, ranked by fit, with verified emails on demand.

- `/` is the animated teaser that retells the tweet.
- `/oracle` is the lead finder.

## Quickstart (bring your own key)

You need Node 20+ and an [AI Ark](https://ai-ark.com) API key. Free accounts get 100 credits a month; create a key in the [API dashboard](https://app.ai-ark.com/settings/api-management/dashboard).

```bash
git clone https://github.com/rzere/timnu && cd timnu
npm install
cp .env.example .env.local   # then set AIARK_API_KEY
npm run dev                  # http://localhost:3000/oracle
```

Your key lives in `.env.local`, which is git-ignored. Never commit it.

## How it works

1. **The questions:** what you sell, who signs the check (titles and seniority), what kind of companies, how big, and where. Optionally, up to 5 of your best customers' domains.
2. **Consult:** Timnu turns the answers into AI Ark filters and runs a **People Preview**: 25 matching people for 1 credit, with last names masked. If you gave customer domains, she first runs a **lookalike company search** and only looks at people in those companies.
3. **Rank:** every lead gets a fit score. With a [TypeSafe](https://docs.typesafe.ai/introduction) API key, Jev answers three yes/no questions per lead (is this person a buyer for your offer, would their company need it, do they match your profile) and Timnu weights them 50/30/20 into one fit score. Without a key, a free built-in score compares titles, seniority, company size and industry.
4. **Reveal what's worth it:** reveal one lead's full profile and verified email (1 credit, only if an email is found), or unmask the whole page's names and LinkedIn URLs (0.5 credits per person). Download the page as CSV.

| Action | AI Ark credits |
|---|---|
| Consult / next page (25 people, names masked) | 1 |
| Lookalike search (50 companies, first page only) | up to 5 |
| Reveal email for one lead | 1 if found, 0 if not |
| Unmask a page (25 people) | 12.5 |

Costs are AI Ark's published prices; check [their docs](https://docs.ai-ark.com) for changes. AI Ark emails are verified in real time before they're returned.

## Configuration

| Variable | Required | What it does |
|---|---|---|
| `AIARK_API_KEY` | yes* | Your AI Ark key. *Or leave it unset and paste a key in the app's **Keys** panel. |
| `TYPESAFE_API_KEY` | no | [TypeSafe](https://console.typesafe.ai/keys) key for Jev fit scoring. Falls back to the built-in score. `AI_GATEWAY_API_KEY` is also read as a legacy name for the same key. |
| `TIMNU_DEMO` | no | `1` for a public deployment running on a shared key: caps what anonymous visitors can spend. |
| `TIMNU_DEMO_MAX_PAGES` | no | Pages per search in demo mode (default `2`). |
| `TIMNU_DEMO_ALLOW_REVEAL` | no | `1` to allow email reveal and unmasking in demo mode (default off). |
| `TIMNU_DEMO_ALLOW_LOOKALIKES` | no | `1` to allow lookalike search in demo mode (default off). |
| `TIMNU_DEMO_REQUESTS_PER_HOUR` | no | Per-IP request limit in demo mode (default `10`). |

### Keys and privacy

- Keys stay on the server. The browser never sees `AIARK_API_KEY` or `TYPESAFE_API_KEY`.
- A visitor can paste their own key in the app. It's sent to this app's API routes with each request, used for that call, and never stored on the server. It's saved in the browser only if they tick "Remember on this device".
- A request that uses a visitor's own key is never capped by demo mode.
- The API routes don't proxy arbitrary AI Ark calls. They build the filters themselves from validated answers.

### Hosting a public demo

Deploy to Vercel (or any Node host), then set `AIARK_API_KEY` to the demo key and `TIMNU_DEMO=1`. The built-in per-IP limiter is best-effort, because serverless instances don't share memory, so add a rate-limit rule on your host too (for example, a Vercel Firewall rule on `/api/*`).

## Development

```bash
npm test           # unit tests (filters, scoring, key handling)
npm run typecheck
npm run build
```

`lib/icp.ts` maps answers to filters, `lib/aiark.ts` is the AI Ark client, `lib/score.ts` holds the Jev and built-in scoring, `lib/keys.ts` handles key resolution and demo limits, and `app/oracle/page.tsx` is the UI.

## License

MIT
