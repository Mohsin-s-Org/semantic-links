export class FoundationServices {
  private abortController: AbortController | null = null;
  private ready = false;

  start(): void {
    if (this.ready) {
      return;
    }

    this.abortController = new AbortController();
    this.ready = true;
  }

  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.ready = false;
  }

  get isReady(): boolean {
    return this.ready && this.abortController?.signal.aborted === false;
  }
}
