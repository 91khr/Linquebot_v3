import assert from 'assert';
import { AppManager } from './app_manager.js';
import * as fs from 'fs/promises';
import { can_access } from './utils.js';

/**
 * DB declaration in plugin's manifest should be of a subtype of this type,
 * however, it should not be exactly this type, for a better inference of DBs' types.
 */
export type DbDecl = {
  [name: string]: {
    proto?: () => unknown;
    nkeys: number | readonly string[];
    /* eslint-disable @typescript-eslint/no-explicit-any
     --- such function requires any to call...
     */
    read?: (k: any) => unknown;
    write?: (k: any) => unknown;
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };
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
type Repeated<D extends unknown[], N extends number> = number extends N
  ? (string | number)[]
  : N extends N
    ? D['length'] extends N
      ? []
      : [...Repeated<[...D, 0], N>, string | number]
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any  -- such function requires any to call...
  read?: (k: any) => unknown;
  write?: (k: unknown) => unknown;
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
                cache: undefined,
                pending: 0,
                read: decl.read,
                write: decl.write,
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
    const rec_read = (depth: number, reg: RegistryContent, cache: Nested<unknown>) => {
      if (depth === 1) for (const k of Object.keys(cache)) cache[k] = reg.read!(cache[k]);
      else
        for (const k of Object.keys(cache)) rec_read(depth - 1, reg, cache[k] as Nested<unknown>);
    };
    const read_db = async (path: string[], reg: RegistryContent) => {
      while (!reg.cache) {
        const fname = `data/${path.join('/')}.json`;
        using _ = await FileLock.acquire(fname);
        if (!(await can_access(fname))) {
          if (reg.nkeys > 0) reg.cache = {};
          break;
        }
        reg.cache = JSON.parse(await fs.readFile(fname, { encoding: 'utf8' })) as DataT<unknown>;
        if (!reg.read) break;
        if (reg.nkeys === 0) reg.cache = reg.read(reg.cache) as DataT<unknown>;
        else rec_read(reg.nkeys, reg, reg.cache);
        break;
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
    const rec_write = (depth: number, reg: RegistryContent, cache: Nested<unknown>): unknown => {
      if (depth === 0) return reg.write!(cache);
      else
        return Object.fromEntries(
          Object.entries(cache).map(([k, v]) => [
            k,
            rec_write(depth - 1, reg, v as Nested<unknown>),
          ])
        );
    };
    const write_db = (path: string[], db: Db<unknown>, reg: RegistryContent) => {
      if (!db.data) return;
      if (typeof reg.cache === 'object' && reg.cache)
        reg.cache = replace(reg.nkeys, reg.cache as Nested<unknown>, db.data);
      else reg.cache = db.data;
      if (++reg.pending >= (app.conf.internal?.db_write_batch_size ?? 1)) {
        reg.pending = 0;
        const cache = reg.cache;
        app.ensure_transaction(
          (async () => {
            using _ = await FileLock.acquire(`data/${path.join('/')}.json`);
            const data = JSON.stringify(
              reg.write ? rec_write(reg.nkeys, reg, reg.cache as Nested<unknown>) : cache
            );
            await fs.mkdir(`data/${path.slice(0, -1).join('/')}`, { recursive: true });
            await fs.writeFile(`data/${path.join('/')}.json`, data);
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
  cache: DataT<T> | undefined;
  data: DataT<T> | undefined = undefined;
  constructor(cache: DataT<T> | undefined) {
    this.cache = cache;
    this.data = cache ? {} : undefined;
  }

  private get_impl(len: number, keys: Repeated<[], GetNKeys<K>>): [Nested<T>, string | number] {
    let reg: Nested<unknown> = this.data!;
    let cache: Nested<unknown> | undefined = this.cache;
    for (let i = 0; i < len - 1; ++i) {
      const k = keys[i];
      if (!(k in reg)) reg[k] = {};
      if (cache) {
        if (!(k in cache)) cache = undefined;
        else cache = cache[k] as Nested<unknown>;
      }
      reg = reg[k] as Nested<unknown>;
    }
    const k = keys[len - 1];
    if (cache && !(k in reg) && k in cache) reg[k] = cache[k];
    return [reg as Nested<T>, k];
  }
  get(...keys: Repeated<[], GetNKeys<K>>): T | undefined {
    if (keys.length === 0) return this.data as T;
    const [reg, k] = this.get_impl(keys.length, keys);
    return reg[k] as T;
  }
  get_or_insert(...keys: [...Repeated<[], GetNKeys<K>>, () => T]): T {
    if (keys.length === 1)
      return (this.data ? this.data : (this.data = keys[0] as NonNullable<T>)) as T;
    const [reg, k] = this.get_impl(keys.length - 1, keys as unknown as Repeated<[], GetNKeys<K>>);
    return k in reg ? (reg[k] as T) : (reg[k] = (keys[keys.length - 1] as () => T)());
  }

  set(...keys: [...Repeated<[], GetNKeys<K>>, T]): void {
    if (keys.length === 1) {
      this.data = keys[0] as NonNullable<T>;
      return;
    }
    let reg: Nested<unknown> = this.data!;
    for (let i = 0; i < keys.length - 2; ++i) {
      const k = keys[i] as string | number;
      if (!(k in reg)) reg[k] = {};
      reg = reg[k] as Nested<unknown>;
    }
    const k = keys[keys.length - 2] as string | number;
    reg[k] = keys[keys.length - 1];
  }
}
