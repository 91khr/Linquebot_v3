import * as br from '@/lib/bridge.js';
import TelegramBot, { Message } from 'node-telegram-bot-api';

export class Bridge implements br.Bridge {
  bot: TelegramBot | undefined = undefined;
  msgqueue: Message[] = [];
  waker: ((msg: Message) => void) | undefined = undefined;

  login(login: {
    token: string;
  }): PromiseLike<{ kind: 'ok' } | { kind: 'error'; info?: string | undefined }> {
    this.bot = new TelegramBot(login.token, { polling: true });
    this.bot.on('message', (msg) => {
      if (this.waker) {
        const waker = this.waker;
        this.waker = undefined;
        waker(msg);
      } else {
        this.msgqueue.push(msg);
      }
    });
    return Promise.resolve({ kind: 'ok' });
  }
  logout(): PromiseLike<void> {
    return Promise.resolve();
  }
  async poll_message(): Promise<br.PolledMessage> {
    const msg = this.msgqueue.pop() ?? (await new Promise<Message>((res) => (this.waker = res)));
    return {
      msg: {
        id: msg.message_id,
        text: msg.text ?? '',
        assets: [],
      },
      chat: {
        id: String(msg.chat.id),
        send_message: async (smsg) => {
          await this.bot?.sendMessage(msg.chat.id, smsg.text, {
            reply_to_message_id: smsg.reply_to_id as number,
          });
        },
      },
    };
  }
  compare_message_id(a: Message, b: Message): number {
    return a.message_id === b.message_id ? 0 : a.message_id < b.message_id ? -1 : 1;
  }
}
