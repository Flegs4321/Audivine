/**
 * Fill a .docx template using docxtemplater (browser).
 * Placeholders: {{church_name}}, loops — see public/word-templates/README.md
 */

export async function renderWordTemplate(
  templateArrayBuffer: ArrayBuffer,
  data: Record<string, unknown>
): Promise<Blob> {
  const [{ default: Docxtemplater }, { default: PizZip }] = await Promise.all([
    import("docxtemplater"),
    import("pizzip"),
  ]);

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
}
