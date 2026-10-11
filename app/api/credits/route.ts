import { createAiArk } from "@/lib/aiark";
import { resolveAccess } from "@/lib/keys";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Free call. Hidden for the shared demo key so visitors don't see the owner's balance. */
export async function GET(req: Request) {
  try {
    const access = resolveAccess(req.headers);
    if (access.demo) return json({ credits: null });
    return json({ credits: await createAiArk(access.aiarkKey).credits() });
  } catch (e) {
    return fail(e);
  }
}
