/**
 * POST /api/bulletin/from-summary
 * Builds bulletin-final/template/template.docx from the member summary text (no second AI call).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { memberSummaryToBulletinJson } from "@/lib/bulletin/member-summary-to-bulletin-json";
import { buildBulletinDocxBuffer } from "@/lib/bulletin/build-bulletin-docx";

export const runtime = "nodejs";

function getCloudTemplatePathForUser(userId: string): string {
  return `bulletin-templates/${userId}/template.docx`;
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const summary = typeof body?.summary === "string" ? body.summary : "";

    if (!summary.trim()) {
      return NextResponse.json(
        { error: "Missing summary", message: "Provide { \"summary\": \"...\" } in the body." },
        { status: 400 }
      );
    }

    const bulletin = memberSummaryToBulletinJson(summary);

    // Prefer user-uploaded cloud template; fall back to repo template for local/dev compatibility.
    let cloudTemplateBuffer: Buffer | undefined;
    try {
      const path = getCloudTemplatePathForUser(user.id);
      const { data: templateBlob, error: dlErr } = await supabase.storage
        .from("Audivine")
        .download(path);
      if (!dlErr && templateBlob) {
        cloudTemplateBuffer = Buffer.from(await templateBlob.arrayBuffer());
      }
    } catch {
      // Ignore and fall back to local template file.
    }

    const buffer = buildBulletinDocxBuffer(bulletin, cloudTemplateBuffer);
    const safeDate = (bulletin.date || "undated").replace(/\./g, "-");
    const filename = `SundayBulletin_${safeDate}.docx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[bulletin/from-summary]", err);
    const message = err instanceof Error ? err.message : "Failed to build bulletin";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
