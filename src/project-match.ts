import type { ProjectRecord } from "./types";

export type ProjectMatchResult =
  | { kind: "none" }
  | { kind: "one"; project: ProjectRecord }
  | { kind: "ambiguous"; candidates: ProjectRecord[] };

/** Exact (ci) → then unique substring contains; 0→none, 1→one, 2+→ambiguous. Empty query → none. */
export function matchProject(query: string, projects: ProjectRecord[]): ProjectMatchResult {
  const q = query.trim();
  if (q === "") return { kind: "none" };

  const lower = q.toLowerCase();

  const exact = projects.filter((p) => p.name.toLowerCase() === lower);
  if (exact.length === 1) return { kind: "one", project: exact[0]! };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };

  const contains = projects.filter((p) => p.name.toLowerCase().includes(lower));
  if (contains.length === 0) return { kind: "none" };
  if (contains.length === 1) return { kind: "one", project: contains[0]! };
  return { kind: "ambiguous", candidates: contains };
}

/**
 * Pull a project name from user text when they said "untuk/ke/di project X".
 * Returns null for "tanpa project" or when no mention.
 */
export function extractProjectMention(userText: string): string | null {
  const normalized = userText.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (/\btanpa\s+project\b/i.test(normalized)) return null;
  const m =
    normalized.match(/\b(?:untuk|ke|di)\s+project\s+(.+)$/i) ||
    normalized.match(/\bproject\s+(.+)$/i);
  if (!m?.[1]) return null;
  let name = m[1].trim();
  name = name.replace(/[,.].*$/, "").trim();
  name = name.replace(/\s+(deadline|tenggat|due|jam|prioritas|priority)\b.*$/i, "").trim();
  return name || null;
}
