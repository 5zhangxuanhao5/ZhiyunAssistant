import { LengthMetrics } from '@kit.ArkUI';
import { STUDY_SURFACE, STUDY_RADIUS } from '../model/StudyStyle';
import { NativeSelections } from '../model/NativeSelections';
import { PaneRect, resizePane } from '../model/PaneLayout';
import { PaneHandles } from './PaneHandles';
@Builder function emptyPane() {}
@Component
export struct PaneFrame {
  @Prop rect: PaneRect = { id: '', x: 0, y: 0, w: 1, h: 1, z: 0 };
  @Prop canvasWidth: number = 1000;
  @Prop canvasHeight: number = 600;
  @Prop adjustable: boolean = true;
  @Prop controls: boolean = true;
  @Prop selected: boolean = false;
  @BuilderParam content: () => void = emptyPane;
  @Prop namespace: string = '';
  @Prop backgroundFocus: boolean = true;
  onBackgroundFocus: () => void = () => {};
  private focusBackground(): void { if (!this.backgroundFocus || NativeSelections.isHeld(this.rect.id)) return; NativeSelections.clearGroup(this.rect.id); this.onActivate(); this.onBackgroundFocus(); this.getUIContext().getFocusController().requestFocus(this.namespace + 'pane-key-' + this.rect.id); }
  private backgroundKey(event: KeyEvent): boolean { return this.backgroundFocus && ['transcript', 'summary'].includes(this.rect.id) && NativeSelections.keyGroup(this.rect.id, event); }
  onChange: (rect: PaneRect) => void = () => {};
  onActivate: () => void = () => {};
  onSelect: () => void = () => {};
  private start: PaneRect | undefined = undefined;
  private select(): void { this.onActivate(); if (this.adjustable) this.onSelect(); }
  private begin(): void { this.select(); this.start = { id: this.rect.id, x: this.rect.x, y: this.rect.y, w: this.rect.w, h: this.rect.h, z: this.rect.z }; }
  private move(event: GestureEvent): void { if (this.adjustable && this.start) this.onChange(resizePane(this.start, event.offsetX / Math.max(1, this.canvasWidth), event.offsetY / Math.max(1, this.canvasHeight), 'move')); }
  private handleWidth(): number { const width = this.rect.w * this.canvasWidth - 8; return Math.max(20, Math.min(56, Math.min(width, this.canvasWidth - this.rect.x * this.canvasWidth) - Math.max(0, -this.rect.x * this.canvasWidth) - 8)); }
  private handleX(): number { const width = this.rect.w * this.canvasWidth - 8, left = Math.max(0, -this.rect.x * this.canvasWidth), right = Math.min(width, this.canvasWidth - this.rect.x * this.canvasWidth); return Math.max(left, Math.min(right - this.handleWidth(), (width - this.handleWidth()) / 2)); }
  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      if (this.backgroundFocus) { Text('').id(this.namespace + 'pane-key-' + this.rect.id).width(1).height(1).focusable(true).focusOnTouch(false).focusBox({ strokeWidth: LengthMetrics.vp(0) }).hitTestBehavior(HitTestMode.None).onKeyPreIme((event: KeyEvent): boolean => this.backgroundKey(event)) }
      Column() { this.content() }.width('100%').height(this.controls ? 'calc(100% - 14vp)' : '100%').margin({ top: this.controls ? 14 : 0 })
      if (this.adjustable && this.selected) { PaneHandles({ rect: this.rect, canvasWidth: this.canvasWidth, canvasHeight: this.canvasHeight, movable: false, onChange: this.onChange }) }
      if (this.controls) {
        Stack({ alignContent: Alignment.Center }) {
          Column().width(30).height(3).backgroundColor(this.selected && this.adjustable ? '#168BEE' : '#A7B2BF').borderRadius(2)
        }.id('move-' + this.rect.id).width(this.handleWidth()).height(14).position({ x: this.handleX(), y: 0 })
          .onClick(() => this.select())
          .gesture(PanGesture({ direction: PanDirection.All, distance: 2 }).onActionStart(() => this.begin()).onActionUpdate((event: GestureEvent) => this.move(event)))
      }
    }.width('100%').height('100%').id(this.namespace + 'pane-' + this.rect.id).onClick(() => this.onActivate()).backgroundColor(STUDY_SURFACE).border({ width: this.selected && this.adjustable ? 1 : 0, color: '#168BEE' }).borderRadius(this.controls ? STUDY_RADIUS : 0).clip(true)
      .onTouch((event: TouchEvent) => { if (event.type === TouchType.Down) this.focusBackground(); })
  }
}
