export interface PlaybackState { time: number; duration: number; start: number; end: number; paused: boolean; rate: number; error: string; live: boolean; width: number; height: number; seekable?: boolean; positionReady?: boolean; frameReady?: boolean }
export interface PlaybackCommand { action: string; value: number }
export class PlaybackController {
  private handler: ((command: PlaybackCommand) => void) | undefined = undefined;
  bind(handler: (command: PlaybackCommand) => void): void { this.handler = handler; }
  unbind(): void { this.handler = undefined; }
  seek(seconds: number): void { this.handler?.({ action: 'seek', value: seconds }); }
  rate(value: number): void { this.handler?.({ action: 'rate', value }); }
  goLive(): void { this.handler?.({ action: 'live', value: 0 }); }
  toggle(): void { this.handler?.({ action: 'toggle', value: 0 }); }
  pause(): void { this.handler?.({ action: 'pause', value: 0 }); }
}
