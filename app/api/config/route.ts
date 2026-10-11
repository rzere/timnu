import { describeConfig } from "@/lib/keys";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  return json(describeConfig());
}
