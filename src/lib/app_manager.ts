import { PluginManifest } from '@/plugin/index.js';
import { Logger, global_log } from './logger.js';
import { Bridge, Message, PolledMessage } from '@/bridge/index.js';
import { App } from './app.js';
import { AppConfig } from './config.js';

export class AppManager {
  log: Logger = global_log.clone();
  bot: Bridge;
  conf: AppConfig;
  cmd_handlers: { [k: string]: (app: App, msg: Message) => PromiseLike<void> | undefined } = {};
  msg_handlers: ((app: App, msg: Message) => PromiseLike<boolean>)[] = [];

  constructor({ conf, bot }: { conf: AppConfig; bot: Bridge }) {
    this.bot = bot;
    this.conf = conf;
  }

  async dispatch({ chat, msg }: PolledMessage) {
    const app = new App({ chat });
    // TODO: Check for permissions and process commands
    for (const fn of this.msg_handlers) if (await fn(app, msg)) break;
  }
}

export function init_plugins(app: AppManager, plugins: PluginManifest[]) {
  plugins.forEach((plg) => plg.init?.(app));
}
