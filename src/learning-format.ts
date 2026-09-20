import type { LearningRecord } from "./types";

function formatSkillLine(skill: LearningRecord): string {
  const parts: string[] = [];
  if (skill.area) parts.push(`Area: ${skill.area}`);
  if (skill.level !== undefined && skill.level !== null && skill.level !== "") {
    parts.push(`Level: ${skill.level}`);
  }
  if (skill.status) parts.push(`Status: ${skill.status}`);
  return parts.length ? `• ${skill.name} — ${parts.join("; ")}` : `• ${skill.name}`;
}

export function formatLearningList(skills: LearningRecord[]): string {
  if (skills.length === 0) return "Belum ada skill di Learning.";
  return skills.map(formatSkillLine).join("\n");
}
