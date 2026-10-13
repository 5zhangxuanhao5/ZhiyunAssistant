export function pointerSelection(source: SourceType, tool: SourceTool): boolean {
  return source === SourceType.Mouse || tool === SourceTool.MOUSE || tool === SourceTool.TOUCHPAD;
}
