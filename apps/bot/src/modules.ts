import type { AnyModule } from '@bot/core';
import general from '@bot/module-general';

/** Модули, которые загружает бот. Порядок задаёт порядок вызова обработчиков. */
export const modules: AnyModule[] = [general];
