import type { GoalRecord } from "./types";

export type GoalMatchResult =
  | { kind: "none" }
  | { kind: "one"; goal: GoalRecord }
  | { kind: "ambiguous"; candidates: GoalRecord[] };

const NOTION_UUID_RE =
  /^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i;

function normalizeNotionId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

function looksLikeNotionId(query: string): boolean {
  return NOTION_UUID_RE.test(query) || /^[a-f0-9]{32}$/i.test(query);
}

/** Exact (ci) → then unique substring contains; 0→none, 1→one, 2+→ambiguous. Empty query → none.
 *  If query equals a goal.id (or looks like a Notion UUID matching an id), return that goal as one. */
export function matchGoal(query: string, goals: GoalRecord[]): GoalMatchResult {
  const q = query.trim();
  if (q === "") return { kind: "none" };

  const byExactId = goals.find((g) => g.id === q);
  if (byExactId) return { kind: "one", goal: byExactId };

  if (looksLikeNotionId(q)) {
    const norm = normalizeNotionId(q);
    const byNormId = goals.find((g) => normalizeNotionId(g.id) === norm);
    if (byNormId) return { kind: "one", goal: byNormId };
  }

  const lower = q.toLowerCase();

  const exact = goals.filter((g) => g.name.toLowerCase() === lower);
  if (exact.length === 1) return { kind: "one", goal: exact[0]! };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };

  const contains = goals.filter((g) => g.name.toLowerCase().includes(lower));
  if (contains.length === 0) return { kind: "none" };
  if (contains.length === 1) return { kind: "one", goal: contains[0]! };
  return { kind: "ambiguous", candidates: contains };
}

/** Case-insensitive exact name equality; substring matches do not count. */
export function findExactGoal(name: string, goals: GoalRecord[]): GoalRecord | null {
  const lower = name.trim().toLowerCase();
  if (!lower) return null;
  return goals.find((g) => g.name.toLowerCase() === lower) ?? null;
}
