// Coordinates are vp in the fixed viewport; only the image is transformed.
export class PhotoViewport {
  scale: number = 1;
  x: number = 0;
  y: number = 0;
  private width: number = 1;
  private height: number = 1;
  private sourceWidth: number = 1;
  private sourceHeight: number = 1;
  private startScale: number = 1;
  private anchorX: number = 0;
  private anchorY: number = 0;
  private panX: number = 0;
  private panY: number = 0;
  reset(): void { this.scale = 1; this.x = 0; this.y = 0; }
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    if (this.width !== width || this.height !== height) { this.width = width; this.height = height; this.reset(); }
  }
  image(width: number, height: number): void {
    if (width > 0 && height > 0) { this.sourceWidth = width; this.sourceHeight = height; this.clamp(); }
  }
  beginPinch(centerX: number, centerY: number): void {
    this.startScale = this.scale;
    this.anchorX = (centerX - this.width / 2 - this.x) / this.scale;
    this.anchorY = (centerY - this.height / 2 - this.y) / this.scale;
  }
  pinch(factor: number, centerX: number, centerY: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.scale = Math.max(1, Math.min(8, this.startScale * factor));
    this.x = centerX - this.width / 2 - this.anchorX * this.scale;
    this.y = centerY - this.height / 2 - this.anchorY * this.scale;
    this.clamp();
  }
  beginPan(): void { this.panX = this.x; this.panY = this.y; }
  pan(offsetX: number, offsetY: number): void { this.x = this.panX + offsetX; this.y = this.panY + offsetY; this.clamp(); }
  private clamp(): void {
    const fit = Math.min(this.width / this.sourceWidth, this.height / this.sourceHeight);
    const limitX = Math.max(0, (this.sourceWidth * fit * this.scale - this.width) / 2);
    const limitY = Math.max(0, (this.sourceHeight * fit * this.scale - this.height) / 2);
    this.x = Math.max(-limitX, Math.min(limitX, this.x));
    this.y = Math.max(-limitY, Math.min(limitY, this.y));
    if (this.scale === 1) { this.x = 0; this.y = 0; }
  }
}
