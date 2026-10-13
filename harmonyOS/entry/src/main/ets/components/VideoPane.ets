import { KeyCode } from '@kit.InputKit';
import { MediaCacheProxy } from '../services/MediaCacheProxy';
import { LocalStore } from '../services/LocalStore';
import { util } from '@kit.ArkTS';
import { MediaReply, VideoNetwork } from '../services/VideoNetwork';
import { fileIo as fs, fileUri } from '@kit.CoreFileKit';
import { webview } from '@kit.ArkWeb';
import { MediaSource } from '../model/Media';
import { stamp } from '../model/Timeline';
import { PlaybackController, PlaybackCommand, PlaybackState } from '../services/PlaybackController';
interface PlayerLoad { autoplay?: boolean; hls: boolean; offline: boolean; url: string; live: boolean; offset: number; courseStart: number; at: number; rate: number; liveCourse: boolean; replay: boolean }
class VideoBridge {
  changed: (raw: string) => void = () => {};
  requested: (id: string, address: string, start: number, end: number) => void = () => {};
  requestMedia(id: string, address: string, start: number, end: number): void { this.requested(id, address, start, end); }
  tapped: () => void = () => {};
  update(raw: string): void { this.changed(raw); }
  clicked(): void { this.tapped(); }
  diagnostic(stage: string): void { console.info('[ZhiyunVideo] ' + stage.replace(/[^A-Za-z0-9_ .:=,-]/g, '').slice(0, 180)); }
}
@Component
export struct VideoPane {
  store: LocalStore | undefined = undefined;
  @Prop @Watch('sourceChanged') source: MediaSource | undefined = undefined;
  @Prop sources: MediaSource[] = [];
  @Prop courseStart: number = 0;
  @Prop @Watch('liveChanged') liveCourse: boolean = false;
  @Prop @Watch('replayChanged') replayEnabled: boolean = false;
  onReplay: () => void = () => {};
  onLive: () => void = () => {};
  @Prop autoplay: boolean = true;
  @Prop initialSeconds: number = 0;
  playback: PlaybackController = new PlaybackController();
  @Prop @Watch('fullscreenChanged') fullscreen: boolean = false;
  onFullscreen: () => void = () => {};
  onOverview: () => void = () => {};
  onState: (value: PlaybackState) => void = () => {};
  onClickVideo: () => void = () => {};
  onSource: (source: MediaSource) => void = () => {};
  @State state: PlaybackState = { time: 0, duration: 0, start: 0, end: 0, paused: true, rate: 1, error: '', live: false, width: 0, height: 0 };
  @State speedOpen: boolean = false;
  @State speedValue: number = 1;
  private speedDragging: boolean = false;
  private speedPending: boolean = false;
  private speedPendingAt: number = 0;
  private rateSentAt: number = 0;
  @State ready: boolean = false;
  @State changing: boolean = false;
  @State seekValue: number = 0;
  @State controlsVisible: boolean = true;
  @State paneWidth: number = 1000;
  private network: VideoNetwork = new VideoNetwork();
  private offlineFolder: string = '';
  private proxy: MediaCacheProxy = new MediaCacheProxy(this.network);
  private sourceEpoch: number = 0;
  private fallbackLoad: PlayerLoad | undefined = undefined;
  private recoverPlayer(value: PlaybackState): boolean {
    if (!value.error.startsWith('视频无法加载') || !this.fallbackLoad || !this.ready) return false;
    const load = this.fallbackLoad; this.fallbackLoad = undefined; this.proxy.stop(); this.network.cancel();
    load.at = value.time || load.at; value.error = ''; this.state = value;
    this.web.runJavaScript('Player.load(' + JSON.stringify(load) + ')').catch(() => {}); return true;
  }
  private web: webview.WebviewController = new webview.WebviewController();
  private bridge: VideoBridge = new VideoBridge();
  private controlsTimer: number = -1;
  aboutToAppear(): void {
    this.network.useCache(this.store);
    this.bridge.changed = (raw: string) => { try { const value = JSON.parse(raw) as PlaybackState; if (this.recoverPlayer(value)) return; this.state = value; if (!this.speedDragging && (!this.speedPending || Math.abs(value.rate - this.speedValue) < 0.025 || Date.now() - this.speedPendingAt > 1500)) { this.speedValue = value.rate; this.speedPending = false; } if (!this.changing) this.seekValue = value.time; this.onState(value); } catch (_) {} };
    this.bridge.requested = (id: string, address: string, start: number, end: number) => { this.mediaRequest(id, address, start, end); };
    this.bridge.tapped = () => { this.onClickVideo(); this.wakeControls(); };
    this.playback.bind((command: PlaybackCommand) => this.command(command));
    this.scheduleControlsHide();
  }
  aboutToDisappear(): void { clearTimeout(this.controlsTimer); this.command({ action: 'pause', value: 0 }); this.playback.unbind(); this.network.cancel(); this.proxy.stop(); this.sourceEpoch++; this.fallbackLoad = undefined; }
  private fullscreenChanged(): void { this.controlsVisible = true; this.scheduleControlsHide(); }
  private wakeControls(): void { this.controlsVisible = true; this.scheduleControlsHide(); }
  private scheduleControlsHide(): void {
    clearTimeout(this.controlsTimer);
    if (this.fullscreen && !this.speedOpen && !this.speedDragging && !this.changing) this.controlsTimer = setTimeout(() => this.controlsVisible = false, 3200);
  }
  private liveChanged(): void { if (this.ready) this.web.runJavaScript('Player.courseLive(' + this.liveCourse + ')').catch(() => {}); }
  private replayChanged(): void { this.speedOpen = false; this.speedValue = 1; if (this.ready) this.web.runJavaScript('Player.replay(' + this.replayEnabled + ')').catch(() => {}); }
  private command(command: PlaybackCommand): void {
    if (!this.ready || this.liveCourse && !this.replayEnabled && (command.action === 'seek' || command.action === 'rate')) return;
    const call = command.action === 'seek' || command.action === 'rate' ? `Player.${command.action}(${Number.isFinite(command.value) ? command.value : 0})` : command.action === 'live' ? 'Player.goLive()' : command.action === 'pause' ? 'Player.pause()' : 'Player.toggle()';
    this.web.runJavaScript(call).catch(() => {});
  }
  private sourceChanged(): void {
    if (!this.ready || !this.source) return;
    this.offlineFolder = ''; this.fallbackLoad = undefined; this.state = { time: this.initialSeconds, duration: 0, start: 0, end: 0, paused: true, rate: this.state.rate, error: '', live: this.source.live, width: 0, height: 0, frameReady: false };
    let address = this.source.url;
    if (address.startsWith('file://')) {
      try {
        const path = new fileUri.FileUri(address).path;
        if (/\.m3u8$/i.test(path)) { this.offlineFolder = path.slice(0, path.lastIndexOf('/')); address = 'https://offline.zhiyun.invalid/' + path.slice(path.lastIndexOf('/') + 1); }
        else address = 'file://' + path;
      } catch (_) {}
    }
    const load: PlayerLoad = { autoplay: this.autoplay, hls: !!this.source.hls || /\.m3u8(?:\?|$)/i.test(address), offline: this.source.url.startsWith('file://'), url: address, live: this.source.live, offset: this.source.offset, courseStart: this.courseStart, at: this.initialSeconds, rate: this.state.rate, liveCourse: this.liveCourse, replay: this.replayEnabled };
    const gen = ++this.sourceEpoch;
    const play = (): void => { if (gen !== this.sourceEpoch || !this.ready) return; this.web.runJavaScript('Player.load(' + JSON.stringify(load) + ')').catch(() => { this.state = { time: 0, duration: 0, start: 0, end: 0, paused: true, rate: 1, error: '播放器初始化失败，请重新打开视频', live: load.live, width: 0, height: 0 }; }); };
    if (!load.hls && !load.offline && /^https:\/\//.test(address) && /\.mp4(?:\?|$)/i.test(address)) this.proxy.start(address).then((local: string) => { if (gen !== this.sourceEpoch || !this.ready) return; this.fallbackLoad = { autoplay: load.autoplay, hls: load.hls, offline: load.offline, url: load.url, live: load.live, offset: load.offset, courseStart: load.courseStart, at: load.at, rate: load.rate, liveCourse: load.liveCourse, replay: load.replay }; load.url = local; play(); }).catch(() => play());
    else { this.proxy.stop(); play(); }
  }
  private offlineResponse(request: WebResourceRequest): WebResourceResponse {
    const address = request.getRequestUrl();
    if (!address.startsWith('https://offline.zhiyun.invalid/')) return null!;
    const response = new WebResourceResponse(); response.setResponseHeader([{ headerKey: 'Access-Control-Allow-Origin', headerValue: '*' }, { headerKey: 'Accept-Ranges', headerValue: 'bytes' }]);
    const relative = address.slice('https://offline.zhiyun.invalid/'.length).split('?')[0];
    if (!this.offlineFolder || !/^(?:audio\/)?[A-Za-z0-9_.-]+$/.test(relative) || relative.includes('..')) { response.setResponseCode(404); response.setResponseData(''); return response; }
    try {
      const path = this.offlineFolder + '/' + relative, size = fs.statSync(path).size;
      const range = request.getRequestHeader().find((h: Header) => h.headerKey.toLowerCase() === 'range')?.headerValue || '';
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      const start = match ? Number(match[1]) : 0;
      if (start >= size) { response.setResponseCode(416); response.setResponseData(''); return response; }
      const video = relative.endsWith('.mp4') && relative === 'video.mp4';
      const end = Math.min(size - 1, match && match[2] ? Number(match[2]) : (video ? start + 4 * 1024 * 1024 - 1 : size - 1));
      if (end < start || end - start > 96 * 1024 * 1024) throw new Error('片段过大');
      const data = new ArrayBuffer(end - start + 1), file = fs.openSync(path, fs.OpenMode.READ_ONLY);
      try { const read = fs.readSync(file.fd, data, { offset: start, length: data.byteLength }); if (read !== data.byteLength) throw new Error('文件读取失败'); } finally { fs.closeSync(file); }
      const partial = !!match || end < size - 1;
      const headers: Header[] = [{ headerKey: 'Access-Control-Allow-Origin', headerValue: '*' }, { headerKey: 'Accept-Ranges', headerValue: 'bytes' }, { headerKey: 'Content-Length', headerValue: String(data.byteLength) }];
      if (partial) headers.push({ headerKey: 'Content-Range', headerValue: `bytes ${start}-${end}/${size}` });
      response.setResponseHeader(headers); response.setResponseCode(partial ? 206 : 200); response.setReasonMessage(partial ? 'Partial Content' : 'OK');
      response.setResponseMimeType(relative.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : relative.endsWith('.mp4') || relative.endsWith('.m4s') ? 'video/mp4' : relative.endsWith('.ts') ? 'video/mp2t' : 'application/octet-stream');
      response.setResponseData(data); return response;
    } catch (_) { response.setResponseCode(404); response.setResponseData(''); return response; }
  }
  private async mediaRequest(id: string, address: string, start: number, end: number): Promise<void> {
    let reply: MediaReply;
    try {
      if (address.startsWith('https://offline.zhiyun.invalid/')) {
        const relative = address.slice('https://offline.zhiyun.invalid/'.length).split('?')[0];
        if (!this.offlineFolder || !/^(?:audio\/)?[A-Za-z0-9_.-]+$/.test(relative) || relative.includes('..')) throw new Error('视频片段不存在');
        const path = this.offlineFolder + '/' + relative, size = fs.statSync(path).size;
        if (relative.endsWith('.m3u8')) reply = { id, status: 200, text: fs.readTextSync(path), base64: '', size, mime: 'application/vnd.apple.mpegurl', error: '', contentRange: '' };
        else {
          const offset = Math.max(0, start), length = (end > offset ? Math.min(size, end) : size) - offset;
          if (length <= 0 || length > 96 * 1024 * 1024) throw new Error('视频片段不可用');
          const data = new ArrayBuffer(length), file = fs.openSync(path, fs.OpenMode.READ_ONLY);
          try { fs.readSync(file.fd, data, { offset, length }); } finally { fs.closeSync(file); }
          reply = { id, status: start >= 0 ? 206 : 200, text: '', base64: new util.Base64Helper().encodeToStringSync(new Uint8Array(data)), size: length, mime: 'application/octet-stream', error: '', contentRange: '' };
        }
      } else reply = await this.network.read(id, address, start, end);
    } catch (_) { reply = { id, status: 503, text: '', base64: '', size: 0, mime: '', error: '视频连接失败，请重试', contentRange: '' }; }
    if (this.ready) this.web.runJavaScript('Player.mediaReply(' + JSON.stringify(reply) + ')').catch(() => {});
  }
  private changeSpeed(value: number, mode: SliderChangeMode): void {
    this.speedValue = value;
    this.speedDragging = mode === SliderChangeMode.Begin || mode === SliderChangeMode.Moving;
    this.speedPending = true; this.speedPendingAt = Date.now(); this.wakeControls();
    if (!this.speedDragging || Date.now() - this.rateSentAt >= 80) { this.rateSentAt = Date.now(); this.playback.rate(value); }
  }
  @Builder
  private speedPopup() {
    Column({ space: 4 }) {
      Row() { Text('播放速度').fontSize(12).fontColor('#71839A'); Blank(); Text(this.speedValue.toFixed(2) + '×').fontSize(14).fontColor('#168BEE') }.width('100%')
      Slider({ value: this.speedValue, min: 0.1, max: 16, step: 0.01 }).width('100%').selectedColor('#168BEE').showTips(true).onChange((value: number, mode: SliderChangeMode) => this.changeSpeed(value, mode))
      Row() { Text('0.1×').fontSize(11).fontColor('#71839A'); Blank(); Button('恢复 1×').height(26).fontSize(11).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.changeSpeed(1, SliderChangeMode.Click)); Blank(); Text('16×').fontSize(11).fontColor('#71839A') }.width('100%')
    }.width(280).padding(14).backgroundColor('#FFFFFF').borderRadius(14)
  }
  @Builder
  private playerWeb() {
    Web({ src: $rawfile('player.html'), controller: this.web }).id('video-web').width('100%').height('100%')
      .javaScriptAccess(true).domStorageAccess(false).fileAccess(true).mediaPlayGestureAccess(false).mixedMode(MixedMode.None)
      .javaScriptProxy({ object: this.bridge, name: 'ClassroomBridge', methodList: ['update', 'clicked', 'requestMedia', 'diagnostic'], controller: this.web })
      .onInterceptRequest((event) => { if (!event) return null!; if (event.request.getRequestUrl().startsWith('https://offline.zhiyun.invalid/')) return this.offlineResponse(event.request); return null!; })
      .onKeyEventDispatch((event: KeyEvent): boolean => this.videoKey(event)).cacheMode(this.store?.runtimeCacheEnabled() === false ? CacheMode.None : CacheMode.Default).onPageEnd(() => { console.info('[ZhiyunVideo] page ready'); this.ready = true; this.sourceChanged(); })
  }
  @Builder
  private controlBar() {
    Row({ space: 7 }) {
      Button({ type: ButtonType.Normal }) { Image(this.state.paused ? $r('app.media.video_play') : $r('app.media.video_pause')).id(this.state.paused ? 'video-paused-icon' : 'video-playing-icon').width(24).height(24) }.id('video-toggle').width(40).height(36).padding(0).backgroundColor(Color.Transparent).borderRadius(18).accessibilityText(this.state.paused ? '播放' : '暂停').onClick(() => { this.wakeControls(); this.playback.toggle(); })
      Text(stamp(this.changing ? this.seekValue : this.state.time)).fontSize(11).fontColor('#D4D9E0').width(50)
      if ((!this.liveCourse || this.replayEnabled) && (!this.source?.live || this.state.seekable)) {
      Slider({ value: this.seekValue, min: this.state.start, max: Math.max(this.state.start + 1, this.state.end), step: 0.1 }).layoutWeight(1).selectedColor('#168BEE')
        .onChange((value: number, mode: SliderChangeMode) => { this.wakeControls(); this.changing = mode === SliderChangeMode.Begin || mode === SliderChangeMode.Moving; this.seekValue = value; if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) { this.playback.seek(value); this.onClickVideo(); } })
      } else { Text('直播').fontSize(11).fontColor('#D4D9E0').layoutWeight(1) }
      if (!this.liveCourse || this.replayEnabled) {
      Button(this.speedValue.toFixed(2).replace(/0$/, '') + '×').width(68).height(36).fontSize(12).backgroundColor(this.speedOpen ? '#314156' : '#252525').fontColor('#FFFFFF').borderRadius(18).border({ width: 1, color: Color.Transparent }).onClick(() => { this.speedOpen = !this.speedOpen; this.wakeControls(); }).bindPopup(this.speedOpen, { builder: this.speedPopup, placement: Placement.Top, enableArrow: true, autoCancel: true, onStateChange: (event) => { this.speedOpen = event.isVisible; if (!event.isVisible && this.speedDragging) this.changeSpeed(this.speedValue, SliderChangeMode.Click); this.scheduleControlsHide(); } })
      }
      if (this.liveCourse) { Button(this.replayEnabled ? '回到最新' : '回放').height(36).fontSize(12).backgroundColor('#252525').fontColor('#FFFFFF').borderRadius(18).onClick(() => { this.wakeControls(); if (this.replayEnabled) this.onLive(); else this.onReplay(); }) }
      Button(this.fullscreen ? '退出全屏' : '全屏').height(36).fontSize(12).backgroundColor('#252525').fontColor('#FFFFFF').borderRadius(18).border({ width: 1, color: Color.Transparent }).onClick(() => { this.wakeControls(); this.onFullscreen(); })
      if (this.fullscreen && this.paneWidth < 620) {
        Button('更多').height(36).fontSize(12).backgroundColor('#252525').fontColor('#FFFFFF').borderRadius(18).border({ width: 1, color: '#4A4A4A' }).bindMenu([
          { value: '课件概览', action: () => this.onOverview() }
        ])
      } else if (this.fullscreen) {
        Button('概览').height(36).fontSize(12).backgroundColor('#252525').fontColor('#FFFFFF').borderRadius(18).border({ width: 1, color: '#4A4A4A' }).onClick(() => this.onOverview())
      }
      if (this.sources.length > 1) {
        Button('机位').height(36).fontSize(12).backgroundColor('#252525').fontColor('#FFFFFF').borderRadius(18).border({ width: 1, color: Color.Transparent }).bindMenu(this.sources.map((s: MediaSource): MenuElement => { return { value: s.title, action: () => { this.onSource(s); this.wakeControls(); } }; }))
      }
    }.width('100%').padding({ left: 4, right: 4 }).backgroundColor(this.fullscreen ? '#B8000000' : Color.Transparent)
  }
  private videoKey(event: KeyEvent): boolean {
    if (event.type !== KeyType.Down || event.getModifierKeyState?.(['Ctrl']) || event.getModifierKeyState?.(['Alt']) || event.getModifierKeyState?.(['Shift'])) return false;
    if (event.keyCode === KeyCode.KEYCODE_SPACE) { this.playback.toggle(); this.wakeControls(); return true; }
    if (event.keyCode === KeyCode.KEYCODE_DPAD_LEFT || event.keyCode === KeyCode.KEYCODE_DPAD_RIGHT) { if (!this.liveCourse || this.replayEnabled) this.playback.seek(Math.max(this.state.start, Math.min(this.state.end || Number.MAX_SAFE_INTEGER, this.state.time + (event.keyCode === KeyCode.KEYCODE_DPAD_RIGHT ? 15 : -15)))); this.wakeControls(); return true; }
    if (event.keyText === '[' || event.keyText === ']') { if (!this.liveCourse || this.replayEnabled) this.playback.rate(Math.max(0.1, Math.min(16, this.state.rate + (event.keyText === ']' ? 0.1 : -0.1)))); this.wakeControls(); return true; }
    return false;
  }
  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column() {
        Stack({ alignContent: Alignment.TopStart }) {
          this.playerWeb()
        }.id('video-picture-area').width('100%').layoutWeight(1).backgroundColor('#000000').clip(true)
        if (!this.fullscreen) { Column() { this.controlBar() }.id('video-controls').width('100%').height(40).backgroundColor('#000000') }
      }.width('100%').height('100%')
      if (this.fullscreen && this.controlsVisible) { Column() { this.controlBar() }.id('video-controls').width('100%').height(40).align(Alignment.BottomStart) }
      if (this.state.error) { Text(this.state.error).fontSize(12).fontColor('#FFFFFF').backgroundColor('#00000088').padding(8).align(Alignment.Center) }
    }.width('100%').height('100%').backgroundColor('#000000').borderRadius(this.fullscreen ? 0 : 12).clip(true)
      .onAreaChange((oldArea: Area, newArea: Area) => this.paneWidth = Number(newArea.width))
  }
}
