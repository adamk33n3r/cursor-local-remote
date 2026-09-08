/** Cursor wraps Host prompts and redacts citations in stream-json / jsonl. */

export function displayTranscriptText(text: string): string {
  return text
    .replace(/<manually_attached_skills>[\s\S]*?<\/manually_attached_skills>\s*/gi, "")
    .replace(/<image_files>[\s\S]*?<\/image_files>\s*/gi, "")
    .replace(/<timestamp>[\s\S]*?<\/timestamp>\s*/gi, "")
    .replace(/<user_query>\n?/gi, "")
    .replace(/<\/user_query>\n?/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/`?\[REDACTED\]`?/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeUserPrompt(text: string): string {
  return displayTranscriptText(text).replace(/\s+/g, " ").trim();
}
