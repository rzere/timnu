import { z } from "zod";
import { AiArkError, COST, createAiArk, type AiArk } from "@/lib/aiark";
import { IcpSchema, toAccountFilters, toPeopleFilters } from "@/lib/icp";
import { bestEmail, toLead, type Lead } from "@/lib/leads";
import { mapLimit, scoreLeads } from "@/lib/score";
import { AccessError, resolveAccess } from "@/lib/keys";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 25;
const LOOKALIKE_COMPANIES = 50;

const Body = z.object({
  icp: IcpSchema,
  page: z.number().int().min(0).max(399).default(0),
  /** Full names + LinkedIn via People Search (0.5 credits/person) instead of the masked 1-credit preview. */
  unmask: z.boolean().default(false),
  /** Lookalike account IDs from page 0, so later pages don't pay for the company search again. */
  companyIds: z.array(z.string().uuid()).max(300).optional(),
});

export async function POST(req: Request) {
  try {
    const access = resolveAccess(req.headers);
    const { icp, page, unmask, companyIds: givenIds } = Body.parse(await req.json());
    const notices: string[] = [];

    if (page >= access.limits.maxPages) {
      throw new AccessError(403, `The demo shows the first ${access.limits.maxPages} pages. Paste your own AI Ark key for more.`);
    }
    if (unmask && !access.limits.allowReveal) {
      throw new AccessError(403, "Unmasking is off in the demo. Paste your own AI Ark key to unmask names.");
    }

    const aiark = createAiArk(access.aiarkKey);
    let spent = 0;

    let companyIds = givenIds ?? [];
    if (icp.lookalikes.length && !givenIds) {
      if (!access.limits.allowLookalikes) {
        notices.push("Lookalike search is off in the demo, so Timnu ignored your customer domains.");
      } else {
        const companies = await aiark.lookalikeCompanies(icp.lookalikes, toAccountFilters(icp), LOOKALIKE_COMPANIES);
        spent += companies.content.length * COST.companyPerResult;
        companyIds = companies.content.map((c) => c.id);
        if (!companyIds.length) {
          return json({ total: 0, page, totalPages: 0, leads: [], companyIds, spent, jev: false, notices: ["Timnu found no companies like your customers with those filters."] });
        }
        notices.push(`Searching ${companyIds.length} companies that look like ${icp.lookalikes.join(", ")}.`);
      }
    }

    const filters = toPeopleFilters(icp, companyIds);
    const result = unmask
      ? await aiark.searchPeople(filters, page, PAGE_SIZE)
      : await aiark.previewPeople(filters, page, PAGE_SIZE);
    spent += unmask ? result.content.length * COST.searchPerPerson : result.content.length ? COST.previewPage : 0;

    const { leads, jevError } = await scoreLeads(
      icp,
      result.content.map((p) => toLead(p, !unmask)),
      access.jevKey,
    );
    if (jevError) notices.push(`Jev scoring was unavailable (${jevError}), so Timnu used her built-in score.`);

    // A lead is someone you can contact: reveal the best-ranked ones (name, LinkedIn, verified email).
    const revealed = await revealTop(aiark, leads, access.limits.autoReveal);
    spent += revealed.found * COST.emailFound;
    if (revealed.problem) notices.push(revealed.problem);
    // Contactable leads first, then by fit.
    leads.sort((a, b) => Number(!!b.email) - Number(!!a.email) || b.fit.score - a.fit.score);

    return json({
      total: result.totalElements,
      page,
      totalPages: Math.min(result.totalPages, access.limits.maxPages === Infinity ? 400 : access.limits.maxPages),
      leads,
      companyIds,
      spent,
      jev: !!access.jevKey && !jevError,
      demo: access.demo,
      contactable: revealed.found,
      notices,
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Looks up the top `n` leads with Export Single Person: full profile + verified email,
 * 1 credit per email found and nothing when none is. Mutates the leads in place.
 */
async function revealTop(aiark: AiArk, leads: Lead[], n: number) {
  let found = 0;
  let problem: string | undefined;
  let stop = false;
  // AI Ark allows ~5 requests/second per key, so keep a few in flight.
  await mapLimit(leads.slice(0, n), 3, async (lead) => {
    if (stop) return;
    try {
      const person = await aiark.revealPerson(lead.id);
      const email = bestEmail(person?.email?.output);
      if (person && email) {
        Object.assign(lead, toLead(person, false), { email });
        found++;
      } else {
        lead.email = null;
      }
    } catch (e) {
      if (e instanceof AiArkError && (e.status === 402 || e.status === 401)) stop = true;
      problem ??= `Some contacts couldn't be revealed: ${e instanceof Error ? e.message : String(e)}`;
    }
  });
  return { found, problem };
}
