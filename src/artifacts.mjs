import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sectionBody(content, ...names) {
  return content.match(new RegExp(`^## (?:${names.join("|")})\\s*\\n([\\s\\S]*?)(?=\\n## [^#]|(?![\\s\\S]))`, "m"))?.[1]?.trim();
}

export function implementationSlices(content) {
  const plan = sectionBody(content, "Implementation Plan", "Thin Vertical Slices") || "";
  return [...plan.matchAll(/(?:^|\n)### Slice (\d+): ([^\n]+)\n([\s\S]*?)(?=\n### |$)/g)].map(match => {
    const commandText = match[3].match(/^- Acceptance command:\s*(.+)$/mi)?.[1]?.trim();
    let acceptanceCommand;
    try {
      acceptanceCommand = commandText ? JSON.parse(commandText) : undefined;
    } catch {
      acceptanceCommand = null;
    }
    return {
      number: Number(match[1]),
      title: match[2].trim(),
      body: match[3],
      acceptanceCommand
    };
  });
}

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

export async function validateArtifacts(root, state, { requireSystem = false, requireConformance = false, conformanceSliceNumbers } = {}) {
  const problems = [];
  const design = path.join(root, state.designPath);
  let content = "";
  try {
    content = await readFile(design, "utf8");
  } catch {
    problems.push(`Missing ${state.designPath}`);
  }
  const section = (...names) => sectionBody(content, ...names);
  const plan = section("Implementation Plan", "Thin Vertical Slices");
  const placeholders = new Set([
    "Order thin vertical slices by observable behavior; include code, boundary work, and tests in each slice.",
    "Order diagnosis lock-in, correction, boundary updates, and verification as observable slices.",
    "Order thin vertical slices by observable behavior. For each slice, name its outcome, likely code areas, boundary or data changes, tests, dependencies, and completion signal.",
    "Order diagnosis lock-in, correction, boundary updates, and verification as observable slices. For each slice, name likely code areas, tests, dependencies, and completion signal.",
    "Use `### Slice N: <observable outcome>` subsections. Every slice must include `Outcome`, `Entry point`, `Core behavior`, `Boundary integration`, `Tests`, and `Complete when`. A slice crosses all layers needed for runnable behavior; domain-only, persistence-only, transport-only, and wiring-only phases are not vertical slices.",
    "Use `### Slice N: <observable outcome>` subsections. Every slice must include `Outcome`, `Entry point`, `Core behavior`, `Boundary integration`, `Tests`, and `Complete when`. Keep the regression lock-in observable and make correction slices runnable across every affected layer."
  ]);
  if (!plan) problems.push("Missing Implementation Plan section");
  else if (placeholders.has(plan)) problems.push("Complete the Implementation Plan before developer review");
  else {
    const headings = [...plan.matchAll(/^### (.+)$/gm)].map(match => match[1]);
    const invalidHeadings = headings.filter(heading => !/^Slice \d+: \S/.test(heading));
    if (invalidHeadings.length) problems.push(`Implementation Plan contains non-slice headings: ${invalidHeadings.join(", ")}`);
    const numbers = headings.filter(heading => /^Slice \d+: \S/.test(heading)).map(heading => Number(heading.match(/^Slice (\d+):/)[1]));
    if (numbers.some((number, index) => number !== index + 1)) {
      problems.push("Implementation Plan slice numbers must start at 1 and be sequential");
    }
    const slices = [...plan.matchAll(/(?:^|\n)### Slice \d+: [^\n]+\n([\s\S]*?)(?=\n### Slice \d+: |$)/g)];
    if (!slices.length) problems.push("Implementation Plan must use ### Slice N: <observable outcome> subsections");
    const fields = ["Outcome", "Entry point", "Core behavior", "Boundary integration", "Tests", "Complete when"];
    for (const [index, slice] of slices.entries()) {
      const missing = fields.filter(field => !new RegExp(`^- ${field}:\\s*\\S`, "mi").test(slice[1]));
      if (missing.length) problems.push(`Implementation slice ${index + 1} is missing: ${missing.join(", ")}`);
    }
    if (state.artifactFormat >= 2) {
      for (const slice of implementationSlices(content)) {
        if (!Array.isArray(slice.acceptanceCommand) || !slice.acceptanceCommand.length
          || slice.acceptanceCommand.some(value => typeof value !== "string" || !value)) {
          problems.push(`Implementation slice ${slice.number} requires Acceptance command as a non-empty JSON string array`);
        }
      }
    }
  }
  const requiredSections = [
    ["Requirements Traceability", [
      "List each explicit source requirement and point to the use case, rule, interface, test, or non-goal that addresses it. Do not silently drop requirements during refinement.",
      "List each explicit source requirement and point to the reproduction, rule, interface, regression test, or non-goal that addresses it. Do not silently narrow the requested correction."
    ]],
    ["Boundaries and Dependencies", [
      "Name each responsibility and dependency direction. For storage, transport, clocks, identity, messaging, and external services, state the inward-owned contract, outward adapter, composition point, transaction/data ownership, and failure behavior. Justify any direct infrastructure dependency.",
      "Name affected responsibilities and dependency direction. For storage, transport, clocks, identity, messaging, and external services, state the inward-owned contract, outward adapter, composition point, transaction/data ownership, and failure behavior. Justify any direct infrastructure dependency."
    ]],
    ["Abstraction and Extension Pressure|Correction and Extension Pressure", [
      "List each abstraction, its owner, behavioral contract, consumers, implementations, and test strategy. Prefer a narrow inward-owned port at meaningful infrastructure or domain boundaries even with one implementation. Record why any such boundary stays concrete.",
      "Describe the correction at the rule-owning level. List affected abstractions and contracts; prefer a narrow inward-owned port where the defect exposes an infrastructure or domain boundary. Record related extension pressure without generic layering."
    ]]
  ];
  for (const [names, untouched] of requiredSections) {
    const body = section(...names.split("|"));
    if (!body || untouched.includes(body)) problems.push(`Complete the ${names.split("|")[0]} section before developer review`);
  }
  const conformance = section("Implementation Conformance");
  if (requireConformance || ["baseline-sealed", "quality-critic", "quality-remediation", "quality-verifier", "ready-to-commit", "complete"].includes(state.phase)) {
    const part = name => conformance?.match(new RegExp(`^### ${name}\\s*\\n([\\s\\S]*?)(?=\\n### |(?![\\s\\S]))`, "m"))?.[1] || "";
    const architecture = part("Architecture Decisions");
    const sliceEvidence = part("Slice Completion");
    const completeFields = (body, fields) => fields.every(field => new RegExp(`^- ${field}:\\s*\\S`, "mi").test(body));
    if (!completeFields(architecture, ["Decision", "Implementation", "Verification"])
      || (state.artifactFormat !== 2 && !completeFields(sliceEvidence, ["Slice", "Implementation", "Verification"]))) {
      problems.push("Complete Implementation Conformance with architecture-decision and slice-completion evidence before quality review");
    }
    if (state.artifactFormat >= 2) {
      const planned = implementationSlices(content);
      const requiredNumbers = conformanceSliceNumbers || planned.map(slice => slice.number);
      const records = [...sliceEvidence.matchAll(/(?:^|\n)#### Slice (\d+): ([^\n]+)\n([\s\S]*?)(?=\n#### |$)/g)].map(match => ({
        number: Number(match[1]),
        title: match[2].trim(),
        body: match[3]
      }));
      const headings = [...sliceEvidence.matchAll(/^#### (.+)$/gm)].map(match => match[1]);
      const invalid = headings.filter(heading => !/^Slice \d+: \S/.test(heading));
      if (invalid.length) problems.push(`Slice Completion contains invalid headings: ${invalid.join(", ")}`);
      if (new Set(records.map(record => record.number)).size !== records.length) {
        problems.push("Slice Completion must contain at most one record for each slice");
      }
      for (const number of requiredNumbers) {
        const expected = planned.find(slice => slice.number === number);
        const record = records.find(item => item.number === number);
        if (!expected || !record) {
          problems.push(`Complete Implementation Conformance for Slice ${number} before recording its completion`);
          continue;
        }
        if (record.title !== expected.title) problems.push(`Slice ${number} conformance title must exactly match the reviewed plan`);
        if (!completeFields(record.body, ["Implementation", "Verification"])) {
          problems.push(`Slice ${number} conformance requires Implementation and Verification evidence`);
        }
      }
      for (const record of records) {
        if (!planned.some(slice => slice.number === record.number)) problems.push(`Slice Completion references unknown Slice ${record.number}`);
        if (conformanceSliceNumbers && !requiredNumbers.includes(record.number)) {
          problems.push(`Do not claim Slice ${record.number} completion before it is the active slice`);
        }
      }
    }
  }
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
