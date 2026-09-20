import type { ProjectRecord, TaskRecord } from "./types";

function metaParts(project: ProjectRecord, order: Array<"area" | "goal" | "status" | "deadline">): string[] {
  const parts: string[] = [];
  for (const key of order) {
    if (key === "area" && project.area) parts.push(`Area: ${project.area}`);
    if (key === "goal" && project.goalName) parts.push(`Goal: ${project.goalName}`);
    if (key === "status" && project.status) parts.push(`Status: ${project.status}`);
    if (key === "deadline" && project.deadline) parts.push(`Deadline: ${project.deadline}`);
  }
  return parts;
}

function formatProjectHeader(project: ProjectRecord, order: Array<"area" | "goal" | "status" | "deadline">): string {
  const parts = metaParts(project, order);
  return parts.length ? `${project.name} — ${parts.join("; ")}` : project.name;
}

export function formatProjectList(projects: ProjectRecord[]): string {
  if (projects.length === 0) return "Belum ada project di LIFE OS.";
  return projects
    .map((p) => `• ${formatProjectHeader(p, ["area", "goal", "status", "deadline"])}`)
    .join("\n");
}

export function formatProjectStatus(
  project: ProjectRecord,
  openTasks: TaskRecord[],
): string {
  const header = formatProjectHeader(project, ["area", "status", "deadline", "goal"]);
  if (openTasks.length === 0) {
    return `${header}\nTidak ada task terbuka.`;
  }
  const lines = openTasks.map((t) => {
    const base = `- [${t.priority}] ${t.task}`;
    return t.due ? `${base} — ${t.due}` : base;
  });
  return [header, "Task terbuka:", ...lines].join("\n");
}

const TANPA_PROJECT = "Tanpa project";

export function formatTasksGroupedByProject(tasks: TaskRecord[]): string {
  if (tasks.length === 0) return "";

  const groups = new Map<string, TaskRecord[]>();
  for (const t of tasks) {
    const trimmed = t.projectName?.trim() ?? "";
    const key = trimmed || TANPA_PROJECT;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const namedKeys = [...groups.keys()]
    .filter((k) => k !== TANPA_PROJECT)
    .sort((a, b) => a.localeCompare(b));
  const keys = groups.has(TANPA_PROJECT) ? [...namedKeys, TANPA_PROJECT] : namedKeys;

  const sections: string[] = [];
  for (const key of keys) {
    const items = groups.get(key)!;
    sections.push(`## ${key}`);
    for (const t of items) {
      sections.push(t.due ? `- ${t.task} (Jatuh tempo: ${t.due})` : `- ${t.task}`);
    }
  }
  return sections.join("\n");
}
