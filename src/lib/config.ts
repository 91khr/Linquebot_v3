import fs from 'fs/promises';
import jsYaml from 'js-yaml';
import { LogKinds } from './logger.js';

export type BridgeConfig = {
  login: unknown;
  cmd_prefix?: string;
  bot_addresser: string;
};

export type AppConfig = {
  /** The interval watchdog should check for */
  watchdog_interval: number;
  /** Configure for specific bridges, login information should be provided */
  bridges: { [name: string]: BridgeConfig | undefined };
  active_bridge: string;
  /** What should the bot call themself */
  self_pronoun: string;
  locale?: string;
  log_level?: LogKinds;

  internal?: {
    db_write_batch_size?: number;
  };
  debug?: {
    reboot_on_watchdog?: boolean;
    die_for_uncaught_error?: boolean;
  };
};

export const config_path = 'config.yaml';
export const default_config_path = 'config.example.yaml';

export async function read_config(path = config_path) {
  return jsYaml.load((await fs.readFile(path)).toString('utf8')) as AppConfig;
}
export async function read_config_or_default(): Promise<AppConfig> {
  const default_values = read_config(default_config_path);
  const config = read_config();
  return Object.assign(default_values, config);
}
