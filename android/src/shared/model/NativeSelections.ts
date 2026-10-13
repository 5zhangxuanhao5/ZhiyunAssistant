interface NativeSelection { group: string; held: boolean; dismiss: () => void; key?: (event: KeyEvent) => boolean }
export class NativeSelections {
  private static mounted: Map<string, NativeSelection> = new Map();
  static bind(id: string, dismiss: () => void, group: string = '', key?: (event: KeyEvent) => boolean): void { NativeSelections.mounted.set(id, { dismiss, group, key, held: false }); }
  static unbind(id: string): void { NativeSelections.mounted.delete(id); }
  static hold(id: string, held: boolean): void { const entry = NativeSelections.mounted.get(id); if (entry) entry.held = held; }
  private static heldGroups(): Set<string> { const groups: Set<string> = new Set(); NativeSelections.mounted.forEach((entry: NativeSelection) => { if (entry.held) groups.add(entry.group); }); return groups; }
  static clearExcept(group: string): void { const held = NativeSelections.heldGroups(); NativeSelections.mounted.forEach((selection: NativeSelection) => { if (selection.group !== group && !held.has(selection.group)) try { selection.dismiss(); } catch (_) {} }); }
  static keyGroup(group: string, event: KeyEvent): boolean { for (const entry of NativeSelections.mounted.values()) { if (entry.group === group && entry.key?.(event)) return true; } return false; }
  static isHeld(group: string): boolean { return NativeSelections.heldGroups().has(group); }
  static clearGroup(group: string): void { if (NativeSelections.heldGroups().has(group)) return; NativeSelections.mounted.forEach((selection: NativeSelection) => { if (selection.group === group) try { selection.dismiss(); } catch (_) {} }); }
  static clear(): void { NativeSelections.mounted.forEach((entry: NativeSelection) => { entry.held = false; try { entry.dismiss(); } catch (_) {} }); }
}
