import assert from 'assert';
import { AppManager } from './app_manager.js';
import * as fs from 'fs/promises';

/**
 * DB declaration in plugin's manifest should be of a subtype of this type,
 * however, it should not be exactly this type, for a better inference of DBs' types.
 */
export type DbDecl = {
  [name: string]: { proto?: () => unknown; nkeys: number | readonly string[] };
};
/**
 * The actual type used for db to register databases. Not exposed to the plugins due to its complexity.
 */
export type DbTree =
  | { kind: 'inner'; sub: { [name: string]: DbTree } }
  | { kind: 'leaf'; sub: DbDecl };

export type DbType<T extends DbDecl> = {
  [k in keyof T]: IsNatural<GetNKeys<T[k]['nkeys']>> extends true
    ? Db<T[k]['proto'] extends () => unknown ? ReturnType<T[k]['proto']> : unknown, T[k]['nkeys']>
    : 'Invalid nkeys, expected natural';
};

type GetNKeys<K extends readonly string[] | number> = K extends readonly string[] ? K['length'] : K;
type IsNatural<N extends number> = `${N}` extends `${infer _}${'-' | 'e' | 'E' | '.'}${infer _}`
  ? false
  : true;
type Repeated<T, D extends unknown[], N extends number> = number extends N
  ? T[]
  : N extends N
    ? D['length'] extends N
      ? []
      : [...Repeated<T, [...D, 0], N>, T]
    : never;

class FileLock implements Disposable {
  static lock: { [fname: string]: { queue: (() => void)[]; occupied: boolean } } = {};
  static async acquire(fname: string) {
    const self = new FileLock(fname);
    if (!(fname in this.lock)) this.lock[fname] = { queue: [], occupied: false };
    if (this.lock[fname].occupied)
      await new Promise<void>((res) => this.lock[fname].queue.push(res));
    else this.lock[fname].occupied = true;
    return self;
  }
  fname: string;
  private constructor(fname: string) {
    this.fname = fname;
  }
  [Symbol.dispose]() {
    const waker = FileLock.lock[this.fname].queue.pop();
    if (waker) waker();
    else FileLock.lock[this.fname].occupied = false;
  }
}

type DataT<T> = NonNullable<T> | { [k: string | number]: DataT<T> };
type RegistryContent = {
  kind: 'leaf';
  nkeys: number;
  cache: DataT<unknown> | undefined;
  pending: number;
};
type RegistryT = { kind: 'inner'; sub: { [name: string]: RegistryT | RegistryContent } };
type Nested<T> = { [k: string | number]: Nested<T> | T };

export class DbManager {
  app: AppManager;
  registry: RegistryT = { kind: 'inner', sub: {} };

  constructor(app: AppManager) {
    this.app = app;
  }

  register(tree: DbTree) {
    const mkreg = (sub: DbTree): RegistryT => {
      if (sub.kind === 'leaf')
        return {
          kind: 'inner',
          sub: Object.fromEntries(
            Object.entries(sub.sub).map(([name, decl]) => [
              name,
              {
                kind: 'leaf',
                nkeys: typeof decl.nkeys === 'number' ? decl.nkeys : decl.nkeys.length,
                cache: {},
                pending: 0,
              },
            ])
          ),
        };
      else
        return {
          kind: 'inner',
          sub: Object.fromEntries(
            Object.entries(sub.sub).map(([name, decl]) => [name, mkreg(decl)])
          ),
        };
    };
    for (const [k, v] of Object.entries(mkreg(tree).sub)) this.registry.sub[k] = v;
  }

  async scope<T>(scope: string | string[]) {
    const p = typeof scope === 'string' ? [scope] : scope;
    const read_db = async (path: string[], reg: RegistryContent) => {
      if (!reg.cache) {
        const fname = `data/${path.join('/')}.json`;
        using _ = await FileLock.acquire(fname);
        reg.cache = JSON.parse(await fs.readFile(fname, { encoding: 'utf8' })) as DataT<unknown>;
      }
      return new Db(reg.cache) as T;
    };
    let reg = this.registry;
    for (const [i, k] of p.entries()) {
      const sub = reg.sub[k];
      if (sub.kind === 'leaf') {
        assert(i === p.length - 1, `Non leaf scope: ${p.join('/')}`);
        return await read_db(p, sub);
      }
      reg = sub;
    }
    const maptree = async (path: string[], tree: RegistryT | RegistryContent): Promise<unknown> => {
      if (tree.kind === 'leaf') return await read_db(path, tree);
      else {
        const res: Nested<unknown> = {};
        for (const [k, sub] of Object.entries(tree.sub)) res[k] = await maptree(p.concat(k), sub);
        return res;
      }
    };
    return (await maptree(p, reg)) as T;
  }

  commit(app: AppManager, scope: string | string[], dbtree: unknown) {
    const replace = (depth: number, dst: Nested<unknown>, src: Nested<unknown>) => {
      if (depth === 0) return src;
      const res: Nested<unknown> = {};
      for (const k of [...Object.keys(dst), ...Object.keys(src)])
        if (k in src) {
          if (k in dst)
            res[k] = replace(depth - 1, dst[k] as Nested<unknown>, src[k] as Nested<unknown>);
          else res[k] = src[k];
        } else res[k] = dst[k];
      return res;
    };
    const write_db = (path: string[], db: Db<unknown>, reg: RegistryContent) => {
      if (typeof reg.cache === 'object' && reg.cache)
        reg.cache = replace(reg.nkeys, reg.cache as Nested<unknown>, db.data);
      else reg.cache = db.data;
      if (++reg.pending >= (app.conf.internal?.db_write_batch_size ?? 1)) {
        reg.pending = 0;
        const cache = reg.cache;
        app.ensure_transaction(
          (async () => {
            using _ = await FileLock.acquire(`data/${path.join('/')}.json`);
            await fs.mkdir(`data/${path.slice(0, -1).join('/')}`, { recursive: true });
            await fs.writeFile(`data/${path.join('/')}.json`, JSON.stringify(cache));
          })()
        );
      }
    };
    const p = typeof scope === 'string' ? [scope] : scope;
    let reg = this.registry;
    for (const [i, k] of p.entries()) {
      const sub = reg.sub[k];
      if (sub.kind === 'leaf') {
        assert(i === p.length - 1, `Non leaf scope: ${p.join('/')}`);
        return write_db(p, dbtree as Db<unknown>, sub);
      }
      reg = sub;
    }
    const maptree = (path: string[], regtree: RegistryT | RegistryContent, db: unknown): void => {
      if (regtree.kind === 'leaf') write_db(path, db as Db<unknown>, regtree);
      else
        for (const [k, sub] of Object.entries(regtree.sub))
          maptree(path.concat(k), sub, (db as { [k: string | number]: unknown })[k]);
    };
    maptree(p, reg, dbtree);
  }
}

export class Db<T, K extends number | readonly string[] = number> {
  cache: DataT<T>;
  data: DataT<T> = {};
  constructor(cache: DataT<T>) {
    this.cache = cache;
  }
  get(...keys: Repeated<string | number, [], GetNKeys<K>>): T | undefined {
    let reg: Nested<unknown> = this.data;
    let cache: Nested<unknown> | undefined = this.cache;
    for (let i = 0; i < keys.length - 1; ++i) {
      const k = keys[i];
      if (!(k in reg)) reg[k] = {};
      if (cache && !(k in cache)) cache = undefined;
      reg = reg[k] as Nested<unknown>;
    }
    const k = keys[keys.length - 1];
    if (cache && !(k in reg)) reg[k] = cache[k];
    return reg[k] as T | undefined;
  }
  set(...keys: [...Repeated<string | number, [], GetNKeys<K>>, T]): void {
    let reg: Nested<unknown> = this.data;
    for (let i = 0; i < keys.length - 2; ++i) {
      const k = keys[i] as string | number;
      if (!(k in reg)) reg[k] = {};
      reg = reg[k] as Nested<unknown>;
    }
    if (keys.length >= 2) {
      const k = keys[keys.length - 2] as string | number;
      reg[k] = keys[keys.length - 1];
    } else this.data = keys[0] as NonNullable<T>;
  }
}
