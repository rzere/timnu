import { z } from "zod";
import { AiArkError, COST, createAiArk } from "@/lib/aiark";
import { bestEmail, toLead } from "@/lib/leads";
import { mapLimit } from "@/lib/score";
import { resolveAccess } from "@/lib/keys";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  /** Lead ids from a consult, best fit first, that haven't been looked up yet. */
  ids: z.array(z.string().uuid()).max(25),
  /** Stars to cash in (the game sends one per star as it's collected), capped by the reveal budget. */
  stars: z.number().int().min(0).max(25),
});

/**
 * Turns stars into contacts. Walks the ranked ids and reveals each with Export Single Person
 * (full name, LinkedIn, verified email) until it has one contact per star. AI Ark charges
 * 1 credit per email found and nothing for misses, so a miss just moves on to the next lead.
 */
export async function POST(req: Request) {
  try {
    const access = resolveAccess(req.headers, process.env, "unlock");
    const { ids, stars } = Body.parse(await req.json());
    const want = Math.min(stars, access.limits.autoReveal);
    const aiark = createAiArk(access.aiarkKey);

    const leads: Array<ReturnType<typeof toLead> & { email: NonNullable<ReturnType<typeof bestEmail>> }> = [];
    const noEmail: string[] = [];
    let problem: string | undefined;
    let cursor = 0;
    // Reveal in small waves (AI Ark allows ~5 requests/second) until we have enough, or run out.
    while (leads.length < want && cursor < ids.length && !problem) {
      const wave = ids.slice(cursor, cursor + Math.min(3, want - leads.length));
      cursor += wave.length;
      await mapLimit(wave, 3, async (id) => {
        try {
          const person = await aiark.revealPerson(id);
          const email = bestEmail(person?.email?.output);
          if (person && email && leads.length < want) leads.push({ ...toLead(person, false), email });
          else if (!email) noEmail.push(id);
        } catch (e) {
          problem ??= e instanceof AiArkError ? e.message : "Some contacts couldn't be revealed.";
        }
      });
    }

    return json({ leads, noEmail, spent: leads.length * COST.emailFound, ...(problem && { notice: problem }) });
  } catch (e) {
    return fail(e);
  }
}
