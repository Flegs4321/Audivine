/**
 * Settings Page
 * - Upload church logo
 * - Manage user preferences
 */

"use client";

import { useState, useEffect, useMemo } from "react";
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
  anthropic_api_key?: string | null;
  claude_model?: string | null;
}

interface Speaker {
  id: string;
  name: string;
  created_at: string;
  tagged?: boolean;
}

/** Run in Supabase SQL Editor if save fails (migration 017). */
const ANTHROPIC_COLUMNS_SQL = `ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT,
ADD COLUMN IF NOT EXISTS claude_model TEXT DEFAULT 'claude-sonnet-4-20250514';`;

function isAnthropicColumnMigrationError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    message.includes("Claude (Anthropic) columns") ||
    (m.includes("could not find") &&
      (m.includes("anthropic_api_key") || m.includes("claude_model"))) ||
    (m.includes("pgrst204") && (m.includes("anthropic") || m.includes("claude")))
  );
}

/** Preset IDs for the Claude model dropdown (Messages API) + comparison chart rows. */
const CLAUDE_MODEL_CHOICES: {
  value: string;
  label: string;
  bestFor: string;
  speed: string;
  quality: string;
  cost: string;
}[] = [
  {
    value: "claude-sonnet-4-20250514",
    label: "Claude Sonnet 4 — balanced (default)",
    bestFor: "Member summaries, long transcripts, everyday use",
    speed: "Fast",
    quality: "Very high",
    cost: "Medium",
  },
  {
    value: "claude-opus-4-20250514",
    label: "Claude Opus 4 — most capable",
    bestFor: "Hardest reasoning, nuance, complex writing",
    speed: "Slower",
    quality: "Highest",
    cost: "Highest",
  },
  {
    value: "claude-3-5-sonnet-20241022",
    label: "Claude 3.5 Sonnet",
    bestFor: "General tasks if your project still uses 3.5",
    speed: "Fast",
    quality: "High",
    cost: "Medium",
  },
  {
    value: "claude-3-5-haiku-20241022",
    label: "Claude 3.5 Haiku — fastest / lowest cost",
    bestFor: "Short sections, quick drafts, tight budgets",
    speed: "Fastest",
    quality: "Good",
    cost: "Lowest",
  },
  {
    value: "claude-3-opus-20240229",
    label: "Claude 3 Opus",
    bestFor: "Legacy “max quality” workloads on older Claude 3",
    speed: "Slower",
    quality: "Very high",
    cost: "High",
  },
];

const CLAUDE_MODEL_PRESET_IDS = new Set(CLAUDE_MODEL_CHOICES.map((c) => c.value));

/** ChatGPT / OpenAI API presets — same table shape as Claude comparison. */
const OPENAI_MODEL_CHART_ROWS: {
  value: string;
  label: string;
  bestFor: string;
  speed: string;
  quality: string;
  cost: string;
}[] = [
  {
    value: "gpt-4o-mini",
    label: "GPT-4o mini",
    bestFor: "Summaries, Whisper, everyday use — best default for most users",
    speed: "Very fast",
    quality: "High",
    cost: "Lowest",
  },
  {
    value: "gpt-3.5-turbo",
    label: "GPT-3.5 Turbo",
    bestFor: "Very cheap, simple tasks, legacy workflows",
    speed: "Fastest",
    quality: "Good",
    cost: "Very low",
  },
  {
    value: "gpt-4o",
    label: "GPT-4o",
    bestFor: "Harder reasoning, richer writing when mini is not enough",
    speed: "Fast",
    quality: "Very high",
    cost: "Medium",
  },
  {
    value: "gpt-4-turbo",
    label: "GPT-4 Turbo",
    bestFor: "Long context, complex analysis (if available on your key)",
    speed: "Fast",
    quality: "Very high",
    cost: "Higher",
  },
  {
    value: "gpt-4",
    label: "GPT-4",
    bestFor: "Legacy full GPT-4 (if your account still lists it)",
    speed: "Moderate",
    quality: "Very high",
    cost: "Higher",
  },
];

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
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [claudeModel, setClaudeModel] = useState("claude-sonnet-4-20250514");
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

  const openaiChartRows = useMemo(() => {
    if (availableModels.length > 0) {
      return availableModels.map((id) => {
        const preset = OPENAI_MODEL_CHART_ROWS.find((r) => r.value === id);
        return (
          preset ?? {
            value: id,
            label: id,
            bestFor: "Listed for your API key — see OpenAI model docs for details",
            speed: "—",
            quality: "—",
            cost: "—",
          }
        );
      });
    }
    return OPENAI_MODEL_CHART_ROWS;
  }, [availableModels]);

  /** Ensures the dropdown always includes the current saved model (API IDs may differ from our presets). */
  const openaiDropdownModelIds = useMemo(() => {
    if (availableModels.length > 0) {
      if (openaiModel && !availableModels.includes(openaiModel)) {
        return [openaiModel, ...availableModels];
      }
      return availableModels;
    }
    const base = OPENAI_MODEL_CHART_ROWS.map((r) => r.value);
    if (openaiModel && !base.includes(openaiModel)) {
      return [openaiModel, ...base];
    }
    return base;
  }, [availableModels, openaiModel]);

  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [loadingSpeakers, setLoadingSpeakers] = useState(false);
  const [newSpeakerName, setNewSpeakerName] = useState("");
  const [addingSpeaker, setAddingSpeaker] = useState(false);
  const [deletingSpeakerId, setDeletingSpeakerId] = useState<string | null>(null);
  const [importingSpeakers, setImportingSpeakers] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [taggedFeatureAvailable, setTaggedFeatureAvailable] = useState<boolean | null>(null);
  const [selectedSpeakers, setSelectedSpeakers] = useState<Set<string>>(new Set());
  const [speakersSectionExpanded, setSpeakersSectionExpanded] = useState(false);

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
        if (data.settings?.anthropic_api_key && data.settings.anthropic_api_key.includes("...")) {
          setAnthropicApiKey("");
        } else if (data.settings?.anthropic_api_key && !data.settings.anthropic_api_key.includes("...")) {
          setAnthropicApiKey(data.settings.anthropic_api_key);
        } else {
          setAnthropicApiKey("");
        }
        setClaudeModel(data.settings?.claude_model || "claude-sonnet-4-20250514");
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
    if (selectedSpeakers.size === 0) {
      alert("No speakers selected. Please select speakers to delete.");
      return;
    }

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

      // Convert Set to Array to avoid iteration issues
      const speakerIdsToDelete = Array.from(selectedSpeakers);
      console.log(`[Delete Selected] Attempting to delete ${speakerIdsToDelete.length} speaker(s):`, speakerIdsToDelete);

      let deleted = 0;
      let errors: string[] = [];

      // Delete all selected speakers (using Promise.all for better error handling)
      const deletePromises = speakerIdsToDelete.map(async (speakerId) => {
        try {
          const response = await fetch(`/api/speakers/${speakerId}`, {
            method: "DELETE",
            headers: {
              "Authorization": `Bearer ${session.access_token}`,
            },
          });

          if (response.ok) {
            deleted++;
            console.log(`[Delete Selected] Successfully deleted speaker: ${speakerId}`);
            return { success: true, speakerId };
          } else {
            const errorData = await response.json().catch(() => ({}));
            const speaker = speakers.find(s => s.id === speakerId);
            const errorMsg = `${speaker?.name || speakerId}: ${errorData.message || errorData.error || "Failed to delete"}`;
            errors.push(errorMsg);
            console.error(`[Delete Selected] Failed to delete speaker ${speakerId}:`, errorData);
            return { success: false, speakerId, error: errorMsg };
          }
        } catch (err) {
          const speaker = speakers.find(s => s.id === speakerId);
          const errorMsg = `${speaker?.name || speakerId}: ${err instanceof Error ? err.message : "Unknown error"}`;
          errors.push(errorMsg);
          console.error(`[Delete Selected] Error deleting speaker ${speakerId}:`, err);
          return { success: false, speakerId, error: errorMsg };
        }
      });

      // Wait for all deletions to complete
      await Promise.all(deletePromises);

      console.log(`[Delete Selected] Completed: ${deleted} deleted, ${errors.length} errors`);

      // Reload speakers list
      await loadSpeakers();
      
      // Clear selection
      setSelectedSpeakers(new Set());

      // Show results
      let message = `Deleted ${deleted} speaker(s)`;
      if (errors.length > 0) {
        message += `\n\nErrors (${errors.length}):\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n... and ${errors.length - 5} more` : ''}`;
        console.error("Delete errors:", errors);
      }
      alert(message);
    } catch (err) {
      console.error("Error deleting selected speakers:", err);
      alert(`Failed to delete selected speakers: ${err instanceof Error ? err.message : "Unknown error"}`);
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

    // Helper function to clean individual names
    const cleanName = (name: string): string => {
      if (!name) return '';
      
      // Trim and remove extra whitespace
      let cleaned = name.trim();
      
      // Remove leading/trailing punctuation that's not part of the name (but keep apostrophes in names like O'Brien)
      cleaned = cleaned.replace(/^[^\w']+|[^\w']+$/g, '');
      
      // Remove common prefixes/suffixes that might be formatting artifacts
      cleaned = cleaned.replace(/^(mr|mrs|ms|dr|prof|rev)\.?\s+/i, '');
      
      // Only return if the cleaned name has at least one letter
      return /[a-zA-Z]/.test(cleaned) ? cleaned : '';
    };
    
    // Helper function to process a name item (handles "Last, First" format and other separators)
    const processNameItem = (item: string, namesArray: string[]) => {
      if (!item || !item.trim()) return;
      
      // Check if this looks like a "Last, First" format (single comma with text before and after)
      // Pattern: word(s), word(s) - but not multiple names separated by commas
      const lastFirstPattern = /^[^,]+,\s*[^,]+$/;
      if (lastFirstPattern.test(item.trim())) {
        // This is a single name in "Last, First" format - keep it as one name
        const cleaned = cleanName(item);
        if (cleaned) {
          namesArray.push(cleaned);
        }
        return;
      }
      
      // Split by common separators (comma, semicolon, pipe, or multiple spaces)
      // Only split if there are multiple separators or if it's not a "Last, First" pattern
      const separators = /[,;|]|\s{2,}/;
      if (separators.test(item)) {
        const split = item.split(separators).map(n => cleanName(n)).filter(n => n.length > 0);
        namesArray.push(...split);
      } else {
        const cleaned = cleanName(item);
        if (cleaned) {
          namesArray.push(cleaned);
        }
      }
    };

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
      } else if (fileExtension === 'txt') {
        // Handle plain text files
        const textDecoder = new TextDecoder('utf-8');
        let text = textDecoder.decode(arrayBuffer);
        
        // Replace common special characters and clean up text
        text = text.replace(/\u00A0/g, ' '); // Replace non-breaking spaces
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); // Normalize line endings
        
        // Split by lines and process
        const lines = text.split('\n');
        
        for (const line of lines) {
          let cleanedLine = line.trim();
          
          // Skip empty lines
          if (!cleanedLine) continue;
          
          // Skip header-like lines (case insensitive, with or without punctuation)
          const headerPatterns = /^(name|speaker|preacher|member)[\s:]*$/i;
          if (headerPatterns.test(cleanedLine)) continue;
          
          // Process the line (handles "Last, First" format and other separators)
          processNameItem(cleanedLine, names);
        }
      } else if (fileExtension === 'docx') {
        // Handle Word documents
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ arrayBuffer });
        let text = result.value;
        
        // Replace common special characters and clean up text
        // Replace non-breaking spaces with regular spaces
        text = text.replace(/\u00A0/g, ' ');
        // Replace multiple spaces/tabs with single space
        text = text.replace(/[\s\t]+/g, ' ');
        // Replace common list markers (bullet points, numbers, dashes)
        text = text.replace(/^[\s]*[•·▪▫◦‣⁃]\s*/gm, '');
        text = text.replace(/^[\s]*\d+[.)]\s*/gm, '');
        text = text.replace(/^[\s]*[-–—]\s*/gm, '');
        
        // Split by lines and process
        const lines = text.split(/\r?\n/);
        
        for (const line of lines) {
          let cleanedLine = line.trim();
          
          // Skip empty lines
          if (!cleanedLine) continue;
          
          // Skip header-like lines (case insensitive, with or without punctuation)
          const headerPatterns = /^(name|speaker|preacher|member)[\s:]*$/i;
          if (headerPatterns.test(cleanedLine)) continue;
          
          // Handle tabs (common in tables) - split by tabs first
          if (cleanedLine.includes('\t')) {
            const tabSeparated = cleanedLine.split('\t').map(s => s.trim()).filter(s => s.length > 0);
            for (const item of tabSeparated) {
              // Each tab-separated item might contain multiple names
              processNameItem(item, names);
            }
          } else {
            // Process the line as a whole
            processNameItem(cleanedLine, names);
          }
        }
      } else {
        alert("Unsupported file type. Please upload an Excel file (.xlsx, .xls), Word document (.docx), or text file (.txt)");
        setImportFile(null);
        setImportingSpeakers(false);
        return;
      }

      if (names.length === 0) {
        alert("No speaker names found in the file. Please ensure the file contains speaker names (one per line for Word docs/text files, or in the first column for Excel).");
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
        alert(err instanceof Error ? err.message : "Failed to import speakers. Make sure the file is a valid Excel file (.xlsx or .xls), Word document (.docx), or text file (.txt)");
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

      const anthropicKeyToSave =
        anthropicApiKey &&
        anthropicApiKey.trim().length > 0 &&
        !anthropicApiKey.includes("...") &&
        anthropicApiKey.trim().length > 15
          ? anthropicApiKey.trim()
          : undefined;

      const saveBody: Record<string, unknown> = {
        ...(apiKeyToSave ? { openai_api_key: apiKeyToSave } : {}),
        ...(anthropicKeyToSave ? { anthropic_api_key: anthropicKeyToSave } : {}),
        claude_model: claudeModel || "claude-sonnet-4-20250514",
        openai_model: openaiModel || "gpt-4o-mini",
        transcription_method: transcriptionMethod,
        openai_prompt: openaiPrompt || null,
      };

      const hadAnthropicInPayload = !!(
        saveBody.anthropic_api_key || saveBody.claude_model
      );

      let response = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(saveBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        let errorMessage =
          errorData.message || errorData.error || `Failed to save OpenAI settings (${response.status})`;

        if (
          isAnthropicColumnMigrationError(errorMessage) &&
          hadAnthropicInPayload
        ) {
          const retryBody = { ...saveBody };
          delete retryBody.anthropic_api_key;
          delete retryBody.claude_model;
          response = await fetch("/api/settings", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify(retryBody),
          });
          if (response.ok) {
            await loadSettings();
            setError(
              `OpenAI settings saved. Add Claude columns in Supabase (SQL Editor), then save again for your Anthropic key.\n\n${ANTHROPIC_COLUMNS_SQL}`
            );
            alert(
              "OpenAI settings saved. Run the SQL on this page, then save again to store your Claude API key."
            );
            return;
          }
        }

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
      alert("AI settings saved successfully!");
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

      const anthropicKeyToSave =
        anthropicApiKey &&
        anthropicApiKey.trim().length > 0 &&
        !anthropicApiKey.includes("...") &&
        anthropicApiKey.trim().length > 15
          ? anthropicApiKey.trim()
          : undefined;

      const settingsToSave: any = {
        church_name: churchName || null,
        openai_model: openaiModel || "gpt-4o-mini",
        transcription_method: transcriptionMethod,
        openai_prompt: openaiPrompt || null,
        claude_model: claudeModel || "claude-sonnet-4-20250514",
      };

      // Only include API key if it's been changed (not masked and not empty)
      if (apiKeyToSave) {
        settingsToSave.openai_api_key = apiKeyToSave;
      }
      if (anthropicKeyToSave) {
        settingsToSave.anthropic_api_key = anthropicKeyToSave;
      }

      const hadAnthropicInPayload = !!(
        settingsToSave.anthropic_api_key || settingsToSave.claude_model
      );

      let response = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(settingsToSave),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        let errorMessage =
          errorData.message || errorData.error || `Failed to save settings (${response.status})`;

        if (
          isAnthropicColumnMigrationError(errorMessage) &&
          hadAnthropicInPayload
        ) {
          const retryPayload = { ...settingsToSave };
          delete retryPayload.anthropic_api_key;
          delete retryPayload.claude_model;
          response = await fetch("/api/settings", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify(retryPayload),
          });
          if (response.ok) {
            await loadSettings();
            setError(
              `Other settings saved. Add Claude columns in Supabase (SQL Editor), then save again to store your Anthropic key.\n\n${ANTHROPIC_COLUMNS_SQL}`
            );
            alert(
              "Other settings saved. Run the SQL shown in the red message on this page, wait a few seconds, then click Save again to store your Claude API key."
            );
            return;
          }
        }

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
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
          <p className="text-sm text-slate-600">Loading…</p>
        </div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900">Settings</h2>
          <p className="mt-1 text-slate-600">Church branding, transcription, and speakers</p>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 rounded-xl border border-red-200/80 bg-red-50/90 p-4">
            <p className="whitespace-pre-wrap break-words text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="space-y-6">
          {/* Church Logo Section */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-xl font-semibold text-slate-900">Church Logo</h3>
            
            {settings.church_logo_url && (
              <div className="mb-4">
                <p className="text-sm text-slate-600 mb-2">Current Logo:</p>
                <img
                  src={settings.church_logo_url}
                  alt="Church logo"
                  className="max-w-xs max-h-32 object-contain border border-slate-200 rounded"
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
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Upload Logo
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-900 hover:file:bg-teal-100"
                />
                {logoFile && (
                  <div className="mt-2 text-sm text-slate-600">
                    Selected: {logoFile.name} ({(logoFile.size / 1024).toFixed(2)} KB)
                  </div>
                )}
              </div>
              <button
                onClick={handleLogoUpload}
                disabled={!logoFile || uploading}
                className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? "Uploading..." : "Upload Logo"}
              </button>
            </div>
          </div>

          {/* Claude (Anthropic) — member summaries prefer Claude when set */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
            <h3 className="text-xl font-semibold mb-4">Claude (Anthropic)</h3>
            <div className="space-y-4">
              {(() => {
                const hasAnthropic =
                  settings.anthropic_api_key &&
                  settings.anthropic_api_key.length > 12 &&
                  settings.anthropic_api_key.includes("...");
                return hasAnthropic ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                    <p className="text-sm text-green-800 font-semibold">
                      Anthropic API key configured
                    </p>
                    <p className="text-sm text-green-700 mt-1">
                      Member summaries and Word export use Claude (this key takes priority over OpenAI for summaries).
                    </p>
                  </div>
                ) : (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
                    <p className="text-sm text-slate-800 font-semibold mb-1">Optional</p>
                    <p className="text-sm text-slate-700">
                      Add an Anthropic API key to generate member summaries with Claude. If you leave this empty,
                      summaries use your OpenAI key when that is configured.
                    </p>
                  </div>
                );
              })()}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Anthropic API key
                </label>
                <input
                  type="password"
                  value={anthropicApiKey}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v.includes("...")) return;
                    setAnthropicApiKey(v);
                  }}
                  placeholder={
                    settings.anthropic_api_key
                      ? "Enter new key to update (current key is saved)"
                      : "sk-ant-api03-..."
                  }
                  autoComplete="off"
                  data-form-type="other"
                  data-lpignore="true"
                  name="anthropic-api-key"
                  id="anthropic-api-key"
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40 font-mono text-sm"
                />
                <p className="mt-1 text-xs text-slate-500">
                  {settings.anthropic_api_key
                    ? "Key is stored for your account only. Enter a new key to replace it, or leave blank to keep the current key."
                    : "From the Anthropic Console. Used for member-facing summaries when set."}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Claude model
                </label>
                <select
                  value={
                    CLAUDE_MODEL_PRESET_IDS.has(claudeModel)
                      ? claudeModel
                      : "__custom__"
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__custom__") {
                      setClaudeModel("");
                    } else {
                      setClaudeModel(v);
                    }
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40 text-sm"
                >
                  {CLAUDE_MODEL_CHOICES.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                  <option value="__custom__">Custom model ID…</option>
                </select>
                {!CLAUDE_MODEL_PRESET_IDS.has(claudeModel) && (
                  <input
                    type="text"
                    value={claudeModel}
                    onChange={(e) => setClaudeModel(e.target.value.trim())}
                    placeholder="e.g. claude-sonnet-4-20250514"
                    className="mt-2 w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40 font-mono text-sm"
                  />
                )}
                <p className="mt-1 text-xs text-slate-500">
                  Used for member summaries and section summaries when Claude is selected. Choose a preset or enter any model ID your Anthropic account supports.
                </p>

                <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  <p className="border-b border-slate-200 bg-slate-100/90 px-3 py-2 text-xs font-semibold text-slate-900">
                    Claude model comparison (like choosing in ChatGPT)
                    <span className="ml-1 font-normal text-slate-600">
                      — click a row to select that model
                    </span>
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-xs text-slate-800">
                      <thead>
                        <tr className="border-b border-slate-200 bg-white/80 text-slate-600">
                          <th className="px-3 py-2 font-semibold">Model</th>
                          <th className="px-3 py-2 font-semibold">Best for</th>
                          <th className="px-3 py-2 font-semibold">Speed</th>
                          <th className="px-3 py-2 font-semibold">Quality</th>
                          <th className="px-3 py-2 font-semibold">Relative cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white/60">
                        {CLAUDE_MODEL_CHOICES.map((row) => (
                          <tr
                            key={row.value}
                            role="button"
                            tabIndex={0}
                            onClick={() => setClaudeModel(row.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setClaudeModel(row.value);
                              }
                            }}
                            className={
                              claudeModel === row.value
                                ? "cursor-pointer bg-teal-50/90 ring-1 ring-inset ring-teal-200/80"
                                : "cursor-pointer hover:bg-slate-50/50"
                            }
                          >
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-900">
                              {row.label.split(" — ")[0]}
                            </td>
                            <td className="px-3 py-2">{row.bestFor}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{row.speed}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{row.quality}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{row.cost}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ul className="space-y-1 border-t border-slate-200 px-3 py-2 text-xs text-slate-700">
                    <li>
                      <span className="font-semibold text-slate-800">Start here:</span>{" "}
                      <strong>Claude Sonnet 4</strong> is the usual pick for sermon summaries and Word export.
                    </li>
                    <li>
                      <span className="font-semibold text-slate-800">Tight budget:</span> choose{" "}
                      <strong>Haiku</strong> for speed and lowest cost; quality is still solid for summaries.
                    </li>
                    <li>
                      <span className="font-semibold text-slate-800">Max quality:</span>{" "}
                      <strong>Opus 4</strong> when you need the strongest reasoning and polish (higher cost).
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* OpenAI Settings Section */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
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
                      OpenAI transcription, segment auto-detect, and (if no Claude key) member summaries are available.
                    </p>
                  </div>
                ) : (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                    <p className="text-sm text-yellow-800 font-semibold mb-2">
                      ⚠️ OpenAI API Key Missing
                    </p>
                    <p className="text-sm text-yellow-700">
                      OpenAI Whisper transcription and automatic segment detection require an OpenAI API key.
                      Member summaries can still use Claude if you configure an Anthropic key above.
                    </p>
                  </div>
                );
              })()}
              
              <p className="text-sm text-slate-600">
                Configure your OpenAI API key for Whisper transcription, segment detection, and for summaries when no Anthropic key is set.
                <strong className="text-slate-800"> You provide your own API keys; they are stored for your account only.</strong>
              </p>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
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
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40 font-mono text-sm"
                />
                <p className="mt-1 text-xs text-slate-500">
                  {settings.openai_api_key 
                    ? "API key is configured. Enter a new key above to update it, or leave blank to keep the current key."
                    : "Your API key is stored securely and only used for your account. Enter your OpenAI API key."}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  ChatGPT model
                </label>
                <select
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40"
                >
                  {openaiDropdownModelIds.map((model) => {
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
                    const preset = OPENAI_MODEL_CHART_ROWS.find((r) => r.value === model);
                    const info = getModelInfo(model);
                    const label = preset
                      ? preset.label
                      : `${model}${info.label ? ` — ${info.label}` : ""}`;
                    return (
                      <option key={model} value={model}>
                        {label}
                      </option>
                    );
                  })}
                </select>
                {openAITestResult && !openAITestResult.isModelAvailable && (
                  <p className="mt-1 text-xs text-yellow-600">
                    ⚠️ Selected model may not be available. Test connection to verify.
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  {availableModels.length > 0
                    ? "Models listed are what your API key can use. Test connection to refresh."
                    : "Default OpenAI model IDs. Test connection to load the list your key supports."}
                </p>

                <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  <p className="border-b border-slate-200 bg-slate-100/90 px-3 py-2 text-xs font-semibold text-slate-900">
                    ChatGPT model comparison (like choosing in ChatGPT)
                    <span className="ml-1 font-normal text-slate-600">
                      — click a row to select that model
                    </span>
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-xs text-slate-800">
                      <thead>
                        <tr className="border-b border-slate-200 bg-white/80 text-slate-600">
                          <th className="px-3 py-2 font-semibold">Model</th>
                          <th className="px-3 py-2 font-semibold">Best for</th>
                          <th className="px-3 py-2 font-semibold">Speed</th>
                          <th className="px-3 py-2 font-semibold">Quality</th>
                          <th className="px-3 py-2 font-semibold">Relative cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white/60">
                        {openaiChartRows.map((row) => {
                          const canSelect =
                            availableModels.length === 0 ||
                            availableModels.includes(row.value);
                          return (
                            <tr
                              key={row.value}
                              role="button"
                              tabIndex={canSelect ? 0 : -1}
                              onClick={() => {
                                if (canSelect) setOpenaiModel(row.value);
                              }}
                              onKeyDown={(e) => {
                                if (!canSelect) return;
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setOpenaiModel(row.value);
                                }
                              }}
                              className={
                                openaiModel === row.value
                                  ? canSelect
                                    ? "cursor-pointer bg-teal-50/90 ring-1 ring-inset ring-teal-200/80"
                                    : "bg-teal-50/90 ring-1 ring-inset ring-teal-200/80 opacity-90"
                                  : canSelect
                                    ? "cursor-pointer hover:bg-slate-50/50"
                                    : "cursor-not-allowed opacity-60"
                              }
                            >
                              <td className="px-3 py-2 font-mono text-[11px] text-slate-900">
                                {row.label}
                              </td>
                              <td className="px-3 py-2">{row.bestFor}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{row.speed}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{row.quality}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{row.cost}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <ul className="space-y-1 border-t border-slate-200 px-3 py-2 text-xs text-slate-700">
                    <li>
                      <span className="font-semibold text-slate-800">Start here:</span>{" "}
                      <strong>GPT-4o mini</strong> is usually the best balance for summaries and transcription.
                    </li>
                    <li>
                      <span className="font-semibold text-slate-800">Tight budget:</span>{" "}
                      <strong>GPT-3.5 Turbo</strong> for the lowest cost; quality is still fine for many tasks.
                    </li>
                    <li>
                      <span className="font-semibold text-slate-800">Max quality:</span>{" "}
                      <strong>GPT-4o</strong> or <strong>GPT-4 Turbo</strong> when you need stronger reasoning (higher cost).
                    </li>
                  </ul>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Custom OpenAI Prompt
                </label>
                <textarea
                  value={openaiPrompt}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    if (newValue.length <= 5000) {
                      setOpenaiPrompt(newValue);
                    }
                  }}
                  placeholder="Enter a custom prompt to instruct OpenAI on how to process transcripts (e.g., 'Focus on key biblical themes and practical applications')"
                  rows={4}
                  maxLength={5000}
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40"
                />
                <div className="flex justify-between items-center mt-1">
                  <p className="text-xs text-slate-500">
                    Customize how OpenAI processes your transcripts. Leave blank to use default prompts.
                  </p>
                  <p className="text-xs text-slate-400">
                    {openaiPrompt.length}/5000 characters
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
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
                        className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40"
                      >
                        <option value="browser">Browser Speech Recognition (Free, Real-time)</option>
                        <option value="openai" disabled={!hasApiKey}>
                          OpenAI Whisper API {!hasApiKey && "(API Key Required)"}
                        </option>
                      </select>
                      <p className="mt-1 text-xs text-slate-500">
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
                  className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
                >
                  Save AI settings
                </button>
                <button
                  onClick={testOpenAIConnection}
                  disabled={testingOpenAI}
                  className="px-6 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Speakers/Preachers</h3>
              <button
                type="button"
                onClick={() => setSpeakersSectionExpanded(!speakersSectionExpanded)}
                className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 transition-colors"
              >
                {speakersSectionExpanded ? "▼ Hide" : "▶ Show"} ({speakers.length})
              </button>
            </div>
            {speakersSectionExpanded && (
              <div className="space-y-4">
                <p className="text-sm text-slate-600 mb-4">
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
                  className="flex-1 px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40"
                />
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    handleAddSpeaker();
                  }}
                  disabled={addingSpeaker || !newSpeakerName.trim()}
                  className="px-4 py-2 bg-teal-600 text-white rounded hover:bg-teal-700 disabled:opacity-50"
                >
                  {addingSpeaker ? "Adding..." : "Add Speaker"}
                </button>
              </div>

              {/* Excel/Word Import */}
              <div className="mt-4 pt-4 border-t border-slate-200">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Import Speakers from File
                </label>
                <p className="text-xs text-slate-500 mb-3">
                  Upload an Excel file (.xlsx or .xls) with speaker names in the first column, a Word document (.docx) with one name per line, or a text file (.txt) with one name per line. Names can be in "Last, First" format or separated by commas. Duplicate names will prompt you to overwrite or skip.
                </p>
                <div className="flex gap-2">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.docx"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40 text-sm"
                    disabled={importingSpeakers}
                  />
                  <button
                    onClick={handleImportExcel}
                    disabled={importingSpeakers || !importFile}
                    className="px-4 py-2 rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                  >
                    {importingSpeakers ? "Importing..." : "Import"}
                  </button>
                </div>
                {importFile && (
                  <p className="text-xs text-slate-600 mt-2">
                    Selected: {importFile.name}
                  </p>
                )}
              </div>

              {/* Speakers List */}
              {loadingSpeakers ? (
                <p className="text-sm text-slate-500">Loading speakers...</p>
              ) : speakers.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-slate-500">No speakers added yet. Add one above to get started.</p>
                  <button
                    onClick={loadSpeakers}
                    className="text-xs text-teal-600 hover:text-slate-800 underline"
                  >
                    Refresh List
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-slate-700">Current Speakers ({speakers.length}):</h4>
                    <button
                      onClick={loadSpeakers}
                      className="text-xs text-teal-600 hover:text-slate-800 underline"
                    >
                      Refresh
                    </button>
                  </div>
                  
                  {/* Select All and Delete Selected */}
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedSpeakers.size === speakers.length && speakers.length > 0}
                        onChange={handleSelectAll}
                        className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500/40"
                      />
                      <label className="text-sm text-slate-700">
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
                            ? "bg-sky-50 border-sky-200" 
                            : "bg-slate-50 border-slate-200"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedSpeakers.has(speaker.id)}
                            onChange={() => handleToggleSpeakerSelection(speaker.id)}
                            className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500/40"
                          />
                          <button
                            onClick={() => handleToggleTagged(speaker.id, speaker.tagged || false)}
                            disabled={taggedFeatureAvailable === false}
                            className={`px-2 py-1 text-sm rounded transition-colors ${
                              taggedFeatureAvailable === false
                                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                : speaker.tagged
                                ? "bg-teal-600 text-white hover:bg-teal-700"
                                : "bg-slate-200 text-slate-600 hover:bg-slate-300"
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
                            speaker.tagged ? "text-slate-900" : "text-slate-900"
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
            )}
          </div>

          {/* Church Name Section */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
            <h3 className="text-xl font-semibold mb-4">Church Name</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Church Name
                </label>
                <input
                  type="text"
                  value={churchName}
                  onChange={(e) => setChurchName(e.target.value)}
                  placeholder="Enter your church name"
                  className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40"
                />
              </div>
              <button
                onClick={handleSaveChurchName}
                className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
              >
                Save Church Name
              </button>
            </div>
          </div>

          {/* Save All Settings Button */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm border-t-4 border-teal-500">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold mb-2">Save All Settings</h3>
                <p className="text-sm text-slate-600">
                  Save all your settings at once, including church name, OpenAI settings, and transcription preferences.
                </p>
              </div>
              <button
                onClick={handleSaveAllSettings}
                className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-semibold text-lg shadow-md hover:shadow-lg transition-all"
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

