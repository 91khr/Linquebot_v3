/**
 * Message between subprocess and supervisor.
 */
export interface SupervisorMessage {
  kind: 'reboot' | 'shutdown' | 'watchdog';
  message?: string;
}
