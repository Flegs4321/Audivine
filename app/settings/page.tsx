/**
 * Settings Page
 * - Upload church logo
 * - Manage user preferences
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../auth/context/AuthProvider";
import Header from "../components/Header";

interface UserSettings {
  church_logo_url?: string | null;
  church_name?: string | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, signOut, loading: authLoading } = useAuth();
  const [settings, setSettings] = useState<UserSettings>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [churchName, setChurchName] = useState("");
  const [testingOpenAI, setTestingOpenAI] = useState(false);
  const [openAITestResult, setOpenAITestResult] = useState<{ connected: boolean; message?: string; error?: string } | null>(null);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login?redirect=/settings");
    }
  }, [user, authLoading, router]);

  // Load settings
  useEffect(() => {
    if (user) {
      loadSettings();
    }
  }, [user]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);

      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      const response = await fetch("/api/settings", {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        // If 404 or settings is null, settings don't exist yet - that's okay
        if (response.status === 404) {
          setSettings({});
          setLoading(false);
          return;
        }
        
        // Try to get error message from response
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || "Failed to load settings";
        
        // If it's a migration error, show helpful message
        if (errorData.error === "Database migration required") {
          setError(`Database migration required: ${errorMessage}`);
        } else {
          setError(errorMessage);
        }
        setLoading(false);
        return;
      }

      const data = await response.json();
      // Handle null settings (user hasn't created settings yet)
      if (data.settings === null) {
        setSettings({});
        setChurchName("");
      } else {
        setSettings(data.settings || {});
        setChurchName(data.settings?.church_name || "");
      }
    } catch (err) {
      console.error("Error loading settings:", err);
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  const handleLogoUpload = async () => {
    if (!logoFile) return;

    setUploading(true);
    setError(null);

    try {
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      // Upload logo to Supabase Storage
      const formData = new FormData();
      formData.append("file", logoFile);
      formData.append("type", "logo");

      const uploadResponse = await fetch("/api/settings/upload-logo", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || "Failed to upload logo");
      }

      const uploadData = await uploadResponse.json();
      
      // Update settings with logo URL
      const updateResponse = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          church_logo_url: uploadData.url,
          church_name: churchName || null,
        }),
      });

      if (!updateResponse.ok) {
        throw new Error("Failed to save logo URL");
      }

      // Reload settings
      await loadSettings();
      setLogoFile(null);
      alert("Logo uploaded successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload logo");
      console.error("Upload error:", err);
    } finally {
      setUploading(false);
    }
  };

  const testOpenAIConnection = async () => {
    setTestingOpenAI(true);
    setOpenAITestResult(null);
    setError(null);

    try {
      const response = await fetch("/api/test-openai");
      const data = await response.json();
      setOpenAITestResult(data);
    } catch (err) {
      setOpenAITestResult({
        connected: false,
        error: err instanceof Error ? err.message : "Failed to test connection",
      });
    } finally {
      setTestingOpenAI(false);
    }
  };

  const handleSaveChurchName = async () => {
    setError(null);

    try {
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          church_name: churchName || null,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save church name");
      }

      await loadSettings();
      alert("Church name saved successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save church name");
      console.error("Save error:", err);
    }
  };

  const handleRemoveLogo = async () => {
    if (!confirm("Are you sure you want to remove the logo?")) {
      return;
    }

    setError(null);

    try {
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          church_logo_url: null,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to remove logo");
      }

      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove logo");
      console.error("Remove error:", err);
    }
  };

  // Show loading state while checking authentication
  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <div className="max-w-4xl mx-auto p-6">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Settings</h2>
          <p className="text-gray-600">Manage your church settings and preferences</p>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        <div className="space-y-6">
          {/* Church Logo Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-xl font-semibold mb-4">Church Logo</h3>
            
            {settings.church_logo_url && (
              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-2">Current Logo:</p>
                <img
                  src={settings.church_logo_url}
                  alt="Church logo"
                  className="max-w-xs max-h-32 object-contain border border-gray-200 rounded"
                />
                <button
                  onClick={handleRemoveLogo}
                  className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
                >
                  Remove Logo
                </button>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Upload Logo
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {logoFile && (
                  <div className="mt-2 text-sm text-gray-600">
                    Selected: {logoFile.name} ({(logoFile.size / 1024).toFixed(2)} KB)
                  </div>
                )}
              </div>
              <button
                onClick={handleLogoUpload}
                disabled={!logoFile || uploading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? "Uploading..." : "Upload Logo"}
              </button>
            </div>
          </div>

          {/* OpenAI Connection Test Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-xl font-semibold mb-4">OpenAI Connection</h3>
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Test your OpenAI API connection to verify transcription and summarization will work.
              </p>
              <button
                onClick={testOpenAIConnection}
                disabled={testingOpenAI}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testingOpenAI ? "Testing..." : "Test OpenAI Connection"}
              </button>
              
              {openAITestResult && (
                <div className={`mt-4 p-4 rounded-lg ${
                  openAITestResult.connected 
                    ? "bg-green-50 border border-green-200" 
                    : "bg-red-50 border border-red-200"
                }`}>
                  <p className={`font-semibold ${
                    openAITestResult.connected ? "text-green-800" : "text-red-800"
                  }`}>
                    {openAITestResult.connected ? "✅ Connected!" : "❌ Not Connected"}
                  </p>
                  {openAITestResult.message && (
                    <p className={`text-sm mt-2 ${
                      openAITestResult.connected ? "text-green-700" : "text-red-700"
                    }`}>
                      {openAITestResult.message}
                    </p>
                  )}
                  {openAITestResult.error && (
                    <p className="text-sm mt-2 text-red-700">
                      Error: {openAITestResult.error}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Church Name Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-xl font-semibold mb-4">Church Name</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Church Name
                </label>
                <input
                  type="text"
                  value={churchName}
                  onChange={(e) => setChurchName(e.target.value)}
                  placeholder="Enter your church name"
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={handleSaveChurchName}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Save Church Name
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

