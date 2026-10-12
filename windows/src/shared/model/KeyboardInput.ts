// Physical digit keys are handled before the IME on devices that drop them.
export function physicalDigit(code: number, modified: boolean, text: string = ''): string {
  if (modified) return '';
  if (code >= 2000 && code <= 2009) return String(code - 2000);
  if (code >= 2103 && code <= 2112) return String(code - 2103);
  return /^[0-9]$/.test(text) ? text : '';
}
