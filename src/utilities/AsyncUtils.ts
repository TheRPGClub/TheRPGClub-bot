export function safeIgnore(promise: Promise<unknown>): void {
  promise.catch(() => {});
}
