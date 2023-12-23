import { MyApp } from '@/lib/app.js';
import { AppManager } from '@/lib/app_manager.js';
import { IncomingMessage } from '@/lib/bridge.js';
import { PluginDynManifest } from '@/lib/plugin.js';
import { ensure_extend, mkproto } from '@/lib/utils.js';

type WaifeData = {
  waife: string;
  date: string;
};
const waife_db = {
  db: {
    active_users: { proto: mkproto<string[]>(), nkeys: ['group'] },
    waifes: {
      proto: mkproto<WaifeData>(),
      nkeys: 2,
    },
  },
  peerdb: [],
} as const;
type WaifeApp = MyApp<typeof waife_db>;

function msg_handler(app: WaifeApp, msg: IncomingMessage) {
  if (!msg.from) return true;
  const users = app.db.active_users.get_or_insert(app.chat.id, () => []);
  if (users.indexOf(msg.from.id) !== -1) {
    app.log.tmpl('debug')`Replicate user ${msg.from.id}`;
    return true;
  }
  users.push(msg.from.name);
  app.log.tmpl('debug')`Get user ${msg.from.id} => ${users}`;
  return true;
}

function waife_handler(app: WaifeApp, msg: IncomingMessage) {
  if (!msg.from) return;
  const data = app.db.waifes.get_or_insert(app.chat.id, msg.from.id, () => ({
    waife: '',
    date: '',
  }));
  app.log.tmpl('debug')`Waife data ${data}`;
  const today = new Date().toDateString();
  if (data.date === today) {
    void app.chat.send_message('You have rolled a waife today!');
    return;
  }
  const users = app.db.active_users.get(app.chat.id);
  if (!users) {
    void app.chat
      .send_text_tmpl`No users in group, please wait for ${app.conf.self_pronoun} to collect more!`;
    return;
  }
  data.date = today;
  data.waife = users[Math.floor(Math.random() * users.length)];
  void app.chat.send_text_tmpl`Your waife today is ${data.waife}`;
}

export const manifest = (app: AppManager) =>
  Object.assign(
    ensure_extend<PluginDynManifest>()({
      doc_short: 'get waifes',
      listeners: [
        {
          name: '(get user)',
          kind: 'message',
          doc_short: app.i18n.tr('Get user list in the group by listening to messages'),
          is_endpoint: false,
          handler: msg_handler,
        },
        {
          name: 'waife',
          kind: 'command',
          doc_short: app.i18n.tr('Get your waife of the day'),
          handler: waife_handler,
        },
      ],
    }),
    waife_db
  );
