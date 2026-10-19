/** Опыт для перехода с уровня `level` на следующий (как у MEE6/JuniperBot). */
export function xpToNextLevel(level: number): number {
  return 5 * level ** 2 + 50 * level + 100;
}

/** Суммарный опыт, нужный для достижения уровня `level`. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let l = 0; l < level; l++) total += xpToNextLevel(l);
  return total;
}

export function levelFromXp(xp: number): number {
  let level = 0;
  let remaining = xp;
  while (remaining >= xpToNextLevel(level)) {
    remaining -= xpToNextLevel(level);
    level++;
  }
  return level;
}

/** Прогресс внутри текущего уровня — для карточки `/rank`. */
export function levelProgress(xp: number): { level: number; current: number; needed: number } {
  const level = levelFromXp(xp);
  return { level, current: xp - totalXpForLevel(level), needed: xpToNextLevel(level) };
}

export function progressBar(current: number, needed: number, width = 12): string {
  const filled = Math.min(width, Math.round((current / needed) * width));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}
