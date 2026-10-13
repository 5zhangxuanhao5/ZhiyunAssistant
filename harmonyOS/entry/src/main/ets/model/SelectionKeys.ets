export class SelectionKeys {
  private static ctrl: boolean = false;
  static update(event: KeyEvent): void { if (event.keyCode === 2072 || event.keyCode === 2073) SelectionKeys.ctrl = event.type === 0; }
  static reset(): void { SelectionKeys.ctrl = false; }
  static command(event: KeyEvent): string {
    SelectionKeys.update(event);
    if (event.type !== 0 || !(SelectionKeys.ctrl || event.getModifierKeyState?.(['Ctrl']))) return '';
    return event.keyCode === 2017 ? 'a' : event.keyCode === 2019 ? 'c' : event.keyCode === 2038 ? 'v' : ['a', 'c', 'v'].includes((event.keyText || '').toLowerCase()) ? event.keyText.toLowerCase() : '';
  }
}
