import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Create a dummy client if env vars are not set (for build time)
// This prevents build errors when env vars aren't configured
let supabase: SupabaseClient;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
  // Create a dummy client that will fail gracefully at runtime
  supabase = createClient(
    "https://placeholder.supabase.co",
    "placeholder-key"
  );
  if (typeof window !== "undefined") {
    console.warn(
      "Supabase environment variables are not set. Storage features will not work."
    );
  }
}

export { supabase };

