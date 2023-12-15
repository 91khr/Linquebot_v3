import { Chat } from '@/bridge/index.js';

export class App {
  chat: Chat;

  constructor({ chat }: { chat: Chat }) {
    this.chat = chat;
  }
}
