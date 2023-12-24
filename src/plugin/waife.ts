import { MyApp } from '@/lib/app.js';
import { AppManager } from '@/lib/app_manager.js';
import { IncomingMessage } from '@/lib/bridge.js';
import { PluginDynManifest } from '@/lib/plugin.js';
import { ensure_extend, mkproto } from '@/lib/utils.js';
import { tmpdir } from 'os';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';

type WaifeData = {
  name: string;
  waife: string;
  date: string;
};
const waife_db = {
  db: {
    active_users: {
      proto: mkproto<Set<string>>(),
      nkeys: ['group'],
      read: (s: (string | number)[]) => new Set(s),
      write: (s: Set<string>) => [...s.values()],
    },
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
  const users = app.db.active_users.get_or_insert(app.chat.id, () => new Set());
  if (users.has(msg.from.name)) return true;
  users.add(msg.from.name);
  return true;
}

function waife_get(app: WaifeApp, msg: IncomingMessage) {
  if (!msg.from) return;
  const data = app.db.waifes.get_or_insert(app.chat.id, msg.from.id, () => ({
    name: '',
    waife: '',
    date: '',
  }));
  const today = new Date().toDateString();
  if (data.date === today) {
    void app.chat.send_message('You have rolled a waife today!');
    return;
  }
  const users = app.db.active_users.get(app.chat.id);
  do {
    if (!users) break;
    data.date = today;
    const cand = [...users.values()].filter((n) => n !== msg.from!.name);
    if (cand.length === 0) break;
    data.name = msg.from.name;
    data.waife = cand[Math.floor(Math.random() * cand.length)];
    void app.chat.send_text_tmpl`Your waife today is ${data.waife}`;
    return;
  } while (false);
  void app.chat
    .send_text_tmpl`No users in group, please wait for ${app.conf.self_pronoun} to collect more!`;
}

async function waife_graph(app: WaifeApp, msg: IncomingMessage) {
  let edges = '';
  const today = new Date().toDateString();
  for (const { value } of app.db.waifes.slice<1>(app.chat.id)) {
    if (value.date !== today) continue;
    edges += `"${value.name}" -> "${value.waife}";\n`;
  }
  const src = 'digraph G {\nnode[shape=box];\n' + edges + '}';
  const pray = app.chat.send_message({ text: '少女祈祷中...', reply_to_id: msg.id });
  try {
    const [fname, outname] = [`${tmpdir()}/waife.gv`, `${tmpdir()}/waife.png`];
    await fs.writeFile(fname, src, { encoding: 'utf8' });
    await new Promise((res, rej) => {
      const proc = spawn('dot', [fname, '-Tpng', '-o', outname]);
      proc.on('close', (code) => (code === 0 ? res(void 0) : rej(code)));
    });
    const data = await fs.readFile(outname);
    await app.chat.send_message({
      text: '',
      reply_to_id: msg.id,
      assets: [{ kind: 'image', data }],
    });
  } catch (e) {
    await app.chat.send_text_tmpl`生成图片时出现了错误: ${e}`;
  } finally {
    void app.chat.delete_message((await pray).id);
  }
}

function waife_handler(app: WaifeApp, msg: IncomingMessage, text: string) {
  if (text === 'get' || !text) waife_get(app, msg);
  else if (text === 'graph') void waife_graph(app, msg);
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
