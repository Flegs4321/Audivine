/**
 * Settings for sermon member-summary generation (feeds Word export).
 * Provider comes from `member_summary_provider` when set; otherwise legacy: Anthropic key wins.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SummaryGenerationProvider = "anthropic" | "openai";

export interface SummaryGenerationSettings {
  provider: SummaryGenerationProvider;
  /** Custom instructions (shared field); used for Claude too. */
  prompt: string | null;
  anthropic?: { apiKey: string; model: string };
  openai?: { apiKey: string; model: string };
}

/** Settings row from GET /api/settings (masked keys) or DB (raw keys). */
export type MemberSummarySettingsRow = {
  member_summary_provider?: string | null;
  openai_api_key?: string | null;
  anthropic_api_key?: string | null;
};

function openaiKeyConfigured(k: string | null | undefined): boolean {
  if (!k || typeof k !== "string") return false;
  const t = k.trim();
  if (t.includes("...")) return t.startsWith("sk-") || t.startsWith("sk_proj-");
  return t.length >= 20 && (t.startsWith("sk-") || t.startsWith("sk_proj-"));
}

function anthropicKeyConfigured(k: string | null | undefined): boolean {
  if (!k || typeof k !== "string") return false;
  const t = k.trim();
  if (t.includes("...")) return t.length > 12;
  return t.length >= 20;
}

/**
 * Resolves which provider will run member summaries, with key fallback.
 */
export function resolveEffectiveMemberSummaryProvider(
  s: MemberSummarySettingsRow | null | undefined
): SummaryGenerationProvider | null {
  if (!s) return null;
  const hasOpenai = openaiKeyConfigured(s.openai_api_key);
  const hasAnthropic = anthropicKeyConfigured(s.anthropic_api_key);
  const pref = s.member_summary_provider;

  if (pref === "openai") {
    if (hasOpenai) return "openai";
    if (hasAnthropic) return "anthropic";
    return null;
  }
  if (pref === "anthropic") {
    if (hasAnthropic) return "anthropic";
    if (hasOpenai) return "openai";
    return null;
  }
  if (hasAnthropic) return "anthropic";
  if (hasOpenai) return "openai";
  return null;
}

export async function getUserSummaryGenerationSettings(
  userId: string,
  authToken: string,
  supabaseFromCaller?: SupabaseClient
): Promise<SummaryGenerationSettings | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  try {
    const supabase =
      supabaseFromCaller ??
      createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${authToken}` } },
      });

    const { data: row, error } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("[summary-generation-settings] user_settings:", error.message, error.code);
      return null;
    }
    if (!row) {
      return null;
    }

    const anthropicKey = row.anthropic_api_key as string | null | undefined;
    const openaiKey = row.openai_api_key as string | null | undefined;
    const sharedPrompt = (row.openai_prompt as string | null | undefined) ?? null;

    const hasAnthropicKey = anthropicKey && String(anthropicKey).trim().length > 0;
    const hasOpenaiKey = openaiKey && String(openaiKey).trim().length > 0;

    const effective = resolveEffectiveMemberSummaryProvider({
      member_summary_provider: row.member_summary_provider as string | null,
      openai_api_key: openaiKey ?? null,
      anthropic_api_key: anthropicKey ?? null,
    });

    if (effective === "anthropic" && hasAnthropicKey) {
      return {
        provider: "anthropic",
        prompt: sharedPrompt,
        anthropic: {
          apiKey: String(anthropicKey).trim(),
          model: (row.claude_model as string)?.trim() || "claude-sonnet-4-20250514",
        },
        openai:
          hasOpenaiKey
            ? {
                apiKey: String(openaiKey).trim(),
                model: row.openai_model || "gpt-4o-mini",
              }
            : undefined,
      };
    }

    if (effective === "openai" && hasOpenaiKey) {
      return {
        provider: "openai",
        prompt: sharedPrompt,
        openai: {
          apiKey: String(openaiKey).trim(),
          model: row.openai_model || "gpt-4o-mini",
        },
      };
    }

    return null;
  } catch (e) {
    console.error("[summary-generation-settings]", e);
    return null;
  }
}
