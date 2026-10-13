export interface DesktopRectangle { x: number; y: number; width: number; height: number }
export interface PreferredWindowSize { width: number; height: number; minWidth: number; minHeight: number }

/** Outer window bounds, including the native frame, within one display's work area. */
export function desktopWindowBounds(work: DesktopRectangle, preferred: PreferredWindowSize, owner?: DesktopRectangle) {
  const workWidth = Math.max(1, Math.floor(work.width)), workHeight = Math.max(1, Math.floor(work.height));
  const width = Math.max(1, Math.min(Math.floor(preferred.width), workWidth - 32));
  const height = Math.max(1, Math.min(Math.floor(preferred.height), workHeight - 32));
  const anchor = owner || { ...work, width: workWidth, height: workHeight };
  const x = Math.max(work.x, Math.min(work.x + workWidth - width, Math.floor(anchor.x + (anchor.width - width) / 2)));
  const y = Math.max(work.y, Math.min(work.y + workHeight - height, Math.floor(anchor.y + (anchor.height - height) / 2)));
  return { x, y, width, height, minWidth: Math.max(1, Math.min(Math.floor(preferred.minWidth), width)), minHeight: Math.max(1, Math.min(Math.floor(preferred.minHeight), height)) };
}
