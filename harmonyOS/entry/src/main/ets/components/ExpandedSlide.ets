import { PhotoViewport } from '../model/PhotoViewport';

@Component
export struct ExpandedSlide {
  @Prop @Watch('resetPhoto') slideId: string = '';
  @Prop uri: string = '';
  onTurn: (direction: number) => void = () => {};
  onClose: () => void = () => {};
  @State zoom: number = 1;
  @State offsetX: number = 0;
  @State offsetY: number = 0;
  private photo: PhotoViewport = new PhotoViewport();
  private pinching: boolean = false;
  private multipleTouches: boolean = false;
  private panZoomed: boolean = false;
  private lastMovement: number = 0;
  private syncPhoto(): void { this.zoom = this.photo.scale; this.offsetX = this.photo.x; this.offsetY = this.photo.y; }
  private resetPhoto(): void { this.photo.reset(); this.pinching = false; this.multipleTouches = false; this.syncPhoto(); }
  build() {
    Stack({ alignContent: Alignment.TopEnd }) {
      Stack() {
        Image(this.uri).id('expanded-slide').width('100%').height('100%').objectFit(ImageFit.Contain)
          .onComplete((event) => { if (event) { this.photo.image(event.width, event.height); this.syncPhoto(); } })
          .scale({ x: this.zoom, y: this.zoom }).translate({ x: this.offsetX, y: this.offsetY })
      }.width('100%').height('100%').backgroundColor('#000000').clip(true)
        .onAreaChange((oldArea: Area, area: Area) => { this.photo.resize(Number(area.width), Number(area.height)); this.syncPhoto(); })
        .onTouch((event: TouchEvent) => {
          if (event.type === TouchType.Down && event.touches.length === 1) this.multipleTouches = false;
          if (event.touches.length > 1) this.multipleTouches = true;
        })
        .gesture(GestureGroup(GestureMode.Exclusive,
          GestureGroup(GestureMode.Parallel,
            PinchGesture({ fingers: 2 })
              .onActionStart((event: GestureEvent) => { this.pinching = true; this.multipleTouches = true; this.photo.beginPinch(event.pinchCenterX, event.pinchCenterY); })
              .onActionUpdate((event: GestureEvent) => { this.photo.pinch(event.scale, event.pinchCenterX, event.pinchCenterY); this.syncPhoto(); this.lastMovement = Date.now(); })
              .onActionEnd(() => { this.pinching = false; this.lastMovement = Date.now(); })
              .onActionCancel(() => { this.pinching = false; this.lastMovement = Date.now(); }),
            PanGesture({ fingers: 1, direction: PanDirection.All, distance: 8 })
              .onActionStart(() => { this.panZoomed = this.zoom > 1; this.photo.beginPan(); })
              .onActionUpdate((event: GestureEvent) => { if (!this.pinching && !this.multipleTouches && this.panZoomed) { this.photo.pan(event.offsetX, event.offsetY); this.syncPhoto(); } this.lastMovement = Date.now(); })
              .onActionEnd((event: GestureEvent) => { if (!this.multipleTouches && !this.panZoomed && this.zoom === 1 && Math.abs(event.offsetX) > 50 && Math.abs(event.offsetX) > Math.abs(event.offsetY)) this.onTurn(event.offsetX > 0 ? -1 : 1); this.lastMovement = Date.now(); })
              .onActionCancel(() => this.lastMovement = Date.now())
          ),
          TapGesture({ count: 1 }).onAction(() => { if (!this.multipleTouches && Date.now() - this.lastMovement > 250) this.onClose(); })
        ))
      Button('返回课件').height(36).fontSize(12).backgroundColor('#252525').fontColor('#FFFFFF').margin(14).onClick(() => this.onClose())
    }.width('100%').height('100%').backgroundColor('#000000').clip(true)
  }
}
