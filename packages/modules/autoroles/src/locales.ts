import type { Locale } from '@bot/contracts';
import type { Dictionary } from '@bot/i18n';

export const locales: Record<Locale, Dictionary> = {
  ru: {
    commands: {
      autoroles: {
        description: 'Роли при входе, восстановление ролей и панели ролей',
        list: {
          name: 'list',
          description: 'Показать настройки авторолей',
        },
        join: {
          name: 'join',
          description: 'Роли при входе',
          add: {
            name: 'add',
            description: 'Выдавать роль новым участникам',
            options: {
              role: {
                name: 'роль',
                description: 'Роль',
              },
            },
          },
          remove: {
            name: 'remove',
            description: 'Перестать выдавать роль при входе',
            options: {
              role: {
                name: 'роль',
                description: 'Роль',
              },
            },
          },
          delay: {
            name: 'delay',
            description: 'Задержка перед выдачей ролей при входе',
            options: {
              seconds: {
                name: 'секунды',
                description: '0–3600',
              },
            },
          },
        },
        persistence: {
          name: 'persistence',
          description: 'Восстанавливать роли вернувшимся участникам',
          on: {
            name: 'on',
            description: 'Включить восстановление ролей',
          },
          off: {
            name: 'off',
            description: 'Выключить восстановление ролей',
          },
        },
        panel: {
          name: 'panel',
          description: 'Панели самостоятельного выбора ролей',
          create: {
            name: 'create',
            description: 'Создать панель ролей',
            options: {
              channel: {
                name: 'канал',
                description: 'Куда отправить панель',
              },
              role: {
                name: 'роль',
                description: 'Первая роль',
              },
              text: {
                name: 'текст',
                description: 'Текст над кнопками',
              },
              kind: {
                name: 'вид',
                description: 'Кнопки или выпадающий список',
                choices: {
                  buttons: 'Кнопки',
                  select: 'Выпадающий список',
                },
              },
              mode: {
                name: 'режим',
                description: 'Как работает выбор',
                choices: {
                  toggle: 'Выдать или снять',
                  add: 'Только выдать',
                  remove: 'Только снять',
                  unique: 'Одна из панели',
                },
              },
            },
          },
          'add-role': {
            name: 'add-role',
            description: 'Добавить роль в панель',
            options: {
              panel: {
                name: 'панель',
                description: 'Панель ролей',
              },
              role: {
                name: 'роль',
                description: 'Роль',
              },
              label: {
                name: 'подпись',
                description: 'Подпись кнопки',
              },
              emoji: {
                name: 'эмодзи',
                description: 'Эмодзи',
              },
            },
          },
          'remove-role': {
            name: 'remove-role',
            description: 'Убрать роль из панели',
            options: {
              panel: {
                name: 'панель',
                description: 'Панель ролей',
              },
              role: {
                name: 'роль',
                description: 'Роль',
              },
            },
          },
          publish: {
            name: 'publish',
            description: 'Отправить или обновить сообщение панели',
            options: {
              panel: {
                name: 'панель',
                description: 'Панель ролей',
              },
            },
          },
          delete: {
            name: 'delete',
            description: 'Удалить панель и её сообщение',
            options: {
              panel: {
                name: 'панель',
                description: 'Панель ролей',
              },
            },
          },
        },
      },
    },
    name: 'Автороли',
    added: 'Выданы роли: {roles}',
    removed: 'Сняты роли: {roles}',
    unchanged: 'Роли не изменились.',
    limit: 'Можно выбрать не больше {max, plural, one {# роли} other {# ролей}} из этой панели.',
    cannotManage: 'Часть ролей бот выдать не может — сообщите администратору.',
    panelMissing: 'Эта панель ролей больше не существует.',
    infoPanelMissing: 'Эта панель больше не существует.',
    infoItemMissing: 'Этого пункта в панели больше нет.',
    reply: {
      none: 'нет',
      on: 'включено',
      off: 'выключено',
      joinRoles: 'Роли при входе',
      delay: 'Задержка: {seconds} с',
      persistence: 'Восстановление ролей',
      panels: 'Панели ролей',
      everyone: 'Роль @everyone выдать нельзя.',
      managedRole: 'Роль «{role}» управляется интеграцией — её нельзя выдавать.',
      higherRole: 'Роль «{role}» не ниже роли бота. Перетащите роль бота выше в настройках сервера.',
      joinAdded: 'Новые участники будут получать роль «{role}».',
      joinRemoved: 'Роль «{role}» больше не выдаётся при входе.',
      delaySet: 'Роли при входе выдаются через {seconds} с.',
      persistenceOn: 'Вернувшимся участникам будут восстанавливаться роли.',
      persistenceOff: 'Восстановление ролей выключено.',
      defaultText: 'Выберите роли:',
      panelCreated: 'Панель создана. Добавьте роли: /autoroles panel add-role, затем отправьте её: /autoroles panel publish.',
      alreadyInPanel: 'Эта роль уже есть в панели.',
      panelFull: 'В панели уже 25 ролей — это максимум.',
      roleAdded: 'Роль «{role}» добавлена в панель. Обновите сообщение: /autoroles panel publish.',
      roleRemoved: 'Роль «{role}» убрана из панели. Обновите сообщение: /autoroles panel publish.',
      lastRole: 'Это последняя роль панели — удалите панель целиком: /autoroles panel delete.',
      published: 'Панель опубликована в {channel}.',
      panelDeleted: 'Панель удалена.',
    },
  },
  en: {
    commands: {
      autoroles: {
        description: 'Join roles, role restore and role panels',
        list: {
          name: 'list',
          description: 'Show autoroles settings',
        },
        join: {
          name: 'join',
          description: 'Roles given on join',
          add: {
            name: 'add',
            description: 'Give this role to new members',
            options: {
              role: {
                name: 'role',
                description: 'Role',
              },
            },
          },
          remove: {
            name: 'remove',
            description: 'Stop giving this role on join',
            options: {
              role: {
                name: 'role',
                description: 'Role',
              },
            },
          },
          delay: {
            name: 'delay',
            description: 'Delay before join roles are given',
            options: {
              seconds: {
                name: 'seconds',
                description: '0–3600',
              },
            },
          },
        },
        persistence: {
          name: 'persistence',
          description: 'Restore roles when members come back',
          on: {
            name: 'on',
            description: 'Enable role restore',
          },
          off: {
            name: 'off',
            description: 'Disable role restore',
          },
        },
        panel: {
          name: 'panel',
          description: 'Self-assignable role panels',
          create: {
            name: 'create',
            description: 'Create a role panel',
            options: {
              channel: {
                name: 'channel',
                description: 'Where to post the panel',
              },
              role: {
                name: 'role',
                description: 'First role',
              },
              text: {
                name: 'text',
                description: 'Text above the buttons',
              },
              kind: {
                name: 'kind',
                description: 'Buttons or a dropdown',
                choices: {
                  buttons: 'Buttons',
                  select: 'Dropdown',
                },
              },
              mode: {
                name: 'mode',
                description: 'How picking works',
                choices: {
                  toggle: 'Toggle',
                  add: 'Only add',
                  remove: 'Only remove',
                  unique: 'One of the panel',
                },
              },
            },
          },
          'add-role': {
            name: 'add-role',
            description: 'Add a role to a panel',
            options: {
              panel: {
                name: 'panel',
                description: 'Role panel',
              },
              role: {
                name: 'role',
                description: 'Role',
              },
              label: {
                name: 'label',
                description: 'Button label',
              },
              emoji: {
                name: 'emoji',
                description: 'Emoji',
              },
            },
          },
          'remove-role': {
            name: 'remove-role',
            description: 'Remove a role from a panel',
            options: {
              panel: {
                name: 'panel',
                description: 'Role panel',
              },
              role: {
                name: 'role',
                description: 'Role',
              },
            },
          },
          publish: {
            name: 'publish',
            description: 'Post or update the panel message',
            options: {
              panel: {
                name: 'panel',
                description: 'Role panel',
              },
            },
          },
          delete: {
            name: 'delete',
            description: 'Delete a panel and its message',
            options: {
              panel: {
                name: 'panel',
                description: 'Role panel',
              },
            },
          },
        },
      },
    },
    name: 'Autoroles',
    added: 'Roles added: {roles}',
    removed: 'Roles removed: {roles}',
    unchanged: 'Your roles did not change.',
    limit: 'You can pick at most {max, plural, one {# role} other {# roles}} from this panel.',
    cannotManage: 'The bot cannot manage some of these roles — please tell an administrator.',
    panelMissing: 'This role panel no longer exists.',
    infoPanelMissing: 'This panel no longer exists.',
    infoItemMissing: 'This item is no longer on the panel.',
    reply: {
      none: 'none',
      on: 'enabled',
      off: 'disabled',
      joinRoles: 'Join roles',
      delay: 'Delay: {seconds}s',
      persistence: 'Role restore',
      panels: 'Role panels',
      everyone: 'The @everyone role cannot be assigned.',
      managedRole: 'The “{role}” role is managed by an integration and cannot be assigned.',
      higherRole: 'The “{role}” role is not below the bot role. Move the bot role higher in server settings.',
      joinAdded: 'New members will get the “{role}” role.',
      joinRemoved: 'The “{role}” role is no longer given on join.',
      delaySet: 'Join roles are given after {seconds}s.',
      persistenceOn: 'Returning members will get their roles back.',
      persistenceOff: 'Role restore is disabled.',
      defaultText: 'Pick your roles:',
      panelCreated: 'Panel created. Add roles with /autoroles panel add-role, then post it with /autoroles panel publish.',
      alreadyInPanel: 'This role is already in the panel.',
      panelFull: 'The panel already has 25 roles, the maximum.',
      roleAdded: 'Added “{role}” to the panel. Update the message with /autoroles panel publish.',
      roleRemoved: 'Removed “{role}” from the panel. Update the message with /autoroles panel publish.',
      lastRole: 'This is the last role of the panel — delete the whole panel with /autoroles panel delete.',
      published: 'Panel posted in {channel}.',
      panelDeleted: 'Panel deleted.',
    },
  },
};
