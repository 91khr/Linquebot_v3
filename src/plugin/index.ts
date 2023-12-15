import { Message } from '@/bridge/index.js';
import { App } from '@/lib/app.js';
import { AppManager } from '@/lib/app_manager.js';
import { readdir } from 'fs/promises';
import path from 'path';

export type PluginManifest = {
  doc_short: string;
  doc_long?: string;
  db: { [name: string]: () => unknown };
  listeners: PluginListener[];
  init?: (app: AppManager) => void;
};

export type PluginListener = {
  dos_short: string;
  doc_long?: string;
} & (
  | {
      kind: 'command';
      name: string;
      handler: (app: App, msg: Message) => PromiseLike<void>;
    }
  | {
      kind: 'message';
      name: string;
      handler: (app: App, msg: Message) => PromiseLike<void>;
    }
);

export type CommandPermissions = { kind: 'admin' | 'anyone' } | { kind: 'custom'; lv: number };

export type PluginModuleType = {
  manifest: (info: AppManager) => PromiseLike<PluginManifest>;
};

export async function load_plugins(app: AppManager): Promise<PluginManifest[]> {
  using _ = app.log.region('loading plugins...');
  const res = [];
  for (const f of await readdir(path.dirname(new URL(import.meta.url).pathname), {
    withFileTypes: true,
    recursive: false,
  })) {
    if (f.isFile() && (f.name === 'index.js' || !f.name.match(/.js$/))) continue;
    using _ = app.log.region_tmpl('debug')`Loading plugin ${f}`;
    const fname = f.isDirectory() ? path.join(f.path, 'index.js') : f.path;
    const plg = await ((await import(fname)) as PluginModuleType).manifest(app);
    res.push(plg);
  }
  return res;
}
