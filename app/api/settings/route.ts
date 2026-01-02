/**
 * API route for user settings
 * GET /api/settings - Get user settings (user-specific, RLS enforced)
 * PUT /api/settings - Update user settings (user-specific, RLS enforced)
 * 
 * All settings are user-specific. Each user can only access and modify their own settings.
 * RLS policies ensure users cannot access other users' settings.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    
    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to view settings" },
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
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to view settings" },
        { status: 401 }
      );
    }
    
    // Fetch settings using PostgREST API (more reliable for RLS)
    // RLS policy ensures users can only read their own settings (auth.uid() = user_id)
    const fetchUrl = `${supabaseUrl}/rest/v1/user_settings?user_id=eq.${user.id}&select=*`;
    const fetchResponse = await fetch(fetchUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnonKey,
        'Content-Type': 'application/json',
      },
    });
    
    if (!fetchResponse.ok) {
      // Check if it's a "table doesn't exist" error
      if (fetchResponse.status === 404) {
        const errorText = await fetchResponse.text();
        if (errorText.includes("does not exist") || errorText.includes("42P01")) {
          console.error("[SETTINGS] Table user_settings does not exist. Please apply migration 009_create_user_settings_table.sql");
          return NextResponse.json(
            { 
              error: "Database migration required", 
              message: "The user_settings table does not exist. Please apply the migration: supabase/migrations/009_create_user_settings_table.sql" 
            },
            { status: 500 }
          );
        }
        // 404 might also mean no settings exist yet - that's okay
        return NextResponse.json({ settings: null });
      }
      
      const errorText = await fetchResponse.text();
      console.error("[SETTINGS] Error fetching settings:", errorText);
      return NextResponse.json(
        { 
          error: "Failed to fetch settings", 
          message: errorText
        },
        { status: fetchResponse.status }
      );
    }
    
    const settings = await fetchResponse.json();
    const userSettings = Array.isArray(settings) && settings.length > 0 ? settings[0] : null;
    
    if (!userSettings) {
      // Settings don't exist yet - return null (not an error)
      return NextResponse.json({ settings: null });
    }
    
    // Mask API key in response for security (show first 7 chars and last 4 chars)
    const maskedSettings = { ...userSettings };
    if (maskedSettings.openai_api_key) {
      const key = maskedSettings.openai_api_key;
      // Log original key length for debugging
      console.log("[SETTINGS] Masking API key, original length:", key.length);
      maskedSettings.openai_api_key = key.substring(0, 7) + "..." + key.substring(key.length - 4);
    }
    
    return NextResponse.json({ settings: maskedSettings });
  } catch (error) {
    console.error("Get settings API error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch settings",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    
    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to update settings" },
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
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to update settings" },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { church_logo_url, church_name, openai_api_key, openai_model, transcription_method, openai_prompt } = body;
    
    // CRITICAL: Always set user_id to the authenticated user's ID
    // This ensures settings are always user-specific and prevents any tampering
    // RLS policies will also enforce this, but explicit setting is an extra security layer
    const updateData: any = { user_id: user.id };
    if (church_logo_url !== undefined) updateData.church_logo_url = church_logo_url;
    if (church_name !== undefined) updateData.church_name = church_name;
    // Only update API key if it's provided and not masked (doesn't contain "...")
    if (openai_api_key !== undefined && openai_api_key && !openai_api_key.includes("...")) {
      // Log for debugging (don't log the full key, just length and prefix)
      console.log("[SETTINGS] Saving API key, length:", openai_api_key.length, "starts with:", openai_api_key.substring(0, 7));
      updateData.openai_api_key = openai_api_key;
    }
    if (openai_model !== undefined) updateData.openai_model = openai_model;
    if (transcription_method !== undefined) updateData.transcription_method = transcription_method;
    if (openai_prompt !== undefined) {
      // Truncate to 1000 characters if longer
      updateData.openai_prompt = openai_prompt && openai_prompt.length > 0 
        ? openai_prompt.substring(0, 1000).trim() 
        : null;
    }
    
    // Check if settings exist using PostgREST API (more reliable for RLS)
    const checkUrl = `${supabaseUrl}/rest/v1/user_settings?user_id=eq.${user.id}&select=id`;
    const checkResponse = await fetch(checkUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnonKey,
        'Content-Type': 'application/json',
      },
    });
    
    if (!checkResponse.ok && checkResponse.status !== 404) {
      const errorText = await checkResponse.text();
      console.error("[SETTINGS] Error checking existing settings:", errorText);
      return NextResponse.json(
        { error: "Failed to check settings", message: errorText },
        { status: checkResponse.status }
      );
    }
    
    const existing = await checkResponse.json();
    const settingsExist = Array.isArray(existing) && existing.length > 0;
    
    let result;
    if (settingsExist) {
      // Update existing settings using PostgREST API (more reliable for RLS)
      const updateUrl = `${supabaseUrl}/rest/v1/user_settings?user_id=eq.${user.id}`;
      const updateResponse = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': supabaseAnonKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(updateData),
      });
      
      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error("[SETTINGS] Error updating settings:", errorText);
        
        // Check if it's a column doesn't exist error
        if (errorText.includes("column") && (errorText.includes("does not exist") || errorText.includes("42P01"))) {
          return NextResponse.json(
            { 
              error: "Database migration required", 
              message: `The transcription_method column does not exist. Please apply the migration: supabase/migrations/012_add_transcription_method.sql. Error: ${errorText}` 
            },
            { status: 500 }
          );
        }
        
        return NextResponse.json(
          { error: "Failed to update settings", message: errorText },
          { status: updateResponse.status }
        );
      }
      
      const updateResult = await updateResponse.json();
      result = Array.isArray(updateResult) ? updateResult[0] : updateResult;
      
      // Log saved key length for debugging
      if (result?.openai_api_key) {
        console.log("[SETTINGS] API key saved successfully, length:", result.openai_api_key.length);
      }
    } else {
      // Insert new settings using PostgREST API (more reliable for RLS)
      const insertUrl = `${supabaseUrl}/rest/v1/user_settings`;
      const insertResponse = await fetch(insertUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': supabaseAnonKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(updateData),
      });
      
      if (!insertResponse.ok) {
        const errorText = await insertResponse.text();
        console.error("[SETTINGS] Error inserting settings:", errorText);
        
        // Check if it's a column doesn't exist error
        if (errorText.includes("column") && (errorText.includes("does not exist") || errorText.includes("42P01"))) {
          return NextResponse.json(
            { 
              error: "Database migration required", 
              message: `The transcription_method column does not exist. Please apply the migration: supabase/migrations/012_add_transcription_method.sql. Error: ${errorText}` 
            },
            { status: 500 }
          );
        }
        
        // Check if it's an RLS violation
        if (errorText.includes("row-level security") || errorText.includes("42501")) {
          return NextResponse.json(
            { 
              error: "Permission denied", 
              message: "Row-level security policy violation. Ensure the user_settings table has proper RLS policies applied. See migration 009_create_user_settings_table.sql",
              details: errorText
            },
            { status: 403 }
          );
        }
        
        return NextResponse.json(
          { error: "Failed to create settings", message: errorText },
          { status: insertResponse.status }
        );
      }
      
      const insertResult = await insertResponse.json();
      result = Array.isArray(insertResult) ? insertResult[0] : insertResult;
    }
    
    return NextResponse.json({ 
      success: true, 
      settings: result 
    });
  } catch (error) {
    console.error("Update settings API error:", error);
    return NextResponse.json(
      {
        error: "Update failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

