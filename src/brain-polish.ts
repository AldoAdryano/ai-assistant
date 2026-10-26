export function looksLikeNewProject(userText: string): boolean {
  const text = userText.trim();
  if (!text) return false;
  if (/\b(stiker|sticker|resep|masak|masakan)\b/i.test(text)) return false;
  if (/\b(tugas|task|jadwalkan|deadline|tenggat)\b/i.test(text)) return false;
  if (/\b(besok|lusa)\b/i.test(text) || /\bjam\s+\d/i.test(text)) return false;
  return /\b(?:mau|pengen|ingin|rencana)\s+(?:bikin|buat|membangun|bangun)\s+\S+/i.test(text);
}

export function looksLikeAmbiguousStrategy(userText: string): boolean {
  if (looksLikeNewProject(userText)) return false;
  if (/\b(tugas|deadline|tenggat|jadwalkan)\b/i.test(userText)) return false;
  return (
    /\bstrategi\b/i.test(userText) ||
    /\bmulai dari mana\b/i.test(userText) ||
    /\b(?:harusnya|harus)\s+ngapain\b/i.test(userText) ||
    /\bngapain dulu\b/i.test(userText) ||
    /\barah\s+(?:karier|karir|proyek|hidup|minggu)\b/i.test(userText)
  );
}

export function applyBrainPolish<T extends { name: string }>(
  calls: T[],
  userText: string,
): { handled: boolean; allowed: T[]; clarifyMessage?: string } {
  const project = looksLikeNewProject(userText);
  const strategy = looksLikeAmbiguousStrategy(userText);
  if (!project && !strategy) return { handled: false, allowed: calls };

  const withoutTasks = calls.filter((call) => call.name !== "create_notion_task");
  if (withoutTasks.length === calls.length) return { handled: true, allowed: calls };

  if (project) {
    const hasProject = withoutTasks.some((call) => call.name === "create_notion_project");
    return {
      handled: true,
      allowed: withoutTasks,
      ...(hasProject
        ? {}
        : { clarifyMessage: "Itu project, bukan daftar tugas. Mau aku buatkan project-nya?" }),
    };
  }

  const hasNote = withoutTasks.some((call) => call.name === "create_notion_note");
  return {
    handled: true,
    allowed: withoutTasks,
    ...(hasNote
      ? {}
      : { clarifyMessage: "Masih ambigu. Mau dicatat di Inbox dulu, atau sebut satu langkah yang jelas?" }),
  };
}
