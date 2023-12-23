import { IncomingMessage } from '@/lib/bridge.js';
import { AnyApp } from '@/lib/app.js';
import { AppManager } from '@/lib/app_manager.js';
import { readdir } from 'fs/promises';
import path from 'path';
import { DbDecl } from './db.js';

export type PluginManifest = {
  name?: string;
  doc_short: string;
  doc_long?: string;
  db: DbDecl;
  peerdb: string[];
  listeners: PluginListener[];
  init?: (app: AppManager) => PromiseLike<void>;
};

type MkListener<T> = {
  dos_short: string;
  doc_long?: string;
} & T;
export type CmdListener = MkListener<{
  kind: 'command';
  name: string;
  handler: (app: AnyApp, msg: IncomingMessage) => PromiseLike<void>;
  permission: HandlerPermission;
}>;
export type MsgListener = MkListener<{
  kind: 'message';
  name: string;
  is_endpoint: boolean;
  chain_after: string[];
  handler: (app: AnyApp, msg: IncomingMessage) => PromiseLike<boolean>;
  permission: HandlerPermission;
}>;
export type PluginListener = CmdListener | MsgListener;

export type HandlerPermission = { kind: 'admin' | 'anyone' } | { kind: 'custom'; lv: number };

export type PluginModuleType = {
  manifest: (app: AppManager) => PromiseLike<PluginManifest>;
};

export type LoadedPlugin = PluginManifest & { name: string };
export async function load_plugins(app: AppManager): Promise<LoadedPlugin[]> {
  using _ = app.log.region('loading plugins...');
  const res = [];
  for (const f of await readdir(path.dirname(new URL(import.meta.url).pathname), {
    withFileTypes: true,
    recursive: false,
  })) {
    if (f.isFile() && (f.name === 'index.js' || !f.name.match(/.js$/))) continue;
    using _ = app.log.region_tmpl()`Loading plugin ${f}`;
    const fname = f.isDirectory() ? path.join(f.path, 'index.js') : f.path;
    const plg = Object.assign(
      { name: path.parse(f.path).name },
      await ((await import(fname)) as PluginModuleType).manifest(app)
    );
    res.push(plg);
  }
  return res;
}
