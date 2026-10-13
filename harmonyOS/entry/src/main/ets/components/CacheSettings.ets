import { ExtraCacheEntry } from '../model/CacheInventory';
import { webview } from '@kit.ArkWeb';
import { LocalStore } from '../services/LocalStore';
import { CACHE_KINDS, CacheEntry, cacheLabel } from '../services/FeatureCache';
import { CourseFolder, studyFolders, lessonLabel, selectedUnion } from '../model/StudyFolders';
@Component
export struct CacheSettings {
  @Prop @Watch('systemBack') backSequence: number = 0;
  store: LocalStore | undefined = undefined;
  onClose: () => void = () => {};
  @State extraRows: ExtraCacheEntry[] = [];
  private extraKind(): boolean { return ['catalogue', 'legacy', 'runtime'].includes(this.category); }
  private extraLabel(kind: string): string { return kind === 'catalogue' ? '课表与访问状态' : kind === 'legacy' ? '历史遗留缓存' : '网页资源与临时文件'; }
  private explanation(kind: string): string { return kind === 'slides' ? '已浏览课件原图、去黑边图片和重复页识别数据' : kind === 'transcript' ? '回放转写与本机收到的直播转写' : kind === 'video' ? '在线播放产生的视频片段，不含离线下载' : kind === 'chat' ? '每节课的问答历史及回答中的引用信息' : kind === 'summary' ? '各页速览回答、历史版本和阅读位置' : kind === 'vision' ? 'AI 读过的课件文字、公式和图表，供多个功能复用' : kind === 'smartSkip' ? 'AI 判断杂音、课间等可跳过片段的结果' : kind === 'catalogue' ? '课表、搜索结果、课次目录和权限核验记录' : kind === 'legacy' ? '旧版或其他账号留下的普通缓存，不含笔记和离线课程' : '网页内核资源、应用运行临时文件；使用中可能重新产生'; }
  private byteLabel(bytes: number): string { return bytes >= 1073741824 ? (bytes / 1073741824).toFixed(2) + ' GB' : bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.ceil(bytes / 1024) + ' KB'; }
  @State revision: number = 0;
  @State error: string = '';
  private enable(kind: string, value: boolean): void { try { this.store?.cache.setEnabled(kind, value); this.error = ''; } catch (_) { this.error = '未能保存设置，请检查本机可用空间'; } this.update(); }
  @State category: string = '';
  @State folderId: string = '';
  @State selected: string[] = [];
  @State entries: CacheEntry[] = [];
  private update(): void { this.extraRows = this.extraKind() ? this.store?.extraCaches(this.category) || [] : []; this.entries = this.category && !this.extraKind() ? this.store?.cache.list(this.category) || [] : []; this.revision++; }
  private folders(): CourseFolder[] { return studyFolders(this.entries.map((entry: CacheEntry) => entry.course)); }
  private storageSize(kind: string, subId: string = ''): string { const bytes = this.store?.cache.bytes(kind, subId ? [subId] : []) || 0; return bytes >= 1073741824 ? (bytes / 1073741824).toFixed(2) + ' GB' : (bytes / 1048576).toFixed(1) + ' MB'; }
  private systemBack(): void { if (this.backSequence > 0) this.back(); }
  private back(): void { if (this.folderId) this.folderId = ''; else if (this.category) { this.category = ''; this.selected = []; } else this.onClose(); }
  private clear(kind: string, ids: string[] = []): void { this.store?.cache.clear(kind, ids); this.selected = []; this.update(); }
  private clearAll(): void { try { webview.WebviewController.removeAllCache(true); this.store?.clearAllCaches(); this.selected = []; this.error = ''; } catch (_) { this.error = '部分缓存未能清理，请重试'; } this.update(); }
  private clearExtras(kind: string, ids: string[] = []): void { try { if (kind === 'runtime') webview.WebviewController.removeAllCache(true); this.store?.clearExtraCaches(kind, ids); this.selected = []; this.error = ''; } catch (_) { this.error = '部分运行文件正在使用，稍后可继续清理'; } this.update(); }
  build() {
    Column({ space: 12 }) {
      Row({ space: 8 }) { Button('返回').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.back()); Text(this.category ? (this.extraKind() ? this.extraLabel(this.category) : cacheLabel(this.category) + '缓存') : '缓存设置').fontSize(22).fontWeight(FontWeight.Bold).fontColor('#20344D').layoutWeight(1); if (!this.category) { Button('清理全部缓存').height(32).fontSize(12).fontColor('#B44747').backgroundColor('#FCEEEE').onClick(() => this.clearAll()) } }.width('100%')
      if (this.error) { Text(this.error).fontSize(12).fontColor('#B44747').width('100%') }
      if (!this.category) {
        Text('清理范围包含课件衍生图片、转写、视频片段、AI记录、课程目录、旧版与其他账号缓存、网页与临时文件。笔记、离线下载、学习进度、收藏和登录资料属于保留的数据；运行组件可能重新产生少量缓存。').fontSize(13).fontColor('#71839A').width('100%')
        List({ space: 12 }) {
          ForEach(CACHE_KINDS, (kind: string) => { ListItem() {
            Column({ space: 10 }) {
              Row() { Text(cacheLabel(kind)).fontSize(17).fontColor('#20344D').layoutWeight(1); Text(this.storageSize(kind)).fontSize(12).fontColor('#71839A') }.width('100%')
              Text(this.explanation(kind)).fontSize(12).fontColor('#71839A').width('100%')
              Row({ space: 10 }) {
                Toggle({ type: ToggleType.Switch, isOn: this.store?.cache.enabled(kind) !== false }).selectedColor('#168BEE').onChange((value: boolean) => { this.enable(kind, value); })
                Text('保存缓存').fontSize(12).fontColor('#71839A').layoutWeight(1)
                Button('全部清理').height(32).fontSize(12).fontColor('#B44747').backgroundColor('#FCEEEE').onClick(() => this.clear(kind))
                Button('查看详情').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => { this.category = kind; this.folderId = ''; this.selected = []; this.update(); })
              }.width('100%')
            }.padding(16).width('100%').backgroundColor('#FFFFFF').borderRadius(14)
          } }, (kind: string) => kind + ':' + this.revision)
          ForEach(['catalogue', 'runtime', 'legacy'], (kind: string) => { ListItem() {
            Column({ space: 10 }) {
              Row() { Text(this.extraLabel(kind)).fontSize(17).fontColor('#20344D').layoutWeight(1); Text(this.byteLabel((this.store?.extraCaches(kind) || []).reduce((bytes: number, entry: ExtraCacheEntry) => bytes + entry.bytes, 0))).fontSize(12).fontColor('#71839A') }.width('100%')
              Text(this.explanation(kind)).fontSize(12).fontColor('#71839A').width('100%')
              Row({ space: 8 }) { if (kind !== 'legacy') { Toggle({ type: ToggleType.Switch, isOn: kind === 'catalogue' ? this.store?.catalogueCacheEnabled() !== false : this.store?.runtimeCacheEnabled() !== false }).selectedColor('#168BEE').onChange((value: boolean) => { if (kind === 'catalogue') this.store?.setCatalogueCacheEnabled(value); else this.store?.setRuntimeCacheEnabled(value); }); Text('保存缓存').fontSize(12).fontColor('#71839A').layoutWeight(1); } else { Text('兼容数据，仅用于清理').fontSize(12).fontColor('#71839A').layoutWeight(1) } Button('全部清理').height(32).fontSize(12).fontColor('#B44747').backgroundColor('#FCEEEE').onClick(() => this.clearExtras(kind)); Button('查看详情').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => { this.category = kind; this.selected = []; this.update(); }) }.width('100%')
              if (kind === 'runtime') { Text('网页内核缓存由系统管理，清理时会一并清除；上方显示可统计的临时文件大小。').fontSize(12).fontColor('#71839A').width('100%') }
            }.padding(16).width('100%').backgroundColor('#FFFFFF').borderRadius(14)
          } }, (kind: string) => kind + ':' + this.revision)

        }.layoutWeight(1).width('100%')
      } else if (this.extraKind()) {
        Row({ space: 8 }) { Button('全选').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.selected = this.extraRows.filter((entry: ExtraCacheEntry) => !entry.protected).map((entry: ExtraCacheEntry) => entry.id)); Text('已选 ' + this.selected.length).fontSize(12).fontColor('#71839A').layoutWeight(1); Button('清理所选').height(32).fontSize(12).fontColor('#B44747').backgroundColor('#FCEEEE').enabled(this.selected.length > 0).onClick(() => this.clearExtras(this.category, this.selected)) }.width('100%')
        List({ space: 10 }) { ForEach(this.extraRows, (entry: ExtraCacheEntry) => { ListItem() { Row({ space: 8 }) { Checkbox().enabled(!entry.protected).select(this.selected.includes(entry.id)).onChange((value: boolean) => this.selected = value ? selectedUnion(this.selected, [entry.id], true) : this.selected.filter((id: string) => id !== entry.id)); Text(entry.label).fontSize(15).fontColor('#20344D').layoutWeight(1); Text(this.byteLabel(entry.bytes)).fontSize(12).fontColor('#71839A') }.width('100%').padding(14).backgroundColor('#FFFFFF').borderRadius(12) } }, (entry: ExtraCacheEntry) => entry.id) }.layoutWeight(1).width('100%')
        if (!this.extraRows.length) { Text('暂无缓存').fontColor('#71839A') }
      } else {
        Row({ space: 8 }) { Button('全选').height(32).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.selected = selectedUnion(this.selected, this.entries.filter((entry: CacheEntry) => !this.folderId || (entry.course.courseId || entry.course.title) === this.folderId).map((entry: CacheEntry) => entry.course.subId), true)); Text('已选 ' + this.selected.length).fontSize(12).fontColor('#71839A').layoutWeight(1); Button('清理所选').height(32).fontSize(12).fontColor('#B44747').backgroundColor('#FCEEEE').enabled(this.selected.length > 0).onClick(() => this.clear(this.category, this.selected)) }.width('100%')
        List({ space: 10 }) {
          if (!this.folderId) {
            ForEach(this.folders(), (folder: CourseFolder) => { ListItem() { Row({ space: 8 }) { Checkbox().select(folder.lessons.every((lesson) => this.selected.includes(lesson.subId))).onChange((checked: boolean) => this.selected = selectedUnion(this.selected, folder.lessons.map((lesson) => lesson.subId), checked)); Column({ space: 5 }) { Text(folder.title).fontSize(16).fontColor('#20344D'); Text(folder.lessons.length + ' 次上课').fontSize(12).fontColor('#71839A') }.alignItems(HorizontalAlign.Start).layoutWeight(1).onClick(() => this.folderId = folder.id); Button('进入 ›').height(32).fontSize(12).fontColor('#168BEE').backgroundColor(Color.Transparent).onClick(() => this.folderId = folder.id) }.padding(14).width('100%').backgroundColor('#FFFFFF').borderRadius(12) } }, (folder: CourseFolder) => folder.id)
          } else {
            ForEach(this.entries.filter((entry: CacheEntry) => (entry.course.courseId || entry.course.title) === this.folderId), (entry: CacheEntry) => { ListItem() { Row({ space: 10 }) { Checkbox().select(this.selected.includes(entry.course.subId)).onChange((checked: boolean) => this.selected = selectedUnion(this.selected, [entry.course.subId], checked)); Column({ space: 5 }) { Text(lessonLabel(entry.course)).fontSize(16).fontColor('#20344D'); Text(this.storageSize(this.category, entry.course.subId)).fontSize(12).fontColor('#71839A') }.layoutWeight(1).alignItems(HorizontalAlign.Start) }.padding(14).width('100%').backgroundColor('#FFFFFF').borderRadius(12) } }, (entry: CacheEntry) => entry.course.subId)
          }
        }.layoutWeight(1).width('100%')
        if (!this.entries.length) { Text('暂无缓存').fontColor('#71839A') }
      }
    }.padding(16).width('100%').height('100%').backgroundColor('#F1F3F5')
  }
}
