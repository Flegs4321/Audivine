/**
 * Paths under repo-root bulletin-final/ — same template resolution as
 * bulletin-final/resolve-template-path.js (keep candidate lists in sync).
 */

import fs from "fs";
import path from "path";

const TEMPLATE_FILENAMES = ["template.docx", "TEMPLATE.docx"] as const;

/** Repo-root `bulletin-final` (recording app + CLI share this tree). */
export function bulletinFinalRoot(): string {
  return path.join(process.cwd(), "bulletin-final");
}

export function bulletinTemplateDir(): string {
  return path.join(bulletinFinalRoot(), "template");
}

/**
 * Master Word template used by buildBulletinDocxBuffer and bulletin-final/generate.js.
 * Prefers `template.docx`, then `TEMPLATE.docx`.
 */
export function resolveBulletinTemplateDocxPath(): string {
  const dir = bulletinTemplateDir();
  for (const name of TEMPLATE_FILENAMES) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(dir, "template.docx");
}
