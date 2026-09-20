import type { LearningRecord } from "./types";

export type LearningMatchResult =
  | { kind: "none" }
  | { kind: "one"; skill: LearningRecord }
  | { kind: "ambiguous"; candidates: LearningRecord[] };

const NOTION_UUID_RE =
  /^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i;

function normalizeNotionId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

function looksLikeNotionId(query: string): boolean {
  return NOTION_UUID_RE.test(query) || /^[a-f0-9]{32}$/i.test(query);
}

/** Exact (ci) → then unique substring contains; 0→none, 1→one, 2+→ambiguous. Empty query → none.
 *  If query equals a skill.id (or looks like a Notion UUID matching an id), return that skill as one. */
export function matchLearning(query: string, skills: LearningRecord[]): LearningMatchResult {
  const q = query.trim();
  if (q === "") return { kind: "none" };

  const byExactId = skills.find((s) => s.id === q);
  if (byExactId) return { kind: "one", skill: byExactId };

  if (looksLikeNotionId(q)) {
    const norm = normalizeNotionId(q);
    const byNormId = skills.find((s) => normalizeNotionId(s.id) === norm);
    if (byNormId) return { kind: "one", skill: byNormId };
  }

  const lower = q.toLowerCase();

  const exact = skills.filter((s) => s.name.toLowerCase() === lower);
  if (exact.length === 1) return { kind: "one", skill: exact[0]! };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };

  const contains = skills.filter((s) => s.name.toLowerCase().includes(lower));
  if (contains.length === 0) return { kind: "none" };
  if (contains.length === 1) return { kind: "one", skill: contains[0]! };
  return { kind: "ambiguous", candidates: contains };
}

/** Case-insensitive exact name equality; substring matches do not count. */
export function findExactLearning(name: string, skills: LearningRecord[]): LearningRecord | null {
  const lower = name.trim().toLowerCase();
  if (!lower) return null;
  return skills.find((s) => s.name.toLowerCase() === lower) ?? null;
}
