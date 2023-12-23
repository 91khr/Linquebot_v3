import { MyApp } from '@/lib/app.js';
import { IncomingMessage } from '@/lib/bridge.js';
import {
  CmdListener,
  LoadedPlugin,
  MsgListener,
  PluginDb,
  PluginDynManifest,
} from '@/lib/plugin.js';
import { ensure_extend } from '@/lib/utils.js';
import { AppManager } from './lib/app_manager.js';

const core_db = ensure_extend<PluginDb>()({
  db: {},
  peerdb: [],
} as const);
type CoreApp = MyApp<typeof core_db>;

const full_help: { [k: string]: string | undefined } = {};
let brief_help = '';

const handle_help = (app: CoreApp, _msg: IncomingMessage, text: string) => {
  text = text.trim();
  if (!text) {
    void app.chat.raw_send_text_tmpl`这里是 ${app.conf.self_pronoun} 的帮助:\n${brief_help}`;
    return;
  }
  const msg = full_help[text];
  if (!msg) {
    void app.chat.send_text_tmpl`找不到 ${text} 的帮助`;
    return;
  }
  void app.chat.raw_send_text_tmpl`${text}:\n${msg}`;
};

export function init_core(app: AppManager, plugins: LoadedPlugin[]) {
  brief_help = plugins
    .flatMap((plg) =>
      plg.listeners
        .filter((l): l is CmdListener => l.kind === 'command')
        .map((l) => `/${l.name}: ${l.doc_short}`)
    )
    .join('\n');
  const msg_listeners = plugins.flatMap((plg) =>
    plg.listeners
      .filter((l): l is MsgListener => l.kind === 'message')
      .map((l) => `${l.name}: ${l.doc_short}`)
  );
  brief_help += app.i18n.tmpl`\n---\n${msg_listeners.length} Message listeners:\n`;
  brief_help += msg_listeners.join('\n');
  for (const plg of plugins) for (const li of plg.listeners) full_help[li.name] = li.doc_long;
}

export const loaded_core = (app: AppManager) =>
  Object.assign(
    ensure_extend<PluginDynManifest>()({
      name: 'core',
      doc_short: app.i18n.tr('Core functionalities of the bot'),
      listeners: [
        {
          kind: 'command',
          doc_short: app.i18n.tr('get help'),
          doc_long: app.i18n.tr(
            '/help [topic] to get help of a topic, if topic not present, the help index would be displayed instead'
          ),
          name: 'help',
          permission: { kind: 'anyone' },
          handler: handle_help,
        },
      ],
    }),
    core_db
  ) as LoadedPlugin;
