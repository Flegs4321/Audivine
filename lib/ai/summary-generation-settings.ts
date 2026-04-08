/**
 * Settings for sermon member-summary generation (feeds Word export).
 * Prefers Anthropic Claude when anthropic_api_key is set; otherwise OpenAI.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SummaryGenerationProvider = "anthropic" | "openai";

export interface SummaryGenerationSettings {
  provider: SummaryGenerationProvider;
  /** Custom instructions (same field as “Custom OpenAI Prompt” in Settings); used for Claude too. */
  prompt: string | null;
  anthropic?: { apiKey: string; model: string };
  openai?: { apiKey: string; model: string };
}

export async function getUserSummaryGenerationSettings(
  userId: string,
  authToken: string,
  /** Prefer passing the caller’s authenticated client (e.g. API route after getUser). */
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

    if (anthropicKey && String(anthropicKey).trim().length > 0) {
      return {
        provider: "anthropic",
        prompt: sharedPrompt,
        anthropic: {
          apiKey: String(anthropicKey).trim(),
          model: (row.claude_model as string)?.trim() || "claude-sonnet-4-20250514",
        },
        openai:
          openaiKey && String(openaiKey).trim().length > 0
            ? {
                apiKey: String(openaiKey).trim(),
                model: row.openai_model || "gpt-4o-mini",
              }
            : undefined,
      };
    }

    if (openaiKey && String(openaiKey).trim().length > 0) {
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
