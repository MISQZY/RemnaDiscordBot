import type { AnyModule } from '@bot/core';
import general from '@bot/module-general';

/**
 * Модули платформы — единый список для бота, API и воркера.
 * Порядок задаёт порядок вызова обработчиков событий.
 */
export const modules: AnyModule[] = [general];
