/** Port: tells the user something happened while no terminal is open. */
export interface Notifier {
  /** Shows a notification; resolves false if it could not be shown. */
  notify(title: string, message: string): Promise<boolean>;
}
