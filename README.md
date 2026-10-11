# timnu

> seo is dead.
> social is dead.
> cold email is dead.
>
> the only reliable channel is kayaking to a desert island and consulting Timnu, the oracle of recurring revenue, for a direction to find leads in. Timnu will slowly point her cane in the right direction, then reveal an iPad with a screen that's just going to ask you a few questions
>
> — [@james406](https://x.com/james406/status/2108965943732756712)

**Timnu is an open-source, AI-based ICP lead finder.** Answer a few questions, Timnu points her cane, and you get leads that fit.

## Status

🌴 **Coming very soon.** Right now this repo holds the teaser: an animated retelling of the tweet in `index.html`.

### Deploy the teaser

It's a single static file with no build step.

- **Vercel:** `npx vercel --prod` from the repo root, or import the repo and use the default settings.
- **Netlify / Cloudflare Pages / GitHub Pages:** publish the repo root.
- **Local:** open `index.html` in a browser.

There's a **Skip** button, a **Replay** button, and the page respects `prefers-reduced-motion` by going straight to the final card.

## The plan

```
iPad questions ──► ICP (Jev choice) ──► find companies / people (PersonEnrich)
                                             │
                     leads ◄── Jev fit score ◄┘ ──► verified email (optional)
```

- **Language:** TypeScript.
- **Reasoning:** [Jev](https://vercel.com/changelog/ai-gateway-now-supports-typesafe-clients-and-http-api-for-jev), a typed decision model. It gives a fit probability per lead and never generates text, so there's no prompt-parsing.
- **Data:** the [PersonEnrich](https://www.personenrich.com/api-docs) API, a LeadShark project.
- **Keys:**
  - Open source: bring your own `AI_GATEWAY_API_KEY` (Jev) and `PERSONENRICH_API_KEY`.
  - Hosted version: works out of the box.

The API feasibility notes and requests to the PersonEnrich team are in [`docs/personenrich-requests.md`](docs/personenrich-requests.md).

## License

MIT
