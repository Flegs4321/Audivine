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

interface Speaker {
  id: string;
  name: string;
  created_at: string;
  tagged?: boolean;
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
    details?: string;
    apiKeyPrefix?: string;
  } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [loadingSpeakers, setLoadingSpeakers] = useState(false);
  const [newSpeakerName, setNewSpeakerName] = useState("");
  const [addingSpeaker, setAddingSpeaker] = useState(false);
  const [deletingSpeakerId, setDeletingSpeakerId] = useState<string | null>(null);
  const [importingSpeakers, setImportingSpeakers] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [taggedFeatureAvailable, setTaggedFeatureAvailable] = useState<boolean | null>(null);
  const [selectedSpeakers, setSelectedSpeakers] = useState<Set<string>>(new Set());

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
      loadSpeakers();
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

  const loadSpeakers = async () => {
    try {
      setLoadingSpeakers(true);
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        console.warn("[loadSpeakers] No session token");
        return;
      }

      const response = await fetch("/api/speakers", {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log("[loadSpeakers] Response data:", data);
        const speakersList = data.speakers || data.speaker || [];
        console.log("[loadSpeakers] Setting speakers:", speakersList);
        setSpeakers(Array.isArray(speakersList) ? speakersList : []);
      } else {
        const errorText = await response.text();
        console.error("[loadSpeakers] API error:", response.status, errorText);
        const errorData = JSON.parse(errorText).catch(() => ({}));
        alert(`Failed to load speakers: ${errorData.message || errorText}`);
      }
    } catch (err) {
      console.error("Error loading speakers:", err);
      alert(`Error loading speakers: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setLoadingSpeakers(false);
    }
  };

  const handleAddSpeaker = async () => {
    if (!newSpeakerName.trim()) return;

    try {
      setAddingSpeaker(true);
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) return;

      const response = await fetch("/api/speakers", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newSpeakerName.trim() }),
      });

      if (response.ok) {
        const data = await response.json();
        setSpeakers([...speakers, data.speaker]);
        setNewSpeakerName("");
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(errorData.message || "Failed to add speaker");
      }
    } catch (err) {
      console.error("Error adding speaker:", err);
      alert("Failed to add speaker");
    } finally {
      setAddingSpeaker(false);
    }
  };

  const handleDeleteSpeaker = async (speakerId: string) => {
    const speaker = speakers.find(s => s.id === speakerId);
    const speakerName = speaker?.name || "this speaker";
    
    if (!confirm(`Are you sure you want to delete "${speakerName}"? This action cannot be undone.`)) return;

    try {
      setDeletingSpeakerId(speakerId);
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) return;

      const response = await fetch(`/api/speakers/${speakerId}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        setSpeakers(speakers.filter(s => s.id !== speakerId));
        // Remove from selected set if it was selected
        setSelectedSpeakers(prev => {
          const newSet = new Set(prev);
          newSet.delete(speakerId);
          return newSet;
        });
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(errorData.message || "Failed to delete speaker");
      }
    } catch (err) {
      console.error("Error deleting speaker:", err);
      alert("Failed to delete speaker");
    } finally {
      setDeletingSpeakerId(null);
    }
  };

  const handleSelectAll = () => {
    if (selectedSpeakers.size === speakers.length) {
      // Deselect all
      setSelectedSpeakers(new Set());
    } else {
      // Select all
      setSelectedSpeakers(new Set(speakers.map(s => s.id)));
    }
  };

  const handleToggleSpeakerSelection = (speakerId: string) => {
    setSelectedSpeakers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(speakerId)) {
        newSet.delete(speakerId);
      } else {
        newSet.add(speakerId);
      }
      return newSet;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedSpeakers.size === 0) return;

    const selectedNames = speakers
      .filter(s => selectedSpeakers.has(s.id))
      .map(s => s.name)
      .slice(0, 10);
    const moreText = selectedSpeakers.size > 10 ? ` and ${selectedSpeakers.size - 10} more` : "";
    
    const confirmMessage = `Are you sure you want to delete ${selectedSpeakers.size} speaker(s)?\n\n${selectedNames.join(", ")}${moreText}\n\nThis action cannot be undone.`;
    
    if (!confirm(confirmMessage)) return;

    try {
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      let deleted = 0;
      let errors: string[] = [];

      // Delete all selected speakers
      for (const speakerId of selectedSpeakers) {
        try {
          const response = await fetch(`/api/speakers/${speakerId}`, {
            method: "DELETE",
            headers: {
              "Authorization": `Bearer ${session.access_token}`,
            },
          });

          if (response.ok) {
            deleted++;
          } else {
            const errorData = await response.json().catch(() => ({}));
            const speaker = speakers.find(s => s.id === speakerId);
            errors.push(`${speaker?.name || speakerId}: ${errorData.message || "Failed to delete"}`);
          }
        } catch (err) {
          const speaker = speakers.find(s => s.id === speakerId);
          errors.push(`${speaker?.name || speakerId}: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }

      // Reload speakers list
      await loadSpeakers();
      
      // Clear selection
      setSelectedSpeakers(new Set());

      // Show results
      let message = `Deleted ${deleted} speaker(s)`;
      if (errors.length > 0) {
        message += `\n\nErrors: ${errors.length}`;
        console.error("Delete errors:", errors);
      }
      alert(message);
    } catch (err) {
      console.error("Error deleting selected speakers:", err);
      alert("Failed to delete selected speakers");
    }
  };

  const handleToggleTagged = async (speakerId: string, currentlyTagged: boolean) => {
    if (!user) return;

    try {
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(`/api/speakers/${speakerId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ tagged: !currentlyTagged }),
      });

      if (response.ok) {
        // Update local state
        setSpeakers(speakers.map(s => 
          s.id === speakerId ? { ...s, tagged: !currentlyTagged } : s
        ));
      } else {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || "Failed to update speaker";
        
        // If the error is about tagged column not existing, update state and show helpful message
        if (errorMessage.includes("tagged") || errorMessage.includes("migration")) {
          setTaggedFeatureAvailable(false);
          alert("Tagging feature requires a database migration. Please apply migration 016_add_speaker_tagged_field.sql in your Supabase dashboard to enable this feature.");
        } else {
          alert(errorMessage);
        }
      }
    } catch (err) {
      console.error("Error toggling tagged status:", err);
      alert("Failed to update speaker");
    }
  };

  const handleImportExcel = async () => {
    if (!importFile || !user) return;

    try {
      setImportingSpeakers(true);
      setError(null);

      const arrayBuffer = await importFile.arrayBuffer();
      const fileExtension = importFile.name.split('.').pop()?.toLowerCase();
      
      let names: string[] = [];

      if (fileExtension === 'xlsx' || fileExtension === 'xls') {
        // Handle Excel files
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(arrayBuffer, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        
        // Extract names from the first column
        for (let i = 0; i < data.length; i++) {
          const row = data[i] as any[];
          if (row && row[0] && typeof row[0] === "string" && row[0].trim()) {
            const name = row[0].trim();
            if (!["name", "speaker", "preacher", "NAME", "SPEAKER", "PREACHER"].includes(name.toLowerCase())) {
              names.push(name);
            }
          }
        }
      } else if (fileExtension === 'docx') {
        // Handle Word documents
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ arrayBuffer });
        const text = result.value;
        
        // Split by lines and extract names
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
        
        for (const line of lines) {
          // Skip header-like lines
          if (!["name", "speaker", "preacher", "NAME", "SPEAKER", "PREACHER"].includes(line.toLowerCase())) {
            // If line contains multiple names separated by commas, split them
            if (line.includes(',')) {
              const splitNames = line.split(',').map(n => n.trim()).filter(n => n.length > 0);
              names.push(...splitNames);
            } else {
              names.push(line);
            }
          }
        }
      } else {
        alert("Unsupported file type. Please upload an Excel file (.xlsx, .xls) or Word document (.docx)");
        setImportFile(null);
        setImportingSpeakers(false);
        return;
      }

      if (names.length === 0) {
        alert("No speaker names found in the file. Please ensure the file contains speaker names (one per line for Word docs, or in the first column for Excel).");
        setImportFile(null);
        return;
      }

      // Get session token
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      // First, check which names already exist
      const existingSpeakers = speakers.map(s => s.name.toLowerCase());
      const duplicates: string[] = [];
      const newNames: string[] = [];

      for (const name of names) {
        if (existingSpeakers.includes(name.toLowerCase())) {
          duplicates.push(name);
        } else {
          newNames.push(name);
        }
      }

      // Ask user about duplicates
      let overwriteDuplicates = false;
      if (duplicates.length > 0) {
        const duplicateList = duplicates.slice(0, 10).join(", ");
        const moreText = duplicates.length > 10 ? ` and ${duplicates.length - 10} more` : "";
        const userChoice = confirm(
          `${duplicates.length} name(s) already exist in your speakers list:\n\n${duplicateList}${moreText}\n\nDo you want to overwrite these existing names?\n\nClick OK to overwrite, Cancel to skip them.`
        );
        overwriteDuplicates = userChoice;
      }

      // Add speakers
      let added = 0;
      let skipped = 0;
      let overwritten = 0;
      const errors: string[] = [];

      // Process new names first
      for (const name of newNames) {
        try {
          const response = await fetch("/api/speakers", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ name }),
          });

          if (response.ok) {
            added++;
          } else {
            const errorData = await response.json().catch(() => ({}));
            errors.push(`${name}: ${errorData.message || "Failed to add"}`);
          }
        } catch (err) {
          errors.push(`${name}: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }

      // Process duplicates based on user choice
      if (overwriteDuplicates && duplicates.length > 0) {
        // Update existing speakers with the new name (in case of case changes or slight variations)
        for (const duplicateName of duplicates) {
          const existingSpeaker = speakers.find(s => s.name.toLowerCase() === duplicateName.toLowerCase());
          if (existingSpeaker) {
            try {
              const response = await fetch(`/api/speakers/${existingSpeaker.id}`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ name: duplicateName }),
              });

              if (response.ok) {
                overwritten++;
              } else {
                const errorData = await response.json().catch(() => ({}));
                skipped++;
                errors.push(`${duplicateName}: ${errorData.message || "Failed to overwrite"}`);
              }
            } catch (err) {
              skipped++;
              errors.push(`${duplicateName}: ${err instanceof Error ? err.message : "Unknown error"}`);
            }
          } else {
            // Speaker not found (shouldn't happen, but handle it)
            skipped++;
          }
        }
      } else if (duplicates.length > 0) {
        skipped = duplicates.length;
      }

      // Reload speakers list
      await loadSpeakers();

      // Show results
      let message = `Import complete!\n\nAdded: ${added}`;
      if (overwritten > 0) {
        message += `\nOverwritten: ${overwritten}`;
      }
      if (skipped > 0) {
        message += `\nSkipped: ${skipped}`;
      }
      if (errors.length > 0) {
        message += `\nErrors: ${errors.length}`;
        console.error("Import errors:", errors);
      }
      alert(message);

      setImportFile(null);
    } catch (err) {
      console.error("Import error:", err);
      setError(err instanceof Error ? err.message : "Failed to import speakers");
      alert(err instanceof Error ? err.message : "Failed to import speakers. Make sure the file is a valid Excel file (.xlsx or .xls) or Word document (.docx)");
    } finally {
      setImportingSpeakers(false);
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
      
      // Force a page reload to ensure Header picks up the new logo
      // This is a workaround for browser caching issues
      if (window.confirm("Logo uploaded successfully! The page will reload to show the new logo.")) {
        window.location.reload();
      } else {
        alert("Logo uploaded successfully! Please refresh the page to see the new logo.");
      }
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

  const handleSaveAllSettings = async () => {
    try {
      setError(null);
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      // Prepare all settings to save
      const apiKeyToSave = (openaiApiKey && 
                           openaiApiKey.trim().length > 0 && 
                           !openaiApiKey.includes("...") &&
                           openaiApiKey.trim().length > 10)
        ? openaiApiKey.trim() 
        : undefined;

      const settingsToSave: any = {
        church_name: churchName || null,
        openai_model: openaiModel || "gpt-4o-mini",
        transcription_method: transcriptionMethod,
        openai_prompt: openaiPrompt || null,
      };

      // Only include API key if it's been changed (not masked and not empty)
      if (apiKeyToSave) {
        settingsToSave.openai_api_key = apiKeyToSave;
      }

      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(settingsToSave),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || `Failed to save settings (${response.status})`;
        throw new Error(errorMessage);
      }

      // Reload settings to get updated values
      await loadSettings();
      alert("All settings saved successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
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

          {/* Speakers Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-xl font-semibold mb-4">Speakers/Preachers</h3>
            <div className="space-y-4">
              <p className="text-sm text-gray-600 mb-4">
                Manage your list of speakers. These will be available when editing sermons.
              </p>
              
              {/* Add New Speaker */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSpeakerName}
                  onChange={(e) => setNewSpeakerName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddSpeaker();
                    }
                  }}
                  placeholder="Enter speaker name"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    handleAddSpeaker();
                  }}
                  disabled={addingSpeaker || !newSpeakerName.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {addingSpeaker ? "Adding..." : "Add Speaker"}
                </button>
              </div>

              {/* Excel/Word Import */}
              <div className="mt-4 pt-4 border-t border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Import Speakers from File
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  Upload an Excel file (.xlsx or .xls) with speaker names in the first column, or a Word document (.docx) with one name per line. Duplicate names will prompt you to overwrite or skip.
                </p>
                <div className="flex gap-2">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.docx"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 text-sm"
                    disabled={importingSpeakers}
                  />
                  <button
                    onClick={handleImportExcel}
                    disabled={importingSpeakers || !importFile}
                    className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    {importingSpeakers ? "Importing..." : "Import"}
                  </button>
                </div>
                {importFile && (
                  <p className="text-xs text-gray-600 mt-2">
                    Selected: {importFile.name}
                  </p>
                )}
              </div>

              {/* Speakers List */}
              {loadingSpeakers ? (
                <p className="text-sm text-gray-500">Loading speakers...</p>
              ) : speakers.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-gray-500">No speakers added yet. Add one above to get started.</p>
                  <button
                    onClick={loadSpeakers}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    Refresh List
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-700">Current Speakers ({speakers.length}):</h4>
                    <button
                      onClick={loadSpeakers}
                      className="text-xs text-blue-600 hover:text-blue-800 underline"
                    >
                      Refresh
                    </button>
                  </div>
                  
                  {/* Select All and Delete Selected */}
                  <div className="flex items-center justify-between pb-2 border-b border-gray-200">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedSpeakers.size === speakers.length && speakers.length > 0}
                        onChange={handleSelectAll}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <label className="text-sm text-gray-700">
                        Select All ({selectedSpeakers.size} selected)
                      </label>
                    </div>
                    {selectedSpeakers.size > 0 && (
                      <button
                        onClick={handleDeleteSelected}
                        className="px-3 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded border border-red-200"
                      >
                        Delete Selected ({selectedSpeakers.size})
                      </button>
                    )}
                  </div>

                  <div className="space-y-2">
                    {speakers.map((speaker) => (
                      <div
                        key={speaker.id}
                        className={`flex items-center justify-between p-3 rounded border ${
                          selectedSpeakers.has(speaker.id)
                            ? "bg-yellow-50 border-yellow-300"
                            : speaker.tagged 
                            ? "bg-blue-50 border-blue-300" 
                            : "bg-gray-50 border-gray-200"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedSpeakers.has(speaker.id)}
                            onChange={() => handleToggleSpeakerSelection(speaker.id)}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <button
                            onClick={() => handleToggleTagged(speaker.id, speaker.tagged || false)}
                            disabled={taggedFeatureAvailable === false}
                            className={`px-2 py-1 text-sm rounded transition-colors ${
                              taggedFeatureAvailable === false
                                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                : speaker.tagged
                                ? "bg-blue-600 text-white hover:bg-blue-700"
                                : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                            }`}
                            title={
                              taggedFeatureAvailable === false
                                ? "Tagging requires database migration. Apply migration 016_add_speaker_tagged_field.sql"
                                : speaker.tagged
                                ? "Tagged - appears at top during sharing"
                                : "Tag for easy access during sharing"
                            }
                          >
                            {speaker.tagged ? "⭐ Tagged" : "Tag"}
                          </button>
                          <span className={`text-sm font-medium ${
                            speaker.tagged ? "text-blue-900" : "text-gray-900"
                          }`}>
                            {speaker.name}
                          </span>
                        </div>
                        <button
                          onClick={() => handleDeleteSpeaker(speaker.id)}
                          disabled={deletingSpeakerId === speaker.id}
                          className="px-3 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded disabled:opacity-50"
                        >
                          {deletingSpeakerId === speaker.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    ))}
                  </div>
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

          {/* Save All Settings Button */}
          <div className="bg-white rounded-lg shadow p-6 border-t-4 border-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold mb-2">Save All Settings</h3>
                <p className="text-sm text-gray-600">
                  Save all your settings at once, including church name, OpenAI settings, and transcription preferences.
                </p>
              </div>
              <button
                onClick={handleSaveAllSettings}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-lg shadow-md hover:shadow-lg transition-all"
              >
                Save All Settings
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

