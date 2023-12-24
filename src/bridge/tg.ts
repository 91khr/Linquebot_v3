import * as br from '@/lib/bridge.js';
import { BridgeConfig } from '@/lib/config.js';
import { global_log } from '@/lib/logger.js';
import { MaybePromiseLike } from '@/lib/utils.js';
import TelegramBot, { Message } from 'node-telegram-bot-api';

const mkmsg = (msg: Message): br.IncomingMessage => ({
  id: msg.message_id,
  from: msg.from
    ? ((user) => ({
        id: user.id.toString(),
        name:
          (user.first_name ?? user.username ?? '') + (user.last_name ? ' ' + user.last_name : ''),
      }))(msg.from)
    : undefined,
  raw: msg,
  text: msg.text ?? '',
  assets: [],
  reply_to_id: msg.reply_to_message?.message_id,
  reply_to: () => mkmsg(msg),
});

class Chat implements br.ChatImpl {
  id: number;
  bot: TelegramBot;
  constructor(id: number, bot: TelegramBot) {
    this.id = id;
    this.bot = bot;
  }
  async delete_message(id: unknown): Promise<void> {
    await this.bot.deleteMessage(this.id, id as number);
  }
  async send_message(msg: br.SendingMessage): Promise<br.IncomingMessage> {
    const media: Buffer[] = [];
    for (const asset of msg.assets ?? []) {
      if (asset.kind === 'mention') {
        if (!asset.location) continue;
        const username = (await this.bot.getChatMember(this.id, asset.id as number)).user.username;
        if (!username) continue;
        msg.text =
          msg.text.substring(0, asset.location[0]) +
          username +
          msg.text.substring(asset.location[1]);
      } else if (asset.kind === 'image') {
        media.push(await asset.data);
      }
    }
    let outmsg;
    if (media.length === 0)
      outmsg = await this.bot?.sendMessage(this.id, msg.text, {
        reply_to_message_id: msg.reply_to_id as number,
      });
    else if (media.length === 1)
      outmsg = await this.bot.sendPhoto(this.id, media[0], {
        reply_to_message_id: msg.reply_to_id as number | undefined,
        caption: msg.text,
      });
    else throw new Error('Sending multiple files is not implemented currently');
    return mkmsg(outmsg);
  }
}

type TgConfig = BridgeConfig & {
  login: { token: string };
  ignore_delay: number;
};

export class Bridge implements br.Bridge {
  bot: TelegramBot | undefined = undefined;
  conf: TgConfig | undefined = undefined;
  msgqueue: Message[] = [];
  waker: ((msg: Message) => void) | undefined = undefined;

  login(
    conf: BridgeConfig
  ): MaybePromiseLike<{ kind: 'ok' } | { kind: 'error'; info?: string | undefined }> {
    this.conf = conf as TgConfig;
    try {
      this.bot = new TelegramBot(this.conf.login.token, { polling: true });
      this.bot.on('message', (msg) => {
        if (this.waker) {
          const waker = this.waker;
          this.waker = undefined;
          waker(msg);
        } else {
          this.msgqueue.push(msg);
        }
      });
    } catch (e) {
      if (!(e instanceof Error)) throw e;
      return { kind: 'error', info: e.message };
    }
    return { kind: 'ok' };
  }
  logout(): MaybePromiseLike<void> {}
  async poll_message(): Promise<br.PolledMessage> {
    const msg = await (async () => {
      const now = Date.now() / 1000;
      while (true) {
        const got =
          this.msgqueue.pop() ?? (await new Promise<Message>((res) => (this.waker = res)));
        if (got.date - now >= this.conf!.ignore_delay) {
          global_log.tmpl()`忽略古老消息: ${got.text}`;
          continue;
        }
        return got;
      }
    })();
    return {
      msg: mkmsg(msg),
      chat: new Chat(msg.chat.id, this.bot!),
    };
  }
  compare_message_id(a: Message, b: Message): number {
    return a.message_id === b.message_id ? 0 : a.message_id < b.message_id ? -1 : 1;
  }
}
