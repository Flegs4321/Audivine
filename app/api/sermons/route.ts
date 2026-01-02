/**
 * API route for fetching sermons
 * GET /api/sermons
 * Returns only sermons for the authenticated user
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";

async function getSupabaseClient(request: NextRequest) {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  
  // Extract project ref from URL (format: https://<project-ref>.supabase.co)
  const urlParts = supabaseUrl.replace('https://', '').replace('http://', '').split('.');
  const projectRef = urlParts[0] || '';
  
  // First, try to get token from Authorization header (preferred method)
  const authHeader = request.headers.get("authorization");
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  
  if (authHeader && authHeader.startsWith("Bearer ")) {
    accessToken = authHeader.substring(7);
    console.log("[API] Found access token in Authorization header");
    
    // Try to get refresh token from Supabase cookie
    // Supabase stores session as: sb-<project-ref>-auth-token
    const authCookieName = `sb-${projectRef}-auth-token`;
    try {
      const authCookie = cookieStore.get(authCookieName);
      if (authCookie) {
        const sessionData = JSON.parse(authCookie.value);
        if (sessionData.refresh_token) {
          refreshToken = sessionData.refresh_token;
          console.log("[API] Found refresh token in cookie");
        }
      }
    } catch (e) {
      // Cookie doesn't exist or isn't JSON, continue without refresh token
      console.log("[API] Could not get refresh token from cookie:", e);
    }
  } else {
    // Fallback to cookies
    const authCookieName = `sb-${projectRef}-auth-token`;
    try {
      const authCookie = cookieStore.get(authCookieName);
      if (authCookie) {
        const sessionData = JSON.parse(authCookie.value);
        if (sessionData.access_token) {
          accessToken = sessionData.access_token;
          refreshToken = sessionData.refresh_token || null;
          console.log("[API] Found tokens in cookie");
        }
      }
    } catch (e) {
      console.log("[API] Could not parse auth cookie:", e);
    }
  }
  
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  
  // Set session if we found tokens (required for RLS to work)
  if (accessToken) {
    try {
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken || '',
      });
      if (error) {
        console.error("[API] Error setting session:", error);
        // Continue anyway - explicit filter should still work
      } else {
        console.log("[API] Session set successfully for RLS");
      }
    } catch (e) {
      console.error("[API] Exception setting session:", e);
      // Continue anyway - explicit filter should still work
    }
  } else {
    console.warn("[API] No access token found in headers or cookies");
  }
  
  return supabase;
}

export async function GET(request: NextRequest) {
  try {
    console.log("[API] ========== GET /api/sermons called ==========");
    
    // Get token from request
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    
    if (!token) {
      console.error("[API] No token provided");
      return NextResponse.json(
        { 
          error: "Unauthorized", 
          message: "You must be logged in to view sermons", 
          details: "No authentication token provided"
        },
        { status: 401 }
      );
    }
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("[API] Missing Supabase environment variables");
      return NextResponse.json(
        { error: "Server configuration error", message: "Supabase not configured" },
        { status: 500 }
      );
    }
    
    // Create Supabase client with the access token in headers for RLS
    // This allows RLS policies to use auth.uid() correctly
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
    
    // Get user directly from token with retry logic
    let user;
    let authError;
    let retries = 2;
    
    while (retries >= 0) {
      const result = await supabase.auth.getUser(token);
      user = result.data.user;
      authError = result.error;
      
      if (!authError && user) {
        break; // Success
      }
      
      if (authError && authError.message?.includes("ECONNRESET")) {
        retries--;
        if (retries >= 0) {
          console.log(`[API] Connection reset, retrying... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms before retry
          continue;
        }
      } else {
        break; // Not a connection error, don't retry
      }
    }
    
    if (authError || !user) {
      console.error("[API] Auth error:", {
        error: authError,
        user: user,
        errorMessage: authError?.message,
        errorCode: authError?.status
      });
      return NextResponse.json(
        { 
          error: "Unauthorized", 
          message: "You must be logged in to view sermons", 
          details: authError?.message || "Invalid authentication token",
          code: authError?.status || "AUTH_ERROR"
        },
        { status: 401 }
      );
    }
    
    console.log("[API] Fetching sermons for user:", user.id, user.email);
    
    // Fetch only recordings for this user
    // Use PostgREST API directly with Authorization header for RLS
    // This ensures RLS policies can use auth.uid() correctly
    let data;
    let error;
    let queryRetries = 2;
    
    while (queryRetries >= 0) {
      try {
        // Use PostgREST API directly with Authorization header
        // This ensures RLS can extract auth.uid() from the JWT
        // Use select=* to get all columns (handles case where new columns might not exist yet)
        const restUrl = `${supabaseUrl}/rest/v1/recordings?user_id=eq.${user.id}&select=*&order=created_at.desc`;
        
        const response = await fetch(restUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': supabaseAnonKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          error = {
            message: `HTTP ${response.status}: ${errorText}`,
            code: response.status.toString(),
            details: errorText,
          };
          
          // Check if it's a connection error
          const isConnectionError = response.status === 0 || 
                                  error.message.includes("ECONNRESET") || 
                                  error.message.includes("fetch failed") ||
                                  error.message.includes("network");
          
          if (isConnectionError && queryRetries > 0) {
            queryRetries--;
            console.log(`[API] Query connection error, retrying... (${queryRetries} retries left)`, error.message);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            continue;
          } else {
            break; // Not a connection error or out of retries
          }
        }
        
        data = await response.json();
        error = null;
        
        console.log("[API] Query attempt result:", {
          dataCount: data?.length || 0,
          error: null,
          hasData: !!data,
          userId: user.id
        });
        
        break; // Success
      } catch (err) {
        // Catch any unexpected errors
        const isConnectionError = err instanceof Error && (
          err.message.includes("ECONNRESET") || 
          err.message.includes("fetch failed") ||
          err.message.includes("network")
        );
        
        if (isConnectionError && queryRetries > 0) {
          queryRetries--;
          console.log(`[API] Query exception, retrying... (${queryRetries} retries left)`, err);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        } else {
          error = err instanceof Error ? { message: err.message } : { message: "Unknown error" };
          break;
        }
      }
    }
    
    console.log("[API] Final query result:", {
      dataCount: data?.length || 0,
      error: error ? { message: error.message, code: error.code } : null,
      sampleData: data && data.length > 0 ? data[0] : null,
      userId: user.id
    });

    if (error) {
      const errorWithHint = error as { message: string; code?: string; details?: string; hint?: string };
      console.error("[API] Database query error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: errorWithHint.hint,
        fullError: error
      });
      return NextResponse.json(
        { error: "Failed to fetch sermons", message: error.message, details: error, code: error.code },
        { status: 500 }
      );
    }
    
    console.log("[API] Found", data?.length || 0, "recordings");

    // Map the data to include title (use filename if title doesn't exist)
    const sermons = (data || []).map((recording: any) => ({
      id: recording.id,
      title: recording.title || recording.filename || "Untitled",
      filename: recording.filename,
      duration: recording.duration || 0,
      created_at: recording.created_at,
      storage_url: recording.storage_url,
      file_path: recording.file_path,
      sermon_date: recording.sermon_date,
      sermon_time: recording.sermon_time,
      speaker: recording.speaker,
    }));

    return NextResponse.json({ sermons });
  } catch (error) {
    console.error("Sermons API error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch sermons",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

