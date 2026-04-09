/**
 * API route for user-specific bulletin template status/removal.
 * GET /api/settings/bulletin-template
 * DELETE /api/settings/bulletin-template
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function templatePathForUser(userId: string): string {
  return `bulletin-templates/${userId}/template.docx`;
}

async function getAuthedClients(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  if (!token) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) return null;

  const storageKey = supabaseServiceRoleKey || supabaseAnonKey;
  const storageClient = createClient(supabaseUrl, storageKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(supabaseServiceRoleKey ? {} : { global: { headers: { Authorization: `Bearer ${token}` } } }),
  });

  return { user, storageClient };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthedClients(request);
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const path = templatePathForUser(ctx.user.id);
    const { data, error } = await ctx.storageClient.storage.from("Audivine").download(path);
    if (error || !data) {
      return NextResponse.json({ exists: false });
    }
    return NextResponse.json({ exists: true, path });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to check template", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getAuthedClients(request);
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const path = templatePathForUser(ctx.user.id);
    const { error } = await ctx.storageClient.storage.from("Audivine").remove([path]);
    if (error) {
      return NextResponse.json({ error: "Failed to remove template", message: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to remove template", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

