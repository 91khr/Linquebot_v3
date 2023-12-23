import { CmdListener, HandlerPermission, LoadedPlugin, MsgListener } from '@/lib/plugin.js';
import { Logger, global_log } from './logger.js';
import {
  Bridge,
  Chat,
  ChatImpl,
  IncomingMessage,
  PolledMessage,
  SendingMessage,
} from '@/lib/bridge.js';
import { AnyApp, App, PeerDbType } from './app.js';
import { AppConfig, BridgeConfig } from './config.js';
import { SupervisorMessage } from './supervisor_ipc.js';
import { MaybePromiseLike, compare_perm, mkRaii } from './utils.js';
import { I18nEngine, global_i18n } from './i18n.js';
import { DbManager, DbType } from './db.js';
import * as util from 'util';

const mgrdata = {
  perm: { proto: (): HandlerPermission => ({ kind: 'anyone' }), nkeys: ['chat', 'user'] },
  locale: { proto: () => 'raw', nkeys: ['chat'] },
} as const;

export class AppManager {
  log: Logger = global_log;
  i18n: I18nEngine = global_i18n;
  bot: Bridge;
  conf: AppConfig;
  brconf: BridgeConfig;
  db: DbManager;
  i18n_cache: { [l: string]: I18nEngine } = {};
  cmd_handlers: {
    [k: string]:
      | {
          perm: HandlerPermission;
          fn: (app: AnyApp, msg: IncomingMessage, text: string) => MaybePromiseLike<void>;
          selfdb: string;
          peerdb: readonly string[];
        }
      | undefined;
  } = {};
  msg_handlers: {
    name: string;
    is_endpoint: boolean;
    chain_after: string[];
    perm: HandlerPermission;
    fn: (app: AnyApp, msg: IncomingMessage) => MaybePromiseLike<boolean>;
    selfdb: string;
    peerdb: readonly string[];
  }[] = [];
  private pending_transaction_data: Set<PromiseLike<void>> = new Set();

  constructor({ conf, bot }: { conf: AppConfig; bot: Bridge }) {
    this.bot = bot;
    this.conf = conf;
    this.brconf = conf.bridges[conf.active_bridge]!;
    this.db = new DbManager(this);
    this.db.register({ kind: 'inner', sub: { manager: { kind: 'leaf', sub: mgrdata } } });
  }

  /** Well... It's generally not recommended to write to this in user code, since we maintain some state in it. */
  get pending_transaction() {
    return this.pending_transaction_data;
  }
  ensure_transaction(trans: PromiseLike<void>) {
    this.pending_transaction.add(trans);
    void (async () => {
      await trans;
      this.pending_transaction.delete(trans);
    })();
  }

  private wrap_chat(i18n: I18nEngine, chat: ChatImpl) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias  -- Lazzzy to add a ctor (
    const self = this;
    class Wrapper implements Chat {
      inner = chat;
      app = self;
      get id() {
        return this.inner.id;
      }
      send_message(msg: SendingMessage | string): MaybePromiseLike<void> {
        const msgv = typeof msg === 'string' ? { text: msg } : msg;
        msgv.text = i18n.tr(msgv.text);
        return this.inner.send_message(msgv);
      }
      send_text_tmpl(ss: TemplateStringsArray, ...sv: unknown[]): MaybePromiseLike<void> {
        return this.send_message(i18n.tmpl(ss, ...sv));
      }
    }
    return new Wrapper();
  }

  async dispatch({ chat: arg_chat, msg }: PolledMessage) {
    const mgrdb = await this.db.scope<DbType<typeof mgrdata>>('manager');
    this.log.tmpl('debug')`Got: ${util.inspect(arg_chat, { colors: true })} ${util.inspect(msg, {
      colors: true,
    })}`;
    using _write_db = mkRaii(() => this.db.commit(this, 'manager', mgrdb));
    if (!(arg_chat.id in mgrdb.locale)) mgrdb.locale.set(arg_chat.id, 'raw');
    const cur_locale = mgrdb.locale.get(arg_chat.id)!;
    if (!(cur_locale in this.i18n_cache))
      this.i18n_cache[cur_locale] = await I18nEngine.mk(mgrdb.locale.get(arg_chat.id)!);
    const i18n = this.i18n_cache[cur_locale];
    const chat = this.wrap_chat(i18n, arg_chat);
    const no_perm = (perm: HandlerPermission) =>
      msg.from !== undefined &&
      compare_perm(mgrdb.perm.get(chat.id, msg.from.id) ?? { kind: 'anyone' }, perm) < 0 &&
      perm.kind !== 'anyone';
    const mkapp = async (selfname: string, peername: readonly string[]) => {
      const peerdb: PeerDbType<string[]> = {};
      for (const name of peername) peerdb[name] = await this.db.scope(name);
      return new App<never, string[]>({
        conf: this.conf,
        chat,
        db: await this.db.scope(selfname),
        peerdb,
        i18n,
      });
    };

    // Check if is command
    const cmd_prefix = this.brconf.cmd_prefix ?? '!';
    if (msg.text.startsWith(cmd_prefix)) {
      const cmdctnt = msg.text.slice(1).match(/^([^\s@]*)(@\S*)?/);
      if (cmdctnt === null) {
        this.log.tmpl()`Unrecognized command: ${msg.text}`;
        void chat.send_text_tmpl`Unrecognized command: ${msg.text}`;
        return;
      }
      if (cmdctnt[2] && cmdctnt[2] !== '@' + this.brconf.bot_addresser) return;
      const handler = this.cmd_handlers[cmdctnt[1]];
      if (!handler) {
        this.log.tmpl()`Undefined handler for command ${cmdctnt[1]}`;
        if (cmdctnt[2]) void chat.send_text_tmpl`Undefined handler for command ${cmdctnt[1]}`;
        return;
      }
      if (no_perm(handler.perm)) return;
      const app = await mkapp(handler.selfdb, handler.peerdb);
      await handler.fn(app, msg, msg.text.slice(cmdctnt[0].length + 1).trim());
      this.db.commit(this, handler.selfdb, app.db);
      for (const peer of handler.peerdb) this.db.commit(this, peer, app.peerdb[peer]);
    } else {
      const passed_msg = new Map<string, boolean>();
      // Check if any message handler match
      for (const { name, is_endpoint, chain_after, perm, fn, selfdb, peerdb } of this
        .msg_handlers) {
        if (
          !chain_after.reduce((prev, cur) => {
            const passed = passed_msg.get(cur);
            if (passed === undefined) {
              this.log.tmpl('internal-error')`Toposort failed: key ${cur} not found `;
              return false;
            }
            return prev && passed;
          }, true)
        )
          continue;
        // Check for permission
        if (no_perm(perm)) continue;
        // Make db
        const app = await mkapp(selfdb, peerdb);
        const res = await fn(app, msg);
        this.db.commit(this, selfdb, app.db);
        for (const peer of peerdb) this.db.commit(this, peer, app.peerdb[peer]);
        passed_msg.set(name, res);
        if (is_endpoint) break;
      }
    }
  }

  async send_to_supervisor(msg: SupervisorMessage) {
    process.send?.(msg);
    if (msg.kind === 'watchdog') return;
    await Promise.allSettled(this.pending_transaction.values());
  }
}

export async function init_plugins(app: AppManager, plugins: LoadedPlugin[]) {
  using _ = app.log.region('Initializing and validating plugins');

  app.log.put('Registering databases...');
  for (const plg of plugins)
    app.db.register({ kind: 'inner', sub: { [plg.name]: { kind: 'leaf', sub: plg.db } } });

  app.log.put('Collecting command handlers and sorting message handlers');

  app.cmd_handlers = Object.fromEntries(
    plugins.flatMap((plg) =>
      plg.listeners
        .filter((li): li is CmdListener => li.kind === 'command')
        .map((li) => [
          li.name,
          { fn: li.handler, perm: li.permission, selfdb: plg.name, peerdb: plg.peerdb },
        ])
    )
  );

  const graph: { [k: string]: { count: number; adj: string[] } } = {};
  const msg_handlers = Object.fromEntries(
    plugins.flatMap((plg) =>
      plg.listeners
        .filter((li): li is MsgListener => li.kind === 'message')
        .map(({ name, is_endpoint, chain_after, permission, handler }) => [
          name,
          {
            name,
            is_endpoint,
            chain_after,
            fn: handler,
            perm: permission,
            selfdb: plg.name,
            peerdb: plg.peerdb,
          },
        ])
    )
  );
  const bfsq: string[] = [];
  for (const li of Object.values(msg_handlers)) {
    if (!(li.name in graph)) graph[li.name] = { count: 0, adj: [] };
    graph[li.name].count = li.chain_after.length;
    if (graph[li.name].count === 0) bfsq.push(li.name);
    for (const pre of li.chain_after) {
      if (!(pre in graph)) graph[pre] = { count: 0, adj: [] };
      graph[pre].adj.push(li.name);
    }
  }
  while (true) {
    const cur = bfsq.pop();
    if (cur === undefined) break;
    app.msg_handlers.push(msg_handlers[cur]);
    for (const next of graph[cur].adj) if (--graph[next].count === 0) bfsq.push(next);
  }

  app.log.put('Running initialization hooks');
  await Promise.all(plugins.map((plg) => plg.init?.(app)));
}
