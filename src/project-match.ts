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
