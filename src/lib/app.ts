import { Chat } from '@/lib/bridge.js';
import { PluginDb } from '@/lib/plugin.js';
import { I18nEngine } from './i18n.js';
import { DbDecl, DbType } from './db.js';
import { AppConfig } from './config.js';
import { Logger } from './logger.js';

export type PeerDbType<T extends readonly string[]> = {
  [k in keyof T as k extends number ? T[k] : never]: { [name: string]: unknown };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- We need a both top and bottom type here... x x
export type AnyApp = App<any, []>;

export type MyApp<T extends PluginDb> = App<T['db'], T['peerdb']>;

export class App<T extends DbDecl, P extends readonly string[]> {
  chat: Chat;
  db: DbType<T>;
  log: Logger;
  peerdb: PeerDbType<P>;
  i18n: I18nEngine;
  conf: AppConfig;

  constructor({
    chat,
    db,
    log,
    peerdb,
    i18n,
    conf,
  }: {
    conf: AppConfig;
    i18n: I18nEngine;
    chat: Chat;
    db: DbType<T>;
    log: Logger;
    peerdb: PeerDbType<P>;
  }) {
    this.conf = conf;
    this.chat = chat;
    this.db = db;
    this.log = log;
    this.i18n = i18n;
    this.peerdb = peerdb;
  }
}
