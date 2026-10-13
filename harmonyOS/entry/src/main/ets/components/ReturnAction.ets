@Component
export struct ReturnAction {
  @Prop owner: string = '';
  onReturn: () => void = () => {};
  build() {
    Button('回到刚刚').id('study-return-' + this.owner).height(30).fontSize(12).fontColor('#168BEE').backgroundColor('#EAF4FF')
      .onTouch((event: TouchEvent) => event.stopPropagation()).onMouse((event: MouseEvent) => event.stopPropagation()).onClick(() => this.onReturn())
  }
}
