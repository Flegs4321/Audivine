/**
 * Single place to resolve the master bulletin .docx under bulletin-final/template/.
 * Keep logic in sync with lib/bulletin/bulletin-final-paths.ts (Next.js app).
 */

const fs = require("fs");
const path = require("path");

const CANDIDATES = ["template.docx", "TEMPLATE.docx"];

/**
 * @param {string} templateDir - Absolute path to bulletin-final/template
 * @returns {string} Path to an existing .docx, or template.docx (for error messages)
 */
function resolveBulletinTemplateDocx(templateDir) {
  for (const name of CANDIDATES) {
    const p = path.join(templateDir, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(templateDir, "template.docx");
}

module.exports = { resolveBulletinTemplateDocx, BULLETIN_TEMPLATE_FILENAMES: CANDIDATES };
