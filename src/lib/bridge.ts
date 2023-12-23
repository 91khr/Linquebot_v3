import { global_log } from '@/lib/logger.js';

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
  login(login: unknown): PromiseLike<LoginStatus>;
  /** Log the bot out */
  logout(): PromiseLike<void>;
  poll_message(): PromiseLike<PolledMessage>;
  compare_message_id(a: unknown, b: unknown): number;
}

export type ChatImpl = {
  id: string;
  send_message(msg: SendingMessage): PromiseLike<void>;
};
type Replace<T, U> = {
  [k in keyof T | keyof U]: k extends keyof U ? U[k] : k extends keyof T ? T[k] : never;
};
export type Chat = Replace<
  ChatImpl,
  {
    send_message(msg: SendingMessage | string): PromiseLike<void>;
    send_text_tmpl(ss: TemplateStringsArray, ...sv: unknown[]): PromiseLike<void>;
  }
>;

export type BridgeError =
  | { kind: 'disconnect'; reason?: string }
  | { kind: 'unknown'; info?: string };

export type User = {
  id: string;
  name: string;
};

type LoginStatus = { kind: 'ok' } | { kind: 'error'; info?: string };
export type PolledMessage = { msg: IncomingMessage; chat: ChatImpl };

export type IncomingMessageAsset = { location: [number, number] } & (
  | { kind: 'image'; data: () => PromiseLike<Buffer> }
  | { kind: 'mention'; id: unknown; name: string }
);
export type SendingMessageAsset = { location?: [number, number] } & (
  | { kind: 'image'; data: PromiseLike<Buffer> }
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
  reply_to?: () => PromiseLike<IncomingMessage>;
  assets: IncomingMessageAsset[];
};

export type BridgeModuleType = {
  Bridge: new () => Bridge;
};
export async function load_bridge(name: string): Promise<Bridge> {
  using _ = global_log.region_tmpl()`Loading bridge ${name}`;
  const mod = (await import(`./${name}.js`)) as BridgeModuleType;
  return new mod.Bridge();
}