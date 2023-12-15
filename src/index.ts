import child_process from 'child_process';
import path from 'path';
import process from 'process';
import { SupervisorMessage } from './lib/supervisor_ipc.js';
import { global_log } from './lib/logger.js';
import { config_path, default_config_path, read_config } from './lib/config.js';
import { can_access } from './lib/utils.js';
import readline from 'readline/promises';
import { global_i18n } from './lib/i18n.js';
import fs, { copyFile } from 'fs/promises';

global_log.put('Supervisor initialize...');
process.chdir(path.dirname(new URL(import.meta.url).pathname));

const rl = readline.createInterface({ input: process.stdin });
const config = await (async () => {
  if (await can_access(config_path)) return await read_config();
  else if (
    (await can_access(default_config_path)) &&
    (await can_access(config_path, fs.constants.W_OK))
  ) {
    const docp = await rl.question(
      global_i18n.tr('Config not present, copy from the default config?')
    );
    if (!docp) global_log.put('Denied by user, quitting...');
    await copyFile(default_config_path, config_path);
    return await read_config();
  } else throw new Error(global_i18n.tr("Can't read config or copy the default config"));
})();

if (config.log_level) global_log.level = config.log_level;

type CtrlMessage = SupervisorMessage | { kind: 'exit'; code: number } | { kind: 'watchdog' };

while (true) {
  const cp = child_process.fork('./init.js');
  const subevent = await new Promise<CtrlMessage>((res) => {
    let watchdog_fed = false;
    cp.on('message', (message) => {
      const msg = JSON.parse(String(message)) as SupervisorMessage;
      switch (msg.kind) {
        case 'reboot':
          global_log.header('Received application reboot message, rebooting...');
          res(msg);
          break;
        case 'shutdown':
          global_log.header('Received application shutdown message, shutting down...');
          res(msg);
          break;
        case 'watchdog':
          watchdog_fed = true;
          break;
      }
    });

    cp.on('exit', (code) => {
      global_log.tmpl('warn')`init.js exited with code ${code}`;
      res({ kind: 'exit', code: code ?? -1 });
    });

    if (config.watchdog_interval !== 0) {
      global_log.tmpl('debug')`[Watchdog] Watchdog setup`;
      setInterval(() => {
        if (!watchdog_fed) {
          global_log.header('[Watchdog] The application seems not responding, rebooting...');
          res({ kind: 'watchdog' });
        }
        watchdog_fed = false;
      }, config.watchdog_interval * 2000);
    } else global_log.tmpl('debug')`[Watchdog] Watchdog disabled, idle`;
  });
  if (subevent.kind === 'watchdog') {
    if (!(config.reboot_on_watchdog ?? true)) break;
  } else if (subevent.kind !== 'reboot') break;
}
