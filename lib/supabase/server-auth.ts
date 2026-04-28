/**
 * Shared helper for server route handlers: authenticates the request from the
 * Bearer token and returns a Supabase client scoped to that user (so RLS works).
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export interface AuthedSupabase {
  supabase: SupabaseClient;
  user: { id: string; email?: string | null };
  token: string;
}

export async function authenticate(
  request: NextRequest
): Promise<AuthedSupabase | NextResponse> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  if (!token) {
    return NextResponse.json(
      { error: "Unauthorized", message: "You must be logged in" },
      { status: 401 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Server configuration error", message: "Supabase not configured" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json(
      { error: "Unauthorized", message: "You must be logged in" },
      { status: 401 }
    );
  }

  return {
    supabase,
    user: { id: user.id, email: user.email },
    token,
  };
}

export function isErrorResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}
