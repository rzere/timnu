import { z } from "zod";
import { COST, createAiArk } from "@/lib/aiark";
import { IcpSchema, toAccountFilters, toPeopleFilters } from "@/lib/icp";
import { toLead } from "@/lib/leads";
import { scoreLeads } from "@/lib/score";
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
      access.gatewayKey,
    );
    if (jevError) notices.push(`Jev scoring was unavailable (${jevError}), so Timnu used her built-in score.`);

    return json({
      total: result.totalElements,
      page,
      totalPages: Math.min(result.totalPages, access.limits.maxPages === Infinity ? 400 : access.limits.maxPages),
      leads,
      companyIds,
      spent,
      jev: !!access.gatewayKey && !jevError,
      demo: access.demo,
      notices,
    });
  } catch (e) {
    return fail(e);
  }
}
