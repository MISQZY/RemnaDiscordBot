/** XP needed to go from `level` to the next one (as in MEE6/JuniperBot). */
export function xpToNextLevel(level: number): number {
  return 5 * level ** 2 + 50 * level + 100;
}

/** Total XP needed to reach `level`. */
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

/** Progress within the current level — for the `/rank` card. */
export function levelProgress(xp: number): { level: number; current: number; needed: number } {
  const level = levelFromXp(xp);
  return { level, current: xp - totalXpForLevel(level), needed: xpToNextLevel(level) };
}

export function progressBar(current: number, needed: number, width = 12): string {
  const filled = Math.min(width, Math.round((current / needed) * width));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}
