import type { AnyModule } from '@bot/core';
import autoroles from '@bot/module-autoroles';
import general from '@bot/module-general';
import moderation from '@bot/module-moderation';
import welcome from '@bot/module-welcome';

/**
 * Модули платформы — единый список для бота, API и воркера.
 * Порядок задаёт порядок вызова обработчиков событий.
 */
export const modules: AnyModule[] = [general, welcome, autoroles, moderation];
