// Entry point of the bot

import { load_bridge } from './bridge/index.js';
import { read_config } from './lib/config.js';
import { global_log } from './lib/logger.js';
import { global_i18n } from './lib/i18n.js';
import { load_plugins } from './plugin/index.js';
import { AppManager, init_plugins } from './lib/app_manager.js';

const conf = await read_config();
if (conf.locale) await global_i18n.set_locale(conf.locale);
if (conf.log_level) global_log.level = conf.log_level;

const bot = await (async () => {
  const res = await load_bridge(conf.active_bridge);
  const status = await res.login(conf.bridges[conf.active_bridge]?.login);
  if (status.kind === 'error') {
    global_log.tmpl('error')`Error logging to ${conf.active_bridge}: ${status.info}`;
    process.exit(1);
  }
  return res;
})();

const app = new AppManager({ conf, bot });
init_plugins(app, await load_plugins(app));

try {
  let prev = Date.now();
  while (true) {
    const msg = await bot.poll_message();
    await app.dispatch(msg);
    if (conf.watchdog_interval !== 0) {
      const cur = Date.now();
      if (cur - prev >= conf.watchdog_interval * 1000) process.send?.({ kind: 'watchdog' });
      prev = cur;
    }
  }
} finally {
  await bot.logout();
}
