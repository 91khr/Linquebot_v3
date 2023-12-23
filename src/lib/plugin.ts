import { IncomingMessage } from '@/lib/bridge.js';
import { AnyApp } from '@/lib/app.js';
import { AppManager } from '@/lib/app_manager.js';
import { readdir } from 'fs/promises';
import path from 'path';
import { DbDecl } from './db.js';
import { MaybePromiseLike } from './utils.js';

type WithDoc = {
  doc_short: string;
  doc_long?: string;
};

export type PluginDb = {
  db: DbDecl;
  peerdb: readonly string[];
};
export type PluginDynManifest = WithDoc & {
  name?: string;
  listeners: PluginListener[];
  init?: (app: AppManager) => MaybePromiseLike<void>;
};
export type PluginManifest = PluginDb & PluginDynManifest;

export type CmdListener = WithDoc & {
  kind: 'command';
  name: string;
  handler: (app: AnyApp, msg: IncomingMessage, text: string) => MaybePromiseLike<void>;
  permission: HandlerPermission;
};
export type MsgListener = WithDoc & {
  kind: 'message';
  name: string;
  is_endpoint: boolean;
  chain_after: string[];
  handler: (app: AnyApp, msg: IncomingMessage) => MaybePromiseLike<boolean>;
  permission: HandlerPermission;
};
export type PluginListener = CmdListener | MsgListener;

export type HandlerPermission =
  | { kind: 'admin'; grantable: 'none' | 'full' | 'non-grant' | 'non-admin' }
  | { kind: 'anyone' }
  | { kind: 'custom'; lv: number };

export type PluginModuleType = {
  manifest: (app: AppManager) => PluginManifest;
};

export type LoadedPlugin = PluginManifest & { name: string };
export async function load_plugins(app: AppManager): Promise<LoadedPlugin[]> {
  using _ = app.log.region('loading plugins...');
  const res = [];
  for (const f of await readdir('./plugin/', {
    withFileTypes: true,
    recursive: false,
  })) {
    if (f.isFile() && (f.name === 'index.js' || !f.name.match(/.js$/))) continue;
    using _ = app.log.region_tmpl()`Loading plugin ${f}`;
    const fname = f.isDirectory() ? path.join(f.path, 'index.js') : path.join(f.path, f.name);
    const plg = Object.assign(
      { name: path.parse(f.path).name },
      ((await import(fname)) as PluginModuleType).manifest(app)
    );
    res.push(plg);
  }
  return res;
}
