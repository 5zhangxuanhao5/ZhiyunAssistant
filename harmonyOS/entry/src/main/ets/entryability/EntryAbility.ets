import { UIAbility, Want, AbilityConstant } from '@kit.AbilityKit';
import { window, display } from '@kit.ArkUI';
import { webview } from '@kit.ArkWeb';
export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    webview.WebviewController.initializeWebEngine();
    AppStorage.setOrCreate<boolean>('foreground', true);
    ['safeTop', 'safeBottom', 'safeLeft', 'safeRight'].forEach((name: string) => AppStorage.setOrCreate<number>(name, 0));
    try {
    const d = display.getDefaultDisplaySync();
    AppStorage.setOrCreate<number>('screenWidth', d.width / d.densityPixels);
    AppStorage.setOrCreate<number>('screenHeight', d.height / d.densityPixels);
    } catch (_) {}
  }
  onWindowStageCreate(stage: window.WindowStage): void {
    stage.getMainWindow().then((win: window.Window) => {
      win.setWindowLayoutFullScreen(true).then(() => this.safeAreas(win)).catch(() => {});
      win.setWindowSystemBarProperties({ statusBarColor: '#00000000', navigationBarColor: '#00000000', statusBarContentColor: '#294765', navigationBarContentColor: '#294765' }).catch(() => {});
      win.on('avoidAreaChange', () => this.safeAreas(win));
      win.on('windowSizeChange', () => this.safeAreas(win));

    }).catch(() => {});
    stage.loadContent('pages/Index');
  }
  private safeAreas(win: window.Window): void {
    try {
      const density = display.getDefaultDisplaySync().densityPixels;
      const areas = [win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM), win.getWindowAvoidArea(window.AvoidAreaType.TYPE_CUTOUT), win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR)];
      AppStorage.setOrCreate<number>('safeTop', Math.max(...areas.map((a: window.AvoidArea) => a.topRect.height)) / density);
      AppStorage.setOrCreate<number>('safeBottom', Math.max(...areas.map((a: window.AvoidArea) => a.bottomRect.height)) / density);
      AppStorage.setOrCreate<number>('safeLeft', Math.max(...areas.map((a: window.AvoidArea) => a.leftRect.width)) / density);
      AppStorage.setOrCreate<number>('safeRight', Math.max(...areas.map((a: window.AvoidArea) => a.rightRect.width)) / density);
    } catch (_) {}
  }
  onForeground(): void { AppStorage.setOrCreate<boolean>('foreground', true); }
  onBackground(): void { AppStorage.setOrCreate<boolean>('foreground', false); }
}
