import { pointer } from '@kit.InputKit';
import { PaneRect, resizePane } from '../model/PaneLayout';
@Component
export struct PaneHandles {
  @Prop rect: PaneRect = { id: '', x: 0, y: 0, w: 1, h: 1, z: 0 };
  @Prop canvasWidth: number = 1000;
  @Prop canvasHeight: number = 600;
  @Prop movable: boolean = true;
  @State active: string = '';
  onChange: (rect: PaneRect) => void = () => {};
  private start: PaneRect | undefined = undefined;
  aboutToDisappear(): void { this.cursor('', false); }
  private cursor(edge: string, hover: boolean): void {
    this.active = hover ? edge : '';
    try {
      const controller = this.getUIContext().getCursorController();
      if (!hover) { controller.restoreDefault(); return; }
      controller.setCursor(edge === 'n' || edge === 's' ? pointer.PointerStyle.NORTH_SOUTH : edge === 'e' || edge === 'w' ? pointer.PointerStyle.WEST_EAST : edge === 'nw' || edge === 'se' ? pointer.PointerStyle.NORTH_WEST_SOUTH_EAST : pointer.PointerStyle.NORTH_EAST_SOUTH_WEST);
    } catch (_) {}
  }
  private begin(edge: string): void { this.active = edge; this.start = { id: this.rect.id, x: this.rect.x, y: this.rect.y, w: this.rect.w, h: this.rect.h, z: this.rect.z }; }
  private move(event: GestureEvent, edge: string): void {
    if (this.start) this.onChange(resizePane(this.start, event.offsetX / Math.max(1, this.canvasWidth), event.offsetY / Math.max(1, this.canvasHeight), edge));
  }
  private frameWidth(): number { return Math.max(1, this.rect.w * this.canvasWidth - 8); }
  private frameHeight(): number { return Math.max(1, this.rect.h * this.canvasHeight - 8); }
  private corner(edge: string): boolean { return edge.length === 2; }
  private handleWidth(edge: string): number { return this.corner(edge) ? 18 : edge === 'n' || edge === 's' ? Math.max(1, this.frameWidth() - 36) : 10; }
  private handleHeight(edge: string): number { return this.corner(edge) ? 18 : edge === 'e' || edge === 'w' ? Math.max(1, this.frameHeight() - 36) : 10; }
  private x(edge: string): number { return edge.includes('e') ? Math.max(0, this.frameWidth() - this.handleWidth(edge)) : edge === 'n' || edge === 's' ? 18 : 0; }
  private y(edge: string): number { return edge.includes('s') ? Math.max(0, this.frameHeight() - this.handleHeight(edge)) : edge === 'e' || edge === 'w' ? 18 : 0; }
  @Builder
  private handle(edge: string) {
    Column().id('resize-' + this.rect.id + '-' + edge).width(this.handleWidth(edge)).height(this.handleHeight(edge)).position({ x: this.x(edge), y: this.y(edge) }).borderRadius(4)
      .backgroundColor(Color.Transparent)
      .onHover((hover: boolean) => { this.cursor(edge, hover); })
      .gesture(PanGesture({ direction: PanDirection.All, distance: 1 }).onActionStart(() => this.begin(edge)).onActionUpdate((event: GestureEvent) => this.move(event, edge)).onActionEnd(() => this.active = '').onActionCancel(() => this.active = ''))
  }
  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      this.handle('n')
      this.handle('s')
      this.handle('w')
      this.handle('e')
      this.handle('nw')
      this.handle('ne')
      this.handle('sw')
      this.handle('se')
      if (this.movable) {
        Column().id('move-' + this.rect.id).width(80).height(10).backgroundColor(Color.Transparent).position({ x: Math.max(0, (this.frameWidth() - 80) / 2), y: 0 })
          .gesture(PanGesture({ direction: PanDirection.All, distance: 2 }).onActionStart(() => this.begin('move')).onActionUpdate((event: GestureEvent) => this.move(event, 'move')).onActionEnd(() => this.active = '').onActionCancel(() => this.active = ''))
      }
    }.width('100%').height('100%').hitTestBehavior(HitTestMode.Transparent)
  }
}
