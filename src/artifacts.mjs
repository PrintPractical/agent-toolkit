import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function slugify(title) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error("Title must contain a letter or number");
  return slug.slice(0, 64).replace(/-$/g, "");
}

export async function renderChange(root, { kind, title, slug }) {
  const templateName = kind === "fix" ? "fix.md.tmpl" : "design.md.tmpl";
  const template = await readFile(path.join(packageRoot, "templates", templateName), "utf8");
  const rendered = template
    .replaceAll("{{TITLE}}", title)
    .replaceAll("{{SLUG}}", slug)
    .replaceAll("{{KIND}}", kind);
  const directory = path.join(root, ".agent", "changes");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${slug}.md`);
  try {
    await readFile(file);
    throw new Error(`Change already exists: .agent/changes/${slug}.md`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(file, rendered);
  return file;
}

export async function renderSystem(root) {
  const destination = path.join(root, ".agent", "SYSTEM.md");
  try {
    await readFile(destination);
    return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const template = await readFile(path.join(packageRoot, "templates", "system.md.tmpl"), "utf8");
  await writeFile(destination, template);
  return true;
}

export async function validateArtifacts(root, state, { requireSystem = false } = {}) {
  const problems = [];
  const design = path.join(root, state.designPath);
  let content = "";
  try {
    content = await readFile(design, "utf8");
  } catch {
    problems.push(`Missing ${state.designPath}`);
  }
  const plan = content.match(/^## (?:Implementation Plan|Thin Vertical Slices)\s*\n([\s\S]*?)(?=\n## |$)/m)?.[1]?.trim();
  const placeholders = new Set([
    "Order thin vertical slices by observable behavior; include code, boundary work, and tests in each slice.",
    "Order diagnosis lock-in, correction, boundary updates, and verification as observable slices.",
    "Order thin vertical slices by observable behavior. For each slice, name its outcome, likely code areas, boundary or data changes, tests, dependencies, and completion signal.",
    "Order diagnosis lock-in, correction, boundary updates, and verification as observable slices. For each slice, name likely code areas, tests, dependencies, and completion signal."
  ]);
  if (!plan) problems.push("Missing Implementation Plan section");
  else if (placeholders.has(plan)) problems.push("Complete the Implementation Plan before developer review");
  const questions = content.match(/## Open Questions\s*\n([\s\S]*?)(?=\n## |$)/)?.[1]?.trim();
  if (!questions) problems.push("Missing Open Questions section");
  else if (!/^[-*]\s+(None\.|None|No open questions\.?)$/i.test(questions)) problems.push("Material open questions remain");
  if (requireSystem) {
    try {
      await readFile(path.join(root, ".agent", "SYSTEM.md"), "utf8");
    } catch {
      problems.push("Missing .agent/SYSTEM.md; create the minimum relevant system map");
    }
  }
  return problems;
}
