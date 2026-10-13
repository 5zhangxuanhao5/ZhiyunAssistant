@Component
export struct DropdownLabel {
  @Prop label: string = '';
  @Prop labelSize: number = 11;
  @Prop maxWidth: number = 180;
  build() {
    Row({ space: 6 }) {
      Text(this.label).fontSize(this.labelSize).fontColor('#168BEE').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).constraintSize({ maxWidth: this.maxWidth - 38 })
      Image($r('app.media.dropdown_chevron')).width(8).height(5).draggable(false)
    }.height('100%').padding({ left: 12, right: 12 }).constraintSize({ maxWidth: this.maxWidth }).alignItems(VerticalAlign.Center).justifyContent(FlexAlign.Center).clip(true)
  }
}
