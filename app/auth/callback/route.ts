import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * GET /auth/callback
 * Handles the Supabase PKCE code exchange.
 * Supabase redirects here after email confirmation or OAuth sign-in
 * with a one-time `code` query param; this route exchanges it for a
 * session stored in cookies.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}/map`);
}
