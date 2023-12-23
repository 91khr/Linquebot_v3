import { Chat } from '@/lib/bridge.js';
import { PluginManifest } from '@/lib/plugin.js';
import { I18nEngine } from './i18n.js';
import { DbDecl, DbType } from './db.js';

export type PeerDbType<T extends string[]> = {
  [k in keyof T as k extends number ? T[k] : never]: { [name: string]: unknown };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- We need a both top and bottom type here... x x
export type AnyApp = App<any, []>;

export type MyApp<T extends PluginManifest> = App<T['db'], T['peerdb']>;

export class App<T extends DbDecl, P extends string[]> {
  chat: Chat;
  db: DbType<T>;
  peerdb: PeerDbType<P>;
  i18n: I18nEngine;

  constructor({
    chat,
    db,
    peerdb,
    i18n,
  }: {
    i18n: I18nEngine;
    chat: Chat;
    db: DbType<T>;
    peerdb: PeerDbType<P>;
  }) {
    this.chat = chat;
    this.db = db;
    this.i18n = i18n;
    this.peerdb = peerdb;
  }
}
