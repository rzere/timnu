import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AiArkError } from "./aiark";
import { AccessError } from "./keys";

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

/** Turns known errors into user-facing JSON. Never echoes keys or raw upstream bodies. */
export function fail(e: unknown) {
  if (e instanceof AccessError || e instanceof AiArkError) return json({ error: e.message }, e.status);
  if (e instanceof ZodError) {
    const first = e.issues[0];
    return json({ error: `${first.path.join(".") || "input"}: ${first.message}` }, 400);
  }
  console.error("[timnu]", e instanceof Error ? e.message : e);
  return json({ error: "Something went wrong consulting the oracle." }, 500);
}
