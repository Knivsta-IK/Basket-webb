export function trainingMarkdown(name, notes, exercises) {
  if (exercises.length < 4 || exercises.length > 6) throw new Error('Ett träningspass ska ha 4–6 övningar.');
  if (exercises.some(e => !Number.isFinite(e.minutes) || e.minutes < 1 || e.minutes > 180)) throw new Error('Ange 1–180 minuter för varje övning.');
  const total = exercises.reduce((sum, e) => sum + e.minutes, 0);
  return `# ${name.trim() || 'Träningspass'}\n\n${exercises.length} övningar · ${total} minuter\n\n${notes.trim() ? `${notes.trim()}\n\n` : ''}${exercises.map((e, i) => `## ${i + 1}. ${e.title} · ${e.minutes} min\n\nKälla: ${e.path}\n\n${rebaseLinks(e.content, e.path).replace(/^#\s+.+\n?/, '').replace(/^(#{2,5})\s/gm, '#$1 ')}\n`).join('\n---\n\n')}`;
}

export function rebaseLinks(content, from) {
  return content.replace(/(!?\[[^\]]*\]\()([^\s)]+)([^)]*\))/g, (match, start, href, end) => {
    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return match;
    try {
      const url = new URL(href, `https://material.local/${from}`);
      return `${start}../${url.pathname.slice(1)}${url.search}${url.hash}${end}`;
    } catch { return match; }
  });
}
