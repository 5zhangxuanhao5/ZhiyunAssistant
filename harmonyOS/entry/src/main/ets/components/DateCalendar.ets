import { CalendarCell, calendarMonthGrid, shiftCalendarMonth } from '../model/CourseSections';
import { Course, shanghaiDate } from '../model/Timeline';
@Component
export struct DateCalendar {
  @Prop selectedDate: string = shanghaiDate(Date.now() / 1000);
  @Prop courses: Course[] = [];
  @Prop knownDates: boolean = true;
  @Prop title: string = '选择日期';
  @State month: string = '';
  @State availableHeight: number = 600;
  onSelect: (date: string) => void = () => {};
  onClose: () => void = () => {};
  aboutToAppear(): void { this.month = this.selectedDate.slice(0, 7); }
  private suppressDateUntil: number = 0;
  private shift(amount: number): void { this.month = shiftCalendarMonth(this.month, amount); }
  private gridHeight(): number { return Math.max(210, Math.min(390, this.availableHeight - 210)); }
  build() {
    Column({ space: 20 }) {
      Row() { Text(this.title).fontSize(22).fontWeight(FontWeight.Bold).fontColor('#20344D').layoutWeight(1); Button('返回').height(32).fontSize(12).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.onClose()) }.width('100%')
      Column({ space: 16 }) {
        Row({ space: 4 }) {
          Button('«').accessibilityText('上一年').width(32).height(32).padding(0).backgroundColor(Color.Transparent).fontColor('#71839A').onClick(() => this.shift(-12))
          Button('‹').accessibilityText('上个月').width(32).height(32).padding(0).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.shift(-1))
          Text(this.month.replace('-', '年') + '月').layoutWeight(1).fontSize(17).fontWeight(FontWeight.Medium).fontColor('#20344D').textAlign(TextAlign.Center)
          Button('›').accessibilityText('下个月').width(32).height(32).padding(0).backgroundColor('#EAF4FF').fontColor('#168BEE').onClick(() => this.shift(1))
          Button('»').accessibilityText('下一年').width(32).height(32).padding(0).backgroundColor(Color.Transparent).fontColor('#71839A').onClick(() => this.shift(12))
        }.width('100%')
        Row() { ForEach(['一','二','三','四','五','六','日'], (day: string) => { Text(day).layoutWeight(1).textAlign(TextAlign.Center).fontSize(12).fontColor('#889AAF') }, (day: string) => day) }.width('100%')
        ForEach([this.month], (displayMonth: string) => { Grid() {
          ForEach(calendarMonthGrid(displayMonth, this.knownDates ? this.courses : []), (cell: CalendarCell) => {
            GridItem() { Column({ space: 3 }) {
              Text(cell.day).fontSize(16).fontWeight(cell.count || cell.date === this.selectedDate ? FontWeight.Medium : FontWeight.Normal).fontColor(cell.date === this.selectedDate ? '#FFFFFF' : cell.count ? '#168BEE' : '#53657A')
              if (cell.inMonth) { Text(cell.count ? cell.count + ' 节' : ' ').fontSize(9).fontColor(cell.date === this.selectedDate ? '#FFFFFF' : '#168BEE') }
            }.width('100%').height('100%').justifyContent(FlexAlign.Center).borderRadius(10).backgroundColor(cell.date === this.selectedDate ? '#168BEE' : cell.count ? '#F1F7FD' : Color.Transparent).enabled(cell.inMonth).onClick(() => { if (cell.inMonth && Date.now() >= this.suppressDateUntil) this.onSelect(cell.date); }) }
          }, (cell: CalendarCell) => cell.key)
        }.columnsTemplate('1fr 1fr 1fr 1fr 1fr 1fr 1fr').rowsTemplate('1fr 1fr 1fr 1fr 1fr 1fr').columnsGap(4).rowsGap(4).width('100%').height(this.gridHeight()) }, (displayMonth: string) => displayMonth)
        Row() { if (this.knownDates) { Text('蓝色日期有上课记录').fontSize(11).fontColor('#889AAF').layoutWeight(1) } else { Blank().layoutWeight(1) } Button('今天').height(30).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF').onClick(() => this.onSelect(shanghaiDate(Date.now() / 1000))) }.width('100%')
      }.width('100%').constraintSize({ maxWidth: 640 }).padding(16).backgroundColor('#FFFFFF').borderRadius(18)
      Blank().layoutWeight(1)
    }.width('100%').layoutWeight(1).padding(20).backgroundColor('#F1F3F5').onAreaChange((oldArea: Area, area: Area) => this.availableHeight = Number(area.height))
      .parallelGesture(PanGesture({ direction: PanDirection.Horizontal, distance: 18 }).onActionStart(() => this.suppressDateUntil = Number.MAX_SAFE_INTEGER).onActionCancel(() => this.suppressDateUntil = Date.now() + 200).onActionEnd((event: GestureEvent) => { this.suppressDateUntil = Date.now() + 250; if (Math.abs(event.offsetX) > 45 && Math.abs(event.offsetX) > Math.abs(event.offsetY) * 1.5) this.shift(event.offsetX < 0 ? 1 : -1); }))
  }
}
