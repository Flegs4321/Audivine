/**
 * Helper functions to get user OpenAI settings
 * Returns null if user hasn't configured their own API key (does NOT fall back to environment variables)
 */

import { createClient } from "@supabase/supabase-js";

export interface UserOpenAISettings {
  apiKey: string;
  /** OpenAI model used for member summaries. */
  model: string;
  /** OpenAI model used for transcription endpoints. */
  transcriptionModel: string;
  prompt?: string | null;
}

/**
 * Get user's OpenAI settings from their user_settings
 * Returns null if user hasn't configured their own API key (does NOT use environment variables)
 * This ensures users must provide their own API key to use OpenAI features
 */
export async function getUserOpenAISettings(
  userId: string,
  authToken: string
): Promise<UserOpenAISettings | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${authToken}` } },
    });

    const { data: userSettings, error } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("[getUserOpenAISettings]", error.message);
      return null;
    }

    if (userSettings?.openai_api_key && String(userSettings.openai_api_key).trim().length > 0) {
      return {
        apiKey: String(userSettings.openai_api_key).trim(),
        model: userSettings.member_summary_openai_model || userSettings.openai_model || "gpt-4o-mini",
        transcriptionModel: userSettings.transcription_openai_model || "whisper-1",
        prompt: userSettings.openai_prompt || null,
      };
    }
  } catch (error) {
    console.error("Error fetching user OpenAI settings:", error);
  }

  // Return null if user hasn't configured their own API key
  return null;
}

