/**
 * Fill a .docx template using docxtemplater (browser).
 * Placeholders: {{church_name}}, loops — see public/word-templates/README.md
 */

export class WordTemplateRenderError extends Error {
  hint?: string;

  constructor(message: string, options?: { hint?: string; cause?: unknown }) {
    super(message);
    this.name = "WordTemplateRenderError";
    this.hint = options?.hint;
    if (options && "cause" in options) {
      // Preserve upstream parser/render error details when available.
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export async function renderWordTemplate(
  templateArrayBuffer: ArrayBuffer,
  data: Record<string, unknown>
): Promise<Blob> {
  const [{ default: Docxtemplater }, { default: PizZip }] = await Promise.all([
    import("docxtemplater"),
    import("pizzip"),
  ]);

  try {
    const zip = new PizZip(templateArrayBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "",
    });
    doc.render(data);
    const blob = doc.getZip().generate({
      type: "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }) as Blob;
    return blob;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Template render failed";
    throw new WordTemplateRenderError(message, {
      cause: err,
      hint:
        "Check your Word placeholders use docxtemplater syntax, for example {{member_summary}} and loops like {#summary_lines}{.}{/summary_lines}.",
    });
  }
}
