import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopWindowBounds, DesktopRectangle } from '../src/desktop/windowGeometry';
const login = { width: 1000, height: 760, minWidth: 520, minHeight: 560 };
const main = { width: 1440, height: 940, minWidth: 720, minHeight: 540 };
function fits(work: DesktopRectangle, bounds: ReturnType<typeof desktopWindowBounds>) {
 assert.ok(bounds.x >= work.x && bounds.y >= work.y);
 assert.ok(bounds.x + bounds.width <= work.x + work.width && bounds.y + bounds.height <= work.y + work.height);
 assert.ok(bounds.width > 0 && bounds.height > 0);
 assert.ok(bounds.minWidth <= bounds.width && bounds.minHeight <= bounds.height);
}
test('official login window and its minimum fit a 1366x768 display after taskbar reservation', () => {
 const work = { x: 0, y: 0, width: 1366, height: 728 }, bounds = desktopWindowBounds(work, login);
 fits(work, bounds); assert.equal(bounds.width, 1000); assert.equal(bounds.height, 696); assert.equal(bounds.minHeight, 560);
});
test('main and login remain fully reachable on small work areas without oversized minimum constraints', () => {
 for (const width of [320, 640, 1024]) for (const height of [240, 500, 720]) for (const preferred of [main, login]) {
  const work = { x: 12, y: 34, width, height }; fits(work, desktopWindowBounds(work, preferred));
 }
});
test('login uses its parent display with negative desktop coordinates and clamps a partially offscreen parent', () => {
 const work = { x: -1920, y: -100, width: 1280, height: 720 };
 for (const owner of [{ x: -1850, y: 20, width: 800, height: 600 }, { x: -4000, y: -2000, width: 1500, height: 1200 }, { x: 4000, y: 5000, width: 1500, height: 1200 }]) fits(work, desktopWindowBounds(work, login, owner));
 const clamped = desktopWindowBounds(work, login, { x: -1850, y: 20, width: 800, height: 600 }); assert.equal(clamped.x, -1920);
 const centered = desktopWindowBounds(work, login, { x: -1700, y: 20, width: 800, height: 600 }); assert.equal(centered.x, -1800);
});
test('large displays preserve desired native sizes and center windows without stretching', () => {
 const work = { x: 1920, y: 50, width: 2560, height: 1400 };
 for (const preferred of [main, login]) { const bounds = desktopWindowBounds(work, preferred); fits(work, bounds); assert.equal(bounds.width, preferred.width); assert.equal(bounds.height, preferred.height); }
});
