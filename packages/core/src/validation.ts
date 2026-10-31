import type { GuildChannel, GuildRole } from '@bot/contracts';

/** Guild data for config validation — from the Redis snapshot. */
export interface GuildEntities {
  channels: GuildChannel[];
  roles: GuildRole[];
}

export interface ConfigIssue {
  path: (string | number)[];
  message: string;
  action?: string;
  severity?: 'error' | 'warning';
}

/** discord.js channel types the bot can post messages to. */
export const TEXT_CHANNEL_TYPES = [0, 5, 10, 11, 12, 15] as const;

/**
 * Helper for `validateConfig`: collects issues with channel and role references.
 * `null`/`undefined` are skipped — "not selected" is checked by the module schema.
 */
export class EntityChecker {
  readonly issues: ConfigIssue[] = [];
  private readonly channelById: Map<string, GuildChannel>;
  private readonly roleById: Map<string, GuildRole>;

  constructor(guild: GuildEntities) {
    this.channelById = new Map(guild.channels.map((c) => [c.id, c]));
    this.roleById = new Map(guild.roles.map((r) => [r.id, r]));
  }

  textChannel(id: string | null | undefined, path: ConfigIssue['path']): this {
    if (!id) return this;
    const channel = this.channelById.get(id);
    if (!channel) {
      this.issues.push({
        path,
        message: `Channel ${id} not found`,
        action: 'Select an existing channel in server settings',
        severity: 'error',
      });
    } else if (!(TEXT_CHANNEL_TYPES as readonly number[]).includes(channel.type)) {
      this.issues.push({
        path,
        message: `Channel ${id} is not a text channel`,
        action: 'Choose a text channel instead of a voice or category channel',
        severity: 'error',
      });
    } else if (channel.canSend === false) {
      this.issues.push({
        path,
        message: `Bot lacks permission to send messages in #${channel.name}`,
        action: `Grant the bot Send Messages and View Channel permissions in #${channel.name}`,
        severity: 'error',
      });
    }
    return this;
  }

  /**
   * A role the bot can assign: exists, is below the bot's role, is not managed by an integration and carries no
   * moderator permissions — whoever may configure the bot could otherwise hand those out to themselves.
   */
  assignableRole(id: string | null | undefined, path: ConfigIssue['path']): this {
    if (!id) return this;
    const role = this.roleById.get(id);
    if (!role) {
      this.issues.push({
        path,
        message: `Role ${id} not found`,
        action: 'Select an existing role in server settings',
        severity: 'error',
      });
    } else if (role.elevated) {
      this.issues.push({
        path,
        message: `Role ${role.name} has moderator permissions — the bot does not hand it out`,
        action: `Use a dedicated member role without administrator or moderation permissions`,
        severity: 'error',
      });
    } else if (!role.manageable) {
      this.issues.push({
        path,
        message: `The bot cannot assign role ${role.name}`,
        action: `In Discord Server Settings → Roles, drag the bot's role above @${role.name}`,
        severity: 'error',
      });
    }
    return this;
  }

  role(id: string | null | undefined, path: ConfigIssue['path']): this {
    if (id && !this.roleById.has(id)) {
      this.issues.push({
        path,
        message: `Role ${id} not found`,
        action: 'Select an existing role in server settings',
        severity: 'error',
      });
    }
    return this;
  }

  roles(ids: readonly string[], path: ConfigIssue['path'], { assignable = false } = {}): this {
    ids.forEach((id, i) => (assignable ? this.assignableRole(id, [...path, i]) : this.role(id, [...path, i])));
    return this;
  }

  channels(ids: readonly string[], path: ConfigIssue['path']): this {
    ids.forEach((id, i) => {
      if (!this.channelById.has(id)) {
        this.issues.push({
          path: [...path, i],
          message: `Channel ${id} not found`,
          action: 'Select an existing channel in server settings',
          severity: 'error',
        });
      }
    });
    return this;
  }
}
