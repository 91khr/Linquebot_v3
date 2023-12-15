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
}

export interface Chat {
  send_message(msg: Message): PromiseLike<void>;
}

export type BridgeError =
  | { kind: 'disconnect'; reason?: string }
  | { kind: 'unknown'; info?: string };

export type User = {
  id: unknown;
  name: string;
};

type LoginStatus = { kind: 'ok' } | { kind: 'error'; info?: string };
export type PolledMessage = { msg: Message; chat: Chat };

export type MessageAsset = { location: [number, number] } & (
  | { kind: 'image'; data: Buffer }
  | { kind: 'mention'; id: unknown; name: string }
);

export type Message = {
  id: unknown;
  from?: User;
  reply_to?: unknown; // Shamefully, it should be of the same type as id
  parser?: string;
  text: string;
  assets: MessageAsset[];
};

export type BridgeModuleType = {
  Bridge: new () => Bridge;
};
export async function load_bridge(name: string): Promise<Bridge> {
  const mod = (await import(`./${name}.js`)) as BridgeModuleType;
  return new mod.Bridge();
}
