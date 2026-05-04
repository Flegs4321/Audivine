/**
 * API route for generating a comprehensive sermon summary
 * POST /api/sermons/generate-summary
 * Generates a nice, formatted summary suitable for sending to church members
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserSummaryGenerationSettings } from "@/lib/ai/summary-generation-settings";
import { getUserOpenAISettings } from "@/lib/openai/user-settings";
import {
  mergeTranscriptWithTags,
  SpeakerTag,
  TranscriptChunk,
} from "@/lib/transcript/merge";
import { pickMergeSourceTranscriptChunks } from "@/lib/transcript/pick-merge-source-chunks";

export const runtime = "nodejs";

function deriveTaggedSermonSpeakerFromRecording(recording: any): string | null {
  const chunks = Array.isArray(recording?.transcript_chunks) ? recording.transcript_chunks : [];
  if (chunks.length === 0) return null;

  const sermonSeg = Array.isArray(recording?.segments)
    ? recording.segments.find((s: any) => s?.label === "Sermon")
    : null;

  const inSermonRange = chunks.filter((c: any) => {
    const ts = Number(c?.timestampMs ?? 0);
    if (!sermonSeg) return true;
    return ts >= Number(sermonSeg.startMs ?? 0) && (sermonSeg.endMs == null || ts <= Number(sermonSeg.endMs));
  });

  for (const c of inSermonRange) {
    const text = String(c?.text || "");
    const lower = text.toLowerCase();
    const tagged =
      c?.speakerTag === true &&
      (lower.includes("sermon speaker:") || lower.includes("message speaker:"));
    if (!tagged) continue;
    if (c?.speaker && String(c.speaker).trim().length > 0) return String(c.speaker).trim();
    const m = text.match(/^(.+?)\s*-\s*(?:sermon|message)\s+speaker\s*:/i);
    if (m?.[1]?.trim()) return m[1].trim();
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to generate summaries" },
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
        { error: "Unauthorized", message: "You must be logged in to generate summaries" },
        { status: 401 }
      );
    }

    let genSettings = await getUserSummaryGenerationSettings(user.id, token, supabase);

    if (!genSettings) {
      const openaiOnly = await getUserOpenAISettings(user.id, token);
      if (openaiOnly?.apiKey) {
        genSettings = {
          provider: "openai",
          prompt: openaiOnly.prompt ?? null,
          openai: {
            apiKey: openaiOnly.apiKey,
            model: openaiOnly.model,
          },
        };
      }
    }

    if (!genSettings) {
      return NextResponse.json(
        {
          error: "API key not configured",
          message:
            "Add an Anthropic (Claude) API key or an OpenAI API key in Settings to generate member summaries.",
        },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { recordingId, transcript, sermonSpeakerName } = body;
    let resolvedSermonSpeakerName: string | null =
      typeof sermonSpeakerName === "string" && sermonSpeakerName.trim().length > 0
        ? sermonSpeakerName.trim()
        : null;

    if (!recordingId && !transcript) {
      return NextResponse.json(
        { error: "Bad request", message: "Either recordingId or transcript must be provided" },
        { status: 400 }
      );
    }

    let fullTranscript = transcript;

    // If recordingId is provided, fetch the transcript from the recording
    if (recordingId && !transcript) {
      const { data: recording, error: fetchError } = await supabase
        .from("recordings")
        .select("*, segments, transcript_chunks")
        .eq("id", recordingId)
        .eq("user_id", user.id)
        .single();

      if (fetchError || !recording) {
        return NextResponse.json(
          { error: "Recording not found", message: "Could not find the recording" },
          { status: 404 }
        );
      }

      // -----------------------------------------------------------------
      // Prefer editable_transcripts + transcript_speaker_tags when either
      // exists. The merge happens in-memory; neither table is mutated.
      // -----------------------------------------------------------------
      const [editableRes, tagsRes] = await Promise.all([
        supabase
          .from("editable_transcripts")
          .select("transcript_chunks")
          .eq("recording_id", recordingId)
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("transcript_speaker_tags")
          .select("*")
          .eq("recording_id", recordingId)
          .eq("user_id", user.id)
          .order("timestamp_ms", { ascending: true }),
      ]);

      const editableChunks: TranscriptChunk[] | null =
        editableRes.data && Array.isArray(editableRes.data.transcript_chunks)
          ? (editableRes.data.transcript_chunks as TranscriptChunk[])
          : null;
      const tagRows = Array.isArray(tagsRes.data) ? tagsRes.data : [];
      const speakerTags: SpeakerTag[] = tagRows.map((row: any) => ({
        id: row.id,
        timestampMs: row.timestamp_ms,
        endTimestampMs: row.end_timestamp_ms,
        speakerName: row.speaker_name,
        role: row.role,
        note: row.note,
      }));

      const useMerged = (editableChunks && editableChunks.length > 0) || speakerTags.length > 0;
      if (useMerged) {
        const recordingChunks = Array.isArray(recording.transcript_chunks)
          ? (recording.transcript_chunks as TranscriptChunk[])
          : [];
        const durationSec =
          typeof recording.duration === "number" && Number.isFinite(recording.duration)
            ? recording.duration
            : 0;

        const { chunks: sourceChunks } = pickMergeSourceTranscriptChunks({
          recordingChunks,
          editableChunks,
          durationSeconds: durationSec,
        });

        const merged = mergeTranscriptWithTags(sourceChunks, speakerTags);
        fullTranscript = merged.fullText || sourceChunks.map((c) => c.text).join(" ");
        if (!resolvedSermonSpeakerName && merged.sermonSpeakerName) {
          resolvedSermonSpeakerName = merged.sermonSpeakerName;
        }
      } else if (recording.transcript_chunks && Array.isArray(recording.transcript_chunks)) {
        // Since speaker names are now included in the text itself (e.g., "John - Hello..."),
        // we can simply concatenate all chunks, ensuring proper spacing
        let transcriptWithSpeakers = "";
        
        for (const chunk of recording.transcript_chunks) {
          // If this is a speaker tag (e.g., "John - sharing:"), add it with proper spacing
          if (chunk.speakerTag === true) {
            transcriptWithSpeakers += "\n" + chunk.text + "\n";
          } else {
            // Regular transcript chunk - it may already have speaker prefix in format "Speaker - text"
            // or old format "[Speaker]: text", or no prefix at all
            // Just add it as-is since formatting is already done
            transcriptWithSpeakers += chunk.text + " ";
          }
        }
        
        fullTranscript = transcriptWithSpeakers.trim();

        // If client did not provide sermon speaker, derive from explicit tagged transcript rows.
        if (!resolvedSermonSpeakerName) {
          resolvedSermonSpeakerName = deriveTaggedSermonSpeakerFromRecording(recording);
        }
      } else if (recording.segments && Array.isArray(recording.segments)) {
        // Fallback to segments if transcript_chunks not available
        fullTranscript = recording.segments
          .map((segment: any) => segment.text)
          .join(" ");
      } else {
        return NextResponse.json(
          { error: "No transcript found", message: "This recording has no transcript available" },
          { status: 400 }
        );
      }
    }

    if (!fullTranscript || fullTranscript.trim().length === 0) {
      return NextResponse.json(
        { error: "Empty transcript", message: "The transcript is empty" },
        { status: 400 }
      );
    }

    // Optional instruction to include sermon speaker in MESSAGE header
    const sermonSpeakerInstruction =
      resolvedSermonSpeakerName && resolvedSermonSpeakerName.length > 0
        ? `\nImportant: The person who delivered the sermon/message is "${resolvedSermonSpeakerName}". In your summary, use the section header "MESSAGE: ${resolvedSermonSpeakerName}" (e.g. "3) MESSAGE: ${resolvedSermonSpeakerName}") for the sermon section.\n`
        : "";

    const customPrompt = genSettings.prompt?.trim() ?? "";

    // Generate comprehensive summary (Claude preferred when Anthropic key is set)
    let prompt: string;
    if (customPrompt.length > 0) {
      prompt = `${customPrompt}${sermonSpeakerInstruction}\n\nTranscript (with speaker names in format "Speaker Name - text"):\n${fullTranscript.substring(0, 16000)}`;
    } else {
      // Fallback to default prompt if no custom prompt
      prompt = `You are creating a summary of a church service sermon to send to all church members. 

The transcript includes speaker names in the format "Speaker Name - text" (e.g., "Josh Byler - Pray for my mom"). Use this information to identify who is speaking during different parts of the service (sharing time, sermon, etc.).${sermonSpeakerInstruction}

Please create a well-formatted, engaging summary that includes:
1. A compelling title for the sermon
2. A brief introduction (1-2 sentences)
3. Main message/theme (2-3 paragraphs)
4. Key points or takeaways (5-7 bullet points)
5. Scripture references mentioned (if any)
6. A closing thought or call to action (1-2 sentences)
7. If multiple speakers are mentioned, note who spoke during sharing time and who delivered the sermon

Make it warm, accessible, and inspiring. Format it in a way that's easy to read and share.

Sermon Transcript (with speaker names in format "Speaker Name - text"):
${fullTranscript.substring(0, 16000)}`;
    }

    const systemMessage =
      customPrompt.length > 0
        ? "You are a helpful assistant. Follow the user's instructions exactly."
        : "You are a helpful assistant that creates engaging, well-formatted summaries of church sermons for distribution to members. Always format your response clearly with sections and bullet points.";

    let summary: string | undefined;

    if (genSettings.provider === "anthropic" && genSettings.anthropic) {
      const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": genSettings.anthropic.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: genSettings.anthropic.model,
          max_tokens: 4096,
          system: systemMessage,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!anthropicRes.ok) {
        const errText = await anthropicRes.text();
        console.error("Anthropic API error:", errText);
        return NextResponse.json(
          { error: "Anthropic API error", message: `Failed to generate summary: ${anthropicRes.statusText}` },
          { status: 500 }
        );
      }

      const anthropicData = (await anthropicRes.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const block = anthropicData.content?.find((c) => c.type === "text");
      summary = block?.text?.trim();
    } else if (genSettings.provider === "openai" && genSettings.openai) {
      const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${genSettings.openai.apiKey}`,
        },
        body: JSON.stringify({
          model: genSettings.openai.model,
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 2000,
        }),
      });

      if (!openaiResponse.ok) {
        const errorText = await openaiResponse.text();
        console.error("OpenAI API error:", errorText);
        return NextResponse.json(
          { error: "OpenAI API error", message: `Failed to generate summary: ${openaiResponse.statusText}` },
          { status: 500 }
        );
      }

      const openaiData = await openaiResponse.json();
      summary = openaiData.choices[0]?.message?.content;
    } else {
      return NextResponse.json(
        { error: "Configuration error", message: "No valid summary provider configured." },
        { status: 500 }
      );
    }

    if (!summary) {
      return NextResponse.json(
        { error: "No summary generated", message: "The model did not return a summary" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      summary,
      transcriptLength: fullTranscript.length,
      provider: genSettings.provider,
    });
  } catch (error) {
    console.error("Generate summary API error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate summary",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

