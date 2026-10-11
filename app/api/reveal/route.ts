import { z } from "zod";
import { COST, createAiArk } from "@/lib/aiark";
import { bestEmail, toLead } from "@/lib/leads";
import { AccessError, resolveAccess } from "@/lib/keys";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

const Body = z.object({ id: z.string().uuid() });

/** Full profile + verified email for one lead. 1 credit if an email is found, 0 otherwise. */
export async function POST(req: Request) {
  try {
    const access = resolveAccess(req.headers);
    if (!access.limits.allowReveal) {
      throw new AccessError(403, "Revealing emails is off in the demo. Paste your own AI Ark key to reveal.");
    }
    const { id } = Body.parse(await req.json());
    const person = await createAiArk(access.aiarkKey).revealPerson(id);
    const email = bestEmail(person?.email?.output);
    if (!person || !email) return json({ found: false, spent: 0 });
    return json({ found: true, lead: { ...toLead(person, false), email }, spent: COST.emailFound });
  } catch (e) {
    return fail(e);
  }
}
