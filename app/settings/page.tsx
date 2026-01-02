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
  openai_api_key?: string | null;
  openai_model?: string | null;
  transcription_method?: string | null;
  openai_prompt?: string | null;
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
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini");
  const [transcriptionMethod, setTranscriptionMethod] = useState<"browser" | "openai">("browser");
  const [openaiPrompt, setOpenaiPrompt] = useState("");
  const [testingOpenAI, setTestingOpenAI] = useState(false);
  const [openAITestResult, setOpenAITestResult] = useState<{ 
    connected: boolean; 
    message?: string; 
    error?: string;
    availableModels?: string[];
    isModelAvailable?: boolean;
  } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

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
        // The API already masks the key in the response
        // We should NOT put the masked key in the input field - it should be empty or show a placeholder
        // The masked key is only for display purposes in the status banner
        if (data.settings?.openai_api_key && data.settings.openai_api_key.includes("...")) {
          // Key exists but is masked - don't put masked value in input field
          // Use a placeholder indicator instead
          setOpenaiApiKey(""); // Clear the field - user needs to re-enter if they want to change it
        } else if (data.settings?.openai_api_key && !data.settings.openai_api_key.includes("...")) {
          // This shouldn't happen (API should always mask), but handle it just in case
          setOpenaiApiKey(data.settings.openai_api_key);
        } else {
          setOpenaiApiKey("");
        }
        setOpenaiModel(data.settings?.openai_model || "gpt-4o-mini");
        setTranscriptionMethod((data.settings?.transcription_method as "browser" | "openai") || "browser");
        setOpenaiPrompt(data.settings?.openai_prompt || "");
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
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      // Check if user has entered a key in the input (not masked)
      const keyToTest = (openaiApiKey && !openaiApiKey.includes("...") && openaiApiKey.trim().length > 0)
        ? openaiApiKey.trim()
        : null;

      if (!keyToTest) {
        setOpenAITestResult({
          connected: false,
          error: "No API key provided",
          message: "Please enter your OpenAI API key in the field above before testing.",
        });
        setTestingOpenAI(false);
        return;
      }

      // Test the key directly
      const testResponse = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${keyToTest}`,
        },
      });

      if (!testResponse.ok) {
        const errorText = await testResponse.text();
        setOpenAITestResult({
          connected: false,
          error: `OpenAI API error: ${testResponse.status} ${testResponse.statusText}`,
          message: "API key may be invalid or expired. Please check your key and try again.",
          details: errorText,
        });
        setTestingOpenAI(false);
        return;
      }

      const models = await testResponse.json();
      const availableModelIds = models.data?.map((m: any) => m.id) || [];
      
      // Filter to only chat/completion models suitable for summarization
      // Exclude whisper models (for transcription) and only include gpt models (for summarization)
      const chatModels = availableModelIds.filter((id: string) => 
        id.startsWith("gpt-") && 
        !id.includes("instruct") && 
        !id.includes("deprecated") &&
        !id.includes("whisper") &&
        (id.includes("gpt-4") || id.includes("gpt-3.5"))
      ).sort();

      // Check if current model is available
      const isModelAvailable = chatModels.includes(openaiModel);

      setOpenAITestResult({
        connected: true,
        message: isModelAvailable 
          ? "OpenAI API is connected and working!" 
          : `OpenAI API is connected, but the selected model "${openaiModel}" may not be available.`,
        apiKeyPrefix: keyToTest.substring(0, 7) + "...",
        isModelAvailable: isModelAvailable,
        availableModels: chatModels,
      });

      // Update available models
      if (chatModels.length > 0) {
        setAvailableModels(chatModels);
        
        // If current model is not available, suggest a fallback
        if (!isModelAvailable) {
          const fallback = chatModels.find((m: string) => m.includes("gpt-4o-mini")) 
            || chatModels.find((m: string) => m.includes("gpt-4o"))
            || chatModels[0];
          
          if (fallback) {
            setOpenaiModel(fallback);
            setError(`Selected model was not available. Switched to "${fallback}".`);
          }
        }
      }
    } catch (err) {
      setOpenAITestResult({
        connected: false,
        error: err instanceof Error ? err.message : "Failed to test connection",
        message: "Unable to connect to OpenAI. Please check your internet connection and try again.",
      });
    } finally {
      setTestingOpenAI(false);
    }
  };

  const handleSaveOpenAISettings = async () => {
    setError(null);

    try {
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      // Only send API key if it's been changed (not masked and not empty)
      // If the field is empty, don't send anything (keeps existing key)
      // If the field has a value, save it (updates the key)
      const apiKeyToSave = (openaiApiKey && 
                           openaiApiKey.trim().length > 0 && 
                           !openaiApiKey.includes("...") &&
                           openaiApiKey.trim().length > 10) // Minimum length check (API keys are usually 40+ chars)
        ? openaiApiKey.trim() 
        : undefined;

      // Log for debugging (don't log the full key, just length)
      if (apiKeyToSave) {
        console.log("[Settings] Saving API key, length:", apiKeyToSave.length, "starts with:", apiKeyToSave.substring(0, 7));
      } else if (openaiApiKey && openaiApiKey.trim().length > 0) {
        console.warn("[Settings] API key not saved - too short or contains '...'. Length:", openaiApiKey.trim().length);
      }

      // Validate model selection if we have available models
      if (availableModels.length > 0 && !availableModels.includes(openaiModel)) {
        const confirmChange = confirm(
          `The selected model "${openaiModel}" may not be available for your API key. ` +
          `Available models: ${availableModels.slice(0, 5).join(", ")}. ` +
          `Do you want to save anyway?`
        );
        if (!confirmChange) {
          return;
        }
      }

      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          ...(apiKeyToSave ? { openai_api_key: apiKeyToSave } : {}),
          openai_model: openaiModel || "gpt-4o-mini",
          transcription_method: transcriptionMethod,
          openai_prompt: openaiPrompt || null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || `Failed to save OpenAI settings (${response.status})`;
        
        // Check if it's a database migration error or schema cache issue
        if (errorMessage.includes("PGRST204") || errorMessage.includes("Could not find")) {
          if (errorMessage.includes("openai_prompt")) {
            throw new Error(`PostgREST schema cache needs to refresh. The openai_prompt column was added, but PostgREST hasn't detected it yet. Please wait 10-30 seconds and try again, or restart your Supabase project in the dashboard. If the error persists, verify the column exists by running the verification query in verify_openai_prompt_column.sql`);
          } else if (errorMessage.includes("column") && errorMessage.includes("does not exist")) {
            throw new Error(`Database migration required: The column doesn't exist. Please apply the appropriate migration file.`);
          }
        }
        
        if (errorMessage.includes("column") && errorMessage.includes("does not exist")) {
          throw new Error(`Database migration required: The column doesn't exist. Please apply the appropriate migration file.`);
        }
        
        throw new Error(errorMessage);
      }

      await loadSettings();
      alert("OpenAI settings saved successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save OpenAI settings");
      console.error("Save error:", err);
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

          {/* OpenAI Settings Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-xl font-semibold mb-4">OpenAI Settings</h3>
            <div className="space-y-4">
              {(() => {
                // Check if API key exists (even if masked, it will be present and start with "sk-")
                const hasKey = settings.openai_api_key && 
                              settings.openai_api_key.length > 10 && 
                              (settings.openai_api_key.startsWith("sk-") || settings.openai_api_key.startsWith("sk_proj-"));
                
                return hasKey ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                    <p className="text-sm text-green-800 font-semibold">
                      ✅ OpenAI API Key Configured
                    </p>
                    <p className="text-sm text-green-700 mt-1">
                      Summarization and analysis features are available.
                    </p>
                  </div>
                ) : (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                    <p className="text-sm text-yellow-800 font-semibold mb-2">
                      ⚠️ OpenAI API Key Required
                    </p>
                    <p className="text-sm text-yellow-700">
                      You must configure your own OpenAI API key to use summarization and analysis features. 
                      Without your own API key, these features will not be available.
                    </p>
                  </div>
                );
              })()}
              
              <p className="text-sm text-gray-600">
                Configure your own OpenAI API key to use your own account for transcription and summarization. 
                <strong className="text-gray-800"> You must provide your own API key to use these features.</strong>
              </p>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  OpenAI API Key
                </label>
                <input
                  type="text"
                  value={openaiApiKey}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    // Prevent masked keys from being entered
                    if (newValue.includes("...")) {
                      return; // Don't allow masked keys to be entered
                    }
                    setOpenaiApiKey(newValue);
                    // Log length for debugging (not the actual key)
                    if (newValue && newValue.length > 0) {
                      console.log("[Settings] API key input length:", newValue.length, "starts with:", newValue.substring(0, Math.min(7, newValue.length)));
                    }
                  }}
                  placeholder={settings.openai_api_key ? "Enter new API key to update (current key is saved)" : "sk-..."}
                  autoComplete="off"
                  data-form-type="other"
                  data-lpignore="true"
                  name="openai-api-key"
                  id="openai-api-key"
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {settings.openai_api_key 
                    ? "API key is configured. Enter a new key above to update it, or leave blank to keep the current key."
                    : "Your API key is stored securely and only used for your account. Enter your OpenAI API key."}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  AI Model
                </label>
                {availableModels.length > 0 ? (
                  <>
                    <select
                      value={openaiModel}
                      onChange={(e) => setOpenaiModel(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    >
                      {availableModels.map((model) => {
                        // Model characteristics
                        const getModelInfo = (m: string) => {
                          if (m.includes("gpt-4o-mini")) {
                            return { label: "Most Cost-Effective | Very Fast | Recommended", speed: "Very Fast", cost: "Lowest" };
                          } else if (m.includes("gpt-3.5-turbo")) {
                            return { label: "Fastest | Very Cost-Effective", speed: "Fastest", cost: "Very Low" };
                          } else if (m.includes("gpt-4o") && !m.includes("mini")) {
                            return { label: "Most Capable | Fast | Moderate Cost", speed: "Fast", cost: "Moderate" };
                          } else if (m.includes("gpt-4-turbo")) {
                            return { label: "High Quality | Fast | Higher Cost", speed: "Fast", cost: "Higher" };
                          } else if (m.includes("gpt-4") && !m.includes("turbo") && !m.includes("o")) {
                            return { label: "High Quality | Moderate | Higher Cost", speed: "Moderate", cost: "Higher" };
                          } else {
                            return { label: "", speed: "Unknown", cost: "Unknown" };
                          }
                        };
                        
                        const info = getModelInfo(model);
                        return (
                          <option key={model} value={model}>
                            {model} {info.label && `- ${info.label}`}
                          </option>
                        );
                      })}
                    </select>
                    {openAITestResult && !openAITestResult.isModelAvailable && (
                      <p className="mt-1 text-xs text-yellow-600">
                        ⚠️ Selected model may not be available. Test connection to verify.
                      </p>
                    )}
                    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-xs font-semibold text-blue-900 mb-1">Model Selection Guide:</p>
                      <ul className="text-xs text-blue-800 space-y-1">
                        <li>💰 <strong>Most Cost-Effective:</strong> gpt-4o-mini, gpt-3.5-turbo</li>
                        <li>⚡ <strong>Fastest:</strong> gpt-3.5-turbo, gpt-4o-mini</li>
                        <li>🎯 <strong>Most Capable:</strong> gpt-4o, gpt-4-turbo</li>
                        <li>✅ <strong>Recommended:</strong> gpt-4o-mini (best balance of cost, speed, and quality)</li>
                      </ul>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Models shown are available for your API key. Test connection to refresh the list.
                    </p>
                  </>
                ) : (
                  <>
                    <select
                      value={openaiModel}
                      onChange={(e) => setOpenaiModel(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="gpt-4o-mini">GPT-4o Mini - Most Cost-Effective | Very Fast | Recommended</option>
                      <option value="gpt-3.5-turbo">GPT-3.5 Turbo - Fastest | Very Cost-Effective</option>
                      <option value="gpt-4o">GPT-4o - Most Capable | Fast | Moderate Cost</option>
                      <option value="gpt-4-turbo">GPT-4 Turbo - High Quality | Fast | Higher Cost</option>
                      <option value="gpt-4">GPT-4 - High Quality | Moderate | Higher Cost</option>
                    </select>
                    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-xs font-semibold text-blue-900 mb-1">Model Selection Guide:</p>
                      <ul className="text-xs text-blue-800 space-y-1">
                        <li>💰 <strong>Most Cost-Effective:</strong> gpt-4o-mini, gpt-3.5-turbo</li>
                        <li>⚡ <strong>Fastest:</strong> gpt-3.5-turbo, gpt-4o-mini</li>
                        <li>🎯 <strong>Most Capable:</strong> gpt-4o, gpt-4-turbo</li>
                        <li>✅ <strong>Recommended:</strong> gpt-4o-mini (best balance of cost, speed, and quality)</li>
                      </ul>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Select which OpenAI model to use for summarization. <strong>Test connection</strong> to verify which models are available for your API key.
                    </p>
                  </>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Custom OpenAI Prompt
                </label>
                <textarea
                  value={openaiPrompt}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    if (newValue.length <= 1000) {
                      setOpenaiPrompt(newValue);
                    }
                  }}
                  placeholder="Enter a custom prompt to instruct OpenAI on how to process transcripts (e.g., 'Focus on key biblical themes and practical applications')"
                  rows={4}
                  maxLength={1000}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex justify-between items-center mt-1">
                  <p className="text-xs text-gray-500">
                    Customize how OpenAI processes your transcripts. Leave blank to use default prompts.
                  </p>
                  <p className="text-xs text-gray-400">
                    {openaiPrompt.length}/1000 characters
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Transcription Method
                </label>
                {(() => {
                  const hasApiKey = settings.openai_api_key && 
                                   settings.openai_api_key.length > 10 && 
                                   (settings.openai_api_key.startsWith("sk-") || settings.openai_api_key.startsWith("sk_proj-"));
                  
                  return (
                    <>
                      <select
                        value={transcriptionMethod}
                        onChange={(e) => {
                          const newValue = e.target.value as "browser" | "openai";
                          if (newValue === "openai" && !hasApiKey) {
                            // Don't allow switching to OpenAI without API key
                            return;
                          }
                          setTranscriptionMethod(newValue);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="browser">Browser Speech Recognition (Free, Real-time)</option>
                        <option value="openai" disabled={!hasApiKey}>
                          OpenAI Whisper API {!hasApiKey && "(API Key Required)"}
                        </option>
                      </select>
                      <p className="mt-1 text-xs text-gray-500">
                        {transcriptionMethod === "browser" 
                          ? "Uses your browser's built-in speech recognition. Free but may be less accurate."
                          : "Uses OpenAI Whisper API for transcription. More accurate but requires your OpenAI API key and incurs costs."}
                      </p>
                      {transcriptionMethod === "openai" && !hasApiKey && (
                        <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                          <p className="text-xs text-yellow-800 font-semibold mb-1">
                            ⚠️ OpenAI API Key Required
                          </p>
                          <p className="text-xs text-yellow-700">
                            To use OpenAI Whisper for transcription, you must first configure your OpenAI API key in the field above. 
                            Once you save your API key, you can select this option.
                          </p>
                        </div>
                      )}
                      {transcriptionMethod === "openai" && hasApiKey && (
                        <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                          <p className="text-xs text-green-800 font-semibold">
                            ✅ OpenAI API Key Configured
                          </p>
                          <p className="text-xs text-green-700 mt-1">
                            Your recordings will be transcribed using OpenAI Whisper API after upload.
                          </p>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSaveOpenAISettings}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Save OpenAI Settings
                </button>
                <button
                  onClick={testOpenAIConnection}
                  disabled={testingOpenAI}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {testingOpenAI ? "Testing..." : "Test Connection"}
                </button>
              </div>
              
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
                  {openAITestResult.connected && openAITestResult.availableModels && (
                    <div className="mt-2">
                      <p className="text-sm text-green-700 font-semibold">Available Models:</p>
                      <p className="text-xs text-green-600 mt-1">
                        {openAITestResult.availableModels.slice(0, 10).join(", ")}
                        {openAITestResult.availableModels.length > 10 && ` (+${openAITestResult.availableModels.length - 10} more)`}
                      </p>
                    </div>
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

