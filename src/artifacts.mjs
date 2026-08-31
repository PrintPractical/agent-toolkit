import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sectionBody(content, ...names) {
  return content.match(new RegExp(`^## (?:${names.join("|")})\\s*\\n([\\s\\S]*?)(?=\\n## [^#]|(?![\\s\\S]))`, "m"))?.[1]?.trim();
}

function jsonField(body, name) {
  const value = body.match(new RegExp(`^- ${name}:\\s*(.+)$`, "mi"))?.[1]?.trim();
  if (!value) return undefined;
  try { return JSON.parse(value); } catch { return null; }
}

function completeFields(body, fields) {
  return fields.every(field => new RegExp(`^- ${field}:\\s*\\S`, "mi").test(body));
}

function table(body, headers) {
  const lines = (body || "").split("\n").map(line => line.trim());
  const cells = line => line.startsWith("|") && line.endsWith("|")
    ? line.slice(1, -1).split("|").map(cell => cell.trim())
    : null;
  const headerIndex = lines.findIndex(line => {
    const row = cells(line);
    return row?.length === headers.length && row.every((cell, index) => cell === headers[index]);
  });
  const separator = cells(lines[headerIndex + 1] || "");
  if (headerIndex < 0 || separator?.length !== headers.length || !separator.every(cell => /^:?-{3,}:?$/.test(cell))) {
    return { rows: [], malformed: false };
  }
  const records = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line) break;
    records.push(cells(line));
  }
  return {
    rows: records.filter(row => row?.length === headers.length && row.some(cell => cell)),
    malformed: records.some(row => row?.length !== headers.length)
  };
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

const responsibilityHeaders = ["Owner", "Responsibility", "Rules / Decisions", "Architectural Role", "Depends On", "Used By", "Existing/New", "Reuse Decision"];
const architectureMapHeaders = ["Owner", "Expected Placement", "Placement Constraints", "Slices"];
const responsibilityPlaceholder = ["Name", "Behavior, state, or integration owned", "Invariants and decisions, or None", "Role or boundary from project instructions", "Owners or external dependencies, or None", "Consumers, or None", "Existing/New", "DECISION: inspected evidence; rationale"];
const architectureMapPlaceholder = ["Exact owner from decomposition", "New, modified, moved, or existing module/file", "Governing organization, boundary, and dependency constraints", "[1]"];

export function responsibilityDecomposition(content) {
  const body = sectionBody(content, "Responsibility Decomposition") || "";
  return table(body, responsibilityHeaders).rows.filter(row => row.some((value, index) => value !== responsibilityPlaceholder[index])).map(row => ({
    owner: row[0],
    responsibility: row[1],
    rules: row[2],
    role: row[3],
    dependsOn: row[4],
    usedBy: row[5],
    existence: row[6],
    reuseDecision: row[7]
  }));
}

export function responsibilityArchitectureMap(content) {
  const body = sectionBody(content, "Responsibility and Architecture Map") || "";
  return table(body, architectureMapHeaders).rows.filter(row => row.some((value, index) => value !== architectureMapPlaceholder[index])).map(row => ({
    owner: row[0],
    placement: row[1],
    constraints: row[2],
    slices: parseJson(row[3])
  }));
}

export function projectRequirements(content) {
  const body = sectionBody(content, "Required Outcomes") || "";
  return [...body.matchAll(/(?:^|\n)### Requirement (REQ-(\d+)): ([^\n]+)\n([\s\S]*?)(?=\n### |$)/g)].map(match => ({
    id: match[1],
    number: Number(match[2]),
    title: match[3].trim(),
    body: match[4]
  }));
}

export function projectMilestones(content) {
  const body = sectionBody(content, "Roadmap") || "";
  return [...body.matchAll(/(?:^|\n)### Milestone (\d+): ([^\n]+)\n([\s\S]*?)(?=\n### |$)/g)].map(match => ({
    number: Number(match[1]),
    title: match[2].trim(),
    body: match[3],
    kind: match[3].match(/^- Kind:\s*(feature|fix)\s*$/mi)?.[1],
    requirements: jsonField(match[3], "Requirements"),
    dependencies: jsonField(match[3], "Dependencies"),
    status: match[3].match(/^- Status:\s*(\S+)\s*$/mi)?.[1]
  }));
}

export function projectIntegrationCommands(content) {
  return jsonField(sectionBody(content, "Final Integration") || "", "Acceptance commands");
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
      owners: jsonField(match[3], "Owners"),
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

export async function renderProject(root, { title, slug, sources = [] }) {
  const template = await readFile(path.join(packageRoot, "templates", "project.md.tmpl"), "utf8");
  const sourceLines = sources.length ? sources.map(source => `- \`${source.path}\` (sha256: \`${source.fingerprint}\`)`).join("\n") : "- None.";
  const rendered = template.replaceAll("{{TITLE}}", title).replaceAll("{{SLUG}}", slug).replace("{{SOURCES}}", sourceLines);
  const directory = path.join(root, ".agent", "projects");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${slug}.md`);
  try {
    await readFile(file);
    throw new Error(`Project already exists: .agent/projects/${slug}.md`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(file, rendered);
  return file;
}

export async function sourceRecords(root, files) {
  const records = [];
  const repository = await realpath(root);
  for (const file of files) {
    const source = await realpath(path.resolve(root, file));
    const relative = path.relative(repository, source).split(path.sep).join("/");
    if (!relative || relative === ".." || relative.startsWith("../")) throw new Error(`Project source must be inside the repository: ${file}`);
    const content = await readFile(source);
    records.push({ path: relative, fingerprint: createHash("sha256").update(content).digest("hex") });
  }
  return records;
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

async function validateProject(root, state, { requireProjectCompletion = false } = {}) {
  const problems = [];
  let content = "";
  try { content = await readFile(path.join(root, state.projectPath || state.designPath), "utf8"); }
  catch { return [`Missing ${state.projectPath || state.designPath}`]; }
  const required = ["Outcome", "Non-goals", "Source Material", "Required Outcomes", "Known Constraints", "Quality Attributes", "Decisions and Hypotheses", "Roadmap", "Requirement Coverage", "Discoveries", "Completion Criteria", "Final Integration"];
  for (const name of required) if (!sectionBody(content, name)) problems.push(`Complete the ${name} section before project review`);
  const placeholders = new Map([
    ["Outcome", "State the observable project outcome, intended users, and how success is recognized."],
    ["Non-goals", "List intentionally excluded outcomes, users, migrations, and operational scope."],
    ["Required Outcomes", "Use `### Requirement REQ-N: <observable outcome>` subsections. Each requires `Outcome` and `Acceptance`."],
    ["Known Constraints", "Record binding product, technical, operational, security, regulatory, compatibility, time, and budget constraints."],
    ["Quality Attributes", "State measurable reliability, performance, security, accessibility, operability, and maintainability expectations that apply."],
    ["Roadmap", "Use `### Milestone N: <independently deliverable outcome>` subsections. Each requires `Kind`, `Outcome`, `Requirements`, `Dependencies`, and `Status`. `Requirements` is a JSON string array of requirement IDs, `Dependencies` is a JSON integer array, and `Status` is `provisional`, `active`, `complete`, `blocked`, or `removed`."],
    ["Requirement Coverage", "Use one `- REQ-N:` record per requirement. Map planned milestones and record each delivery as `Milestone N ... complete` with current evidence, preserving future milestone assignments."],
    ["Completion Criteria", "State the binding project-wide conditions for declaring the intended outcome complete."]
  ]);
  for (const [name, placeholder] of placeholders) {
    if (sectionBody(content, name) === placeholder) problems.push(`Complete the ${name} section before project review`);
  }
  for (const source of state.sources || []) {
    try {
      const current = createHash("sha256").update(await readFile(path.join(root, source.path))).digest("hex");
      if (current !== source.fingerprint) problems.push(`Project source changed since ingestion: ${source.path}`);
    } catch {
      problems.push(`Missing project source: ${source.path}`);
    }
  }
  const requirements = projectRequirements(content);
  if (!requirements.length) problems.push("Required Outcomes must use ### Requirement REQ-N: <observable outcome> subsections");
  if (requirements.some((item, index) => item.number !== index + 1)) problems.push("Project requirement numbers must start at 1 and be sequential");
  for (const requirement of requirements) if (!completeFields(requirement.body, ["Outcome", "Acceptance"])) problems.push(`${requirement.id} requires Outcome and Acceptance`);
  const milestones = projectMilestones(content);
  if (!milestones.length) problems.push("Roadmap must use ### Milestone N: <independently deliverable outcome> subsections");
  if (milestones.some((item, index) => item.number !== index + 1)) problems.push("Project milestone numbers must start at 1 and be sequential");
  const knownRequirements = new Set(requirements.map(item => item.id));
  const knownMilestones = new Set(milestones.map(item => item.number));
  const covered = new Set();
  for (const milestone of milestones) {
    if (!completeFields(milestone.body, ["Kind", "Outcome", "Requirements", "Dependencies", "Status"])) problems.push(`Milestone ${milestone.number} requires Kind, Outcome, Requirements, Dependencies, and Status`);
    if (!milestone.kind) problems.push(`Milestone ${milestone.number} Kind must be feature or fix`);
    if (!Array.isArray(milestone.requirements) || !milestone.requirements.length || milestone.requirements.some(id => typeof id !== "string" || !knownRequirements.has(id))) problems.push(`Milestone ${milestone.number} Requirements must be a non-empty JSON array of known requirement IDs`);
    else if (milestone.status !== "removed") for (const id of milestone.requirements) covered.add(id);
    if (!Array.isArray(milestone.dependencies) || milestone.dependencies.some(number => !Number.isInteger(number) || !knownMilestones.has(number) || number >= milestone.number)) problems.push(`Milestone ${milestone.number} Dependencies must be a JSON array of earlier milestone numbers`);
    if (!["provisional", "active", "complete", "blocked", "removed"].includes(milestone.status)) problems.push(`Milestone ${milestone.number} has an invalid Status`);
  }
  for (const requirement of requirements) if (!covered.has(requirement.id)) problems.push(`${requirement.id} is not covered by a roadmap milestone`);
  const coverage = sectionBody(content, "Requirement Coverage") || "";
  for (const requirement of requirements) if (!new RegExp(`(^|\\n)[-*]\\s+${requirement.id}:\\s*\\S`).test(coverage)) problems.push(`Requirement Coverage must include ${requirement.id}`);
  const questions = sectionBody(content, "Risks and Open Questions");
  if (!questions || !/^[-*]\s+(None\.|None|No open questions\.?)$/i.test(questions)) problems.push("Material project questions remain");
  const decisions = sectionBody(content, "Decisions and Hypotheses") || "";
  if (!/^[-*]\s+None\.?$/i.test(decisions)) {
    const records = decisions.split("\n").map(line => line.trim()).filter(Boolean);
    if (!records.length || records.some(line => !/^[-*]\s+\[(observed|committed|hypothesis|rejected)\]\s+\S/i.test(line))) {
      problems.push("Decisions and Hypotheses must use a supported status on every record");
    }
  }
  if (requireProjectCompletion) {
    const incomplete = milestones.filter(item => !["complete", "removed"].includes(item.status));
    if (incomplete.length) problems.push(`Complete or remove every roadmap milestone before final integration: ${incomplete.map(item => item.number).join(", ")}`);
    const completedCoverage = new Set(milestones.filter(item => item.status === "complete").flatMap(item => Array.isArray(item.requirements) ? item.requirements : []));
    for (const requirement of requirements) if (!completedCoverage.has(requirement.id)) problems.push(`${requirement.id} is not delivered by a completed milestone`);
    const integration = sectionBody(content, "Final Integration") || "";
    const commands = projectIntegrationCommands(content);
    if (!Array.isArray(commands) || !commands.length || commands.some(command => !Array.isArray(command) || !command.length || command.some(value => typeof value !== "string" || !value))) problems.push("Final Integration Acceptance commands must be a non-empty JSON array of non-empty string arrays");
    if (/^- Assessment:\s*Complete before final project review\.\s*$/mi.test(integration) || !/^- Assessment:\s*\S/mi.test(integration)) problems.push("Complete the Final Integration assessment before final project review");
  }
  return problems;
}

export async function validateArtifacts(root, state, { requireSystem = false, requireConformance = false, conformanceSliceNumbers, requireProjectCompletion = false } = {}) {
  if (state.type === "project") {
    const problems = await validateProject(root, state, { requireProjectCompletion });
    if (requireSystem) {
      try { await readFile(path.join(root, ".agent", "SYSTEM.md"), "utf8"); } catch { problems.push("Missing .agent/SYSTEM.md; create the minimum relevant system map"); }
    }
    return problems;
  }
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
    "Use `### Slice N: <observable outcome>` subsections. Every slice must include `Outcome`, `Entry point`, `Core behavior`, `Boundary integration`, `Tests`, and `Complete when`. A slice includes all work needed for runnable behavior; phase-only work is not a vertical slice.",
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
    const fields = ["Outcome", "Owners", "Entry point", "Core behavior", "Boundary integration", "Tests", "Complete when"];
    for (const [index, slice] of slices.entries()) {
      const missing = fields.filter(field => !new RegExp(`^- ${field}:\\s*\\S`, "mi").test(slice[1]));
      if (missing.length) problems.push(`Implementation slice ${index + 1} is missing: ${missing.join(", ")}`);
    }
    for (const slice of implementationSlices(content)) {
      if (!Array.isArray(slice.owners) || !slice.owners.length
        || slice.owners.some(value => typeof value !== "string" || !value)
        || new Set(slice.owners).size !== slice.owners.length) {
        problems.push(`Implementation slice ${slice.number} requires Owners as a non-empty JSON array of unique owner names`);
      }
      if (!Array.isArray(slice.acceptanceCommand) || !slice.acceptanceCommand.length
        || slice.acceptanceCommand.some(value => typeof value !== "string" || !value)) {
        problems.push(`Implementation slice ${slice.number} requires Acceptance command as a non-empty JSON string array`);
      }
    }
  }
  const requiredSections = [
    ["Requirements Traceability", [
      "List each explicit source requirement and point to the use case, rule, interface, test, or non-goal that addresses it. Do not silently drop requirements during refinement.",
      "List each explicit source requirement and point to the reproduction, rule, interface, regression test, or non-goal that addresses it. Do not silently narrow the requested correction."
    ]],
    ["Abstraction and Extension Pressure|Correction and Extension Pressure", [
      "List each needed abstraction, its purpose, consumers, implementations, and test strategy. Record why a concrete dependency is appropriate when it constrains future change.",
      "Describe the correction at the rule-owning location. List affected abstractions and contracts, and record related extension pressure without generic layering."
    ]]
  ];
  for (const [names, untouched] of requiredSections) {
    const body = section(...names.split("|"));
    if (!body || untouched.includes(body)) problems.push(`Complete the ${names.split("|")[0]} section before developer review`);
  }
  const responsibilities = responsibilityDecomposition(content);
  const responsibilityBody = section("Responsibility Decomposition");
  if (table(responsibilityBody, responsibilityHeaders).malformed) problems.push("Responsibility Decomposition contains a malformed table row");
  if (!responsibilityBody || !responsibilities.length) {
    problems.push(`Responsibility Decomposition must use: ${responsibilityHeaders.join(" | ")}`);
  }
  const ownerNames = responsibilities.map(item => item.owner);
  if (new Set(ownerNames).size !== ownerNames.length) problems.push("Responsibility Decomposition owner names must be unique");
  for (const item of responsibilities) {
    if (Object.values(item).some(value => !value)) problems.push(`Responsibility Decomposition row ${item.owner || "<unnamed>"} has an empty field`);
    if (!["Existing", "New"].includes(item.existence)) problems.push(`${item.owner || "Responsibility owner"} Existing/New must be Existing or New`);
    if (!/^(REUSE|EXTEND|REFACTOR|NEW):\s+\S[^;]*;\s+\S/.test(item.reuseDecision)) {
      problems.push(`${item.owner || "Responsibility owner"} Reuse Decision must be REUSE, EXTEND, REFACTOR, or NEW with inspected evidence and rationale`);
    }
  }
  const architecture = responsibilityArchitectureMap(content);
  const architectureBody = section("Responsibility and Architecture Map");
  if (table(architectureBody, architectureMapHeaders).malformed) problems.push("Responsibility and Architecture Map contains a malformed table row");
  if (!architectureBody || !architecture.length) {
    problems.push(`Responsibility and Architecture Map must use: ${architectureMapHeaders.join(" | ")}`);
  }
  const mappedOwners = architecture.map(item => item.owner);
  if (new Set(mappedOwners).size !== mappedOwners.length) problems.push("Responsibility and Architecture Map owner names must be unique");
  for (const owner of ownerNames) if (!mappedOwners.includes(owner)) problems.push(`Responsibility and Architecture Map is missing owner: ${owner}`);
  for (const owner of mappedOwners) if (!ownerNames.includes(owner)) problems.push(`Responsibility and Architecture Map references unknown owner: ${owner}`);
  const slices = implementationSlices(content);
  const sliceNumbers = new Set(slices.map(slice => slice.number));
  for (const item of architecture) {
    if (!item.owner || !item.placement || !item.constraints) problems.push(`Responsibility and Architecture Map row ${item.owner || "<unnamed>"} has an empty field`);
    if (!Array.isArray(item.slices) || !item.slices.length || item.slices.some(number => !Number.isInteger(number) || !sliceNumbers.has(number))) {
      problems.push(`${item.owner || "Responsibility owner"} Slices must be a non-empty JSON array of known slice numbers`);
    }
  }
  for (const slice of slices) {
    if (!Array.isArray(slice.owners)) continue;
    for (const owner of slice.owners) if (!ownerNames.includes(owner)) problems.push(`Implementation slice ${slice.number} references unknown owner: ${owner}`);
  }
  for (const owner of ownerNames) {
    const mapped = architecture.find(item => item.owner === owner)?.slices;
    if (!Array.isArray(mapped)) continue;
    const referenced = slices.filter(slice => Array.isArray(slice.owners) && slice.owners.includes(owner)).map(slice => slice.number);
    if (JSON.stringify([...mapped].sort((a, b) => a - b)) !== JSON.stringify(referenced)) {
      problems.push(`${owner} slice coverage must match between the responsibility map and Implementation Plan`);
    }
  }
  const decompositionIndex = content.indexOf("## Responsibility Decomposition");
  const architectureIndex = content.indexOf("## Responsibility and Architecture Map");
  const planIndex = content.indexOf("## Implementation Plan");
  if (!(decompositionIndex >= 0 && architectureIndex > decompositionIndex && planIndex > architectureIndex)) {
    problems.push("Responsibility decomposition must precede architecture placement, which must precede implementation slices");
  }
  const conformance = section("Implementation Conformance");
  if (requireConformance || ["baseline-sealed", "quality-critic", "quality-remediation", "quality-verifier", "review-escalation", "ready-to-commit", "complete"].includes(state.phase)) {
    const part = name => conformance?.match(new RegExp(`^### ${name}\\s*\\n([\\s\\S]*?)(?=\\n### |(?![\\s\\S]))`, "m"))?.[1] || "";
    const architecture = part("Architecture Decisions");
    const sliceEvidence = part("Slice Completion");
    const completeFields = (body, fields) => fields.every(field => new RegExp(`^- ${field}:\\s*\\S`, "mi").test(body));
    if (!completeFields(architecture, ["Decision", "Owners", "Implementation", "Verification"])) {
      problems.push("Complete Implementation Conformance with architecture-decision and slice-completion evidence before quality review");
    }
    const conformanceOwners = jsonField(architecture, "Owners");
    if (!Array.isArray(conformanceOwners) || new Set(conformanceOwners).size !== conformanceOwners.length
      || JSON.stringify([...conformanceOwners].sort()) !== JSON.stringify([...ownerNames].sort())) {
      problems.push("Implementation Conformance Owners must be a JSON array covering every reviewed responsibility owner exactly once");
    }
    {
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
