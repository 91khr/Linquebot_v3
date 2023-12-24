import { global_log } from '@/lib/logger.js';
import { MaybePromiseLike } from './utils.js';
import { BridgeConfig } from './config.js';

/**
 * A bridge between an IM and the bot.
 *
 * # Note for Implementors
 *
 * This bot assumes all one instance only correspond to one account on each platform,
 * so for platforms that support multiple bot accounts, create only one account.
 */
export interface Bridge {
  /** Log the bot in */
  login(conf: BridgeConfig): MaybePromiseLike<LoginStatus>;
  /** Log the bot out */
  logout(): MaybePromiseLike<void>;
  poll_message(): MaybePromiseLike<PolledMessage>;
  compare_message_id(a: unknown, b: unknown): number;
  register_command(name: string, doc: string): MaybePromiseLike<void>;
}

export type ChatImpl = {
  id: string | number;
  send_message(msg: SendingMessage): MaybePromiseLike<IncomingMessage>;
  delete_message(id: unknown): MaybePromiseLike<void>;
};
type Replace<T, U> = {
  [k in keyof T | keyof U]: k extends keyof U ? U[k] : k extends keyof T ? T[k] : never;
};
export type Chat = Replace<
  ChatImpl,
  {
    send_message(msg: SendingMessage | string): MaybePromiseLike<IncomingMessage>;
    raw_send_message(msg: SendingMessage | string): MaybePromiseLike<IncomingMessage>;
    send_text_tmpl(ss: TemplateStringsArray, ...sv: unknown[]): MaybePromiseLike<IncomingMessage>;
    raw_send_text_tmpl(
      ss: TemplateStringsArray,
      ...sv: unknown[]
    ): MaybePromiseLike<IncomingMessage>;
  }
>;

export type BridgeError =
  | { kind: 'disconnect'; reason?: string }
  | { kind: 'unknown'; info?: string };

export type User = {
  id: string | number;
  name: string;
};

type LoginStatus = { kind: 'ok' } | { kind: 'error'; info?: string };
export type PolledMessage = { msg: IncomingMessage; chat: ChatImpl };

export type IncomingMessageAsset = { location: [number, number] } & (
  | { kind: 'image'; data: () => MaybePromiseLike<Buffer> }
  | { kind: 'mention'; id: unknown; name: string }
);
export type SendingMessageAsset = { location?: [number, number] } & (
  | { kind: 'image'; data: MaybePromiseLike<Buffer> }
  | { kind: 'mention'; id: unknown; name: string }
);

type MessageCommon = {
  reply_to_id?: unknown; // Shamefully, it should be of the same type as id
  parser?: string;
  text: string;
};
export type SendingMessage = MessageCommon & {
  assets?: SendingMessageAsset[];
};
export type IncomingMessage = MessageCommon & {
  /** Raw message returned by the bridge, used for debugging */
  raw?: unknown;
  id: unknown;
  from?: User;
  reply_to?: () => MaybePromiseLike<IncomingMessage>;
  assets: IncomingMessageAsset[];
};

export type BridgeModuleType = {
  Bridge: new () => Bridge;
};
export async function load_bridge(name: string): Promise<Bridge> {
  using _ = global_log.region_tmpl()`Loading bridge ${name}`;
  const mod = (await import(`../bridge/${name}.js`)) as BridgeModuleType;
  return new mod.Bridge();
}
