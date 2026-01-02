/**
 * Helper functions to get user OpenAI settings
 * Returns null if user hasn't configured their own API key (does NOT fall back to environment variables)
 */

import { createClient } from "@supabase/supabase-js";

export interface UserOpenAISettings {
  apiKey: string;
  model: string;
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
    // Fetch user settings using PostgREST API
    const fetchUrl = `${supabaseUrl}/rest/v1/user_settings?user_id=eq.${userId}&select=openai_api_key,openai_model,openai_prompt`;
    const fetchResponse = await fetch(fetchUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
        apikey: supabaseAnonKey,
        "Content-Type": "application/json",
      },
    });

    if (fetchResponse.ok) {
      const settings = await fetchResponse.json();
      const userSettings = Array.isArray(settings) && settings.length > 0 ? settings[0] : null;

      // Only return settings if user has configured their own API key
      if (userSettings?.openai_api_key) {
        return {
          apiKey: userSettings.openai_api_key,
          model: userSettings.openai_model || "gpt-4o-mini",
          prompt: userSettings.openai_prompt || null,
        };
      }
    }
  } catch (error) {
    console.error("Error fetching user OpenAI settings:", error);
  }

  // Return null if user hasn't configured their own API key
  return null;
}

