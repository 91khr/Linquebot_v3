// Entry point of the bot

import { load_bridge } from './lib/bridge.js';
import { read_config } from './lib/config.js';
import { global_log } from './lib/logger.js';
import { global_i18n } from './lib/i18n.js';
import { load_plugins } from './lib/plugin.js';
import { AppManager, init_plugins } from './lib/app_manager.js';

const conf = await read_config();
if (conf.locale) await global_i18n.set_locale(conf.locale);
if (conf.log_level) global_log.level = conf.log_level;

const bot = await (async () => {
  using _ = global_log.region_tmpl()`Logging in ${conf.active_bridge}`;
  const res = await load_bridge(conf.active_bridge);
  const status = await res.login(conf.bridges[conf.active_bridge]?.login);
  if (status.kind === 'error') {
    global_log.tmpl('error')`Error logging to ${conf.active_bridge}: ${status.info}`;
    process.exit(1);
  }
  return res;
})();

const app = new AppManager({ conf, bot });
await init_plugins(app, await load_plugins(app));

try {
  // Suppress eslint error (
  const shared = { last_dog: Date.now(), in_event: 0, exit: false };
  const timer = (() => {
    if (conf.watchdog_interval !== 0) {
      void app.send_to_supervisor({ kind: 'watchdog' });
      return setInterval(() => {
        if (shared.in_event === 0) void app.send_to_supervisor({ kind: 'watchdog' });
      }, conf.watchdog_interval * 1000);
    }
  })();
  const pending_event_proc = new Set();
  while (!shared.exit) {
    const msg = await bot.poll_message();
    const proc = (async () => {
      shared.in_event++;
      try {
        await app.dispatch(msg);
        if (conf.watchdog_interval !== 0) {
          const nowdate = Date.now();
          if (nowdate - shared.last_dog >= conf.watchdog_interval * 1000) {
            void app.send_to_supervisor({ kind: 'watchdog' });
            shared.last_dog = nowdate;
          }
        }
      } catch (e) {
        const isdie = conf.debug?.die_for_uncaught_error ?? false;
        app.log.tmpl(isdie ? 'internal-error' : 'error')`Uncaught error: ${e}`;
        if (isdie) shared.exit = true;
      } finally {
        shared.in_event--;
      }
    })();
    pending_event_proc.add(proc);
    void (async () => {
      await proc;
      pending_event_proc.delete(proc);
    });
  }
  await Promise.allSettled(pending_event_proc.values());
  if (timer) clearInterval(timer);
} finally {
  await bot.logout();
}
