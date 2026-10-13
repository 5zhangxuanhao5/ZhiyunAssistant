import { physicalDigit } from '../model/KeyboardInput';
// A shared pre-IME handler for single-line editors; retains selection/caret,
// leaves shortcuts, arrows, Tab, IME composition and soft keyboard untouched.
export class PhysicalInput {
  private controlDown: boolean = false;
  reset(): void { this.controlDown = false; }
  readonly controller: TextInputController = new TextInputController();
  digit(event: KeyEvent, value: string, change: (text: string) => void): boolean {
    if (event.keyCode === 2072 || event.keyCode === 2073) { this.controlDown = event.type === KeyType.Down; return false; }
    if (event.type !== KeyType.Down) return false;
    const control = this.controlDown || !!event.metaKey || !!event.getModifierKeyState?.(['Ctrl']);
    if (control && (event.keyCode === 2017 || event.keyText.toLowerCase() === 'a')) { try { this.controller.setTextSelection(0, value.length); return true; } catch (_) { return false; } }
    const modified = this.controlDown || !!event.metaKey || ['Ctrl', 'Alt', 'Shift'].some((key: string): boolean => !!event.getModifierKeyState?.([key]));
    if (!modified && (event.keyCode === 2055 || event.keyCode === 2071)) {
      try {
        const selection = this.controller.getSelection();
        let start = Math.max(0, Math.min(value.length, selection.start ?? value.length)), end = Math.max(start, Math.min(value.length, selection.end ?? value.length));
        if (start === end) {
          const at = event.keyCode === 2055 ? start - 1 : end;
          if (at < 0 || at >= value.length || value.charCodeAt(at) > 127) return false;
          if (event.keyCode === 2055) start--; else end++;
        }
        this.controller.clearPreviewText(); this.controller.deleteText({ start, end }); change(value.slice(0, start) + value.slice(end)); this.controller.caretPosition(start); return true;
      } catch (_) { return false; }
    }
    const digit = physicalDigit(event.keyCode, modified, event.keyText); if (!digit) return false;
    try {
      const selection = this.controller.getSelection(), start = Math.max(0, Math.min(value.length, selection.start ?? value.length)), end = Math.max(start, Math.min(value.length, selection.end ?? value.length));
      this.controller.clearPreviewText(); if (end > start) this.controller.deleteText({ start, end });
      this.controller.addText(digit, { offset: start }); change(value.slice(0, start) + digit + value.slice(end)); this.controller.caretPosition(start + 1); return true;
    } catch (_) { return false; }
  }
}
