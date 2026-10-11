import { createAiArk } from "@/lib/aiark";
import { isSharedDemo, resolveAccess } from "@/lib/keys";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Free call. Hidden for the shared demo key so visitors don't see the owner's balance. */
export async function GET(req: Request) {
  try {
    if (isSharedDemo(req.headers)) return json({ credits: null });
    const access = resolveAccess(req.headers);
    return json({ credits: await createAiArk(access.aiarkKey).credits() });
  } catch (e) {
    return fail(e);
  }
}
