import { SecretBox } from '@bot/core';

let box: SecretBox | undefined;

/** Seals the module's secrets: API sources' addresses and keys, webhook tokens. Made on first use, from the environment. */
export const secrets = (): SecretBox => (box ??= SecretBox.fromEnv());
