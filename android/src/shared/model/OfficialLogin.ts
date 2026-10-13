export function officialLoginUrl(url: string): boolean {
  return /^https:\/\/zjuam\.zju\.edu\.cn\/cas\/login(?:[?#]|$)/i.test(url);
}
export const inspectLoginScript: string = `(() => {
  if (location.origin !== 'https://zjuam.zju.edu.cn' || location.pathname !== '/cas/login') return JSON.stringify({ready:false,captcha:false,error:''});
  if (!document.getElementById('zhiyun-tablet-layout')) {
    const style = document.createElement('style'); style.id = 'zhiyun-tablet-layout';
    style.textContent = '.login-page{min-height:100%!important;overflow:auto!important;padding:16px 12px 24px!important}.login-container{position:relative!important;left:auto!important;top:auto!important;bottom:auto!important;right:auto!important;transform:none!important;margin:16px auto!important;width:min(400px,100%)!important;max-height:none!important;overflow:visible!important}.logo{position:relative!important;left:auto!important;top:auto!important;margin:0 auto 12px!important;max-width:400px!important}.logo img{max-width:100%!important}';
    document.head.appendChild(style);
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes');
  }
  const captcha = document.getElementById('kaptcha');
  return JSON.stringify({ready:!!document.getElementById('username') && !!document.getElementById('password') && !!document.getElementById('dl') && typeof window.checkForm === 'function',captcha:!!captcha && getComputedStyle(captcha).display !== 'none' && (!captcha.getClientRects || captcha.getClientRects().length > 0),error:(document.getElementById('errormsg')?.textContent || '').trim()});
})()`;
export function submitLoginScript(username: string, password: string): string {
  // Run the school's own submit handler so RSA, CSRF and captcha checks remain intact.
  return `(() => {
    if (location.origin !== 'https://zjuam.zju.edu.cn' || location.pathname !== '/cas/login') return 'untrusted';
    const fields = ${JSON.stringify({ username, password })};
    const user = document.getElementById('username'), pass = document.getElementById('password'), button = document.getElementById('dl');
    if (!user || !pass || !button || typeof window.checkForm !== 'function') return 'not-ready';
    user.value = fields.username; pass.value = fields.password;
    user.dispatchEvent(new Event('input', {bubbles:true})); pass.dispatchEvent(new Event('input', {bubbles:true}));
    const captcha = document.getElementById('kaptcha');
    if (captcha && getComputedStyle(captcha).display !== 'none' && (!captcha.getClientRects || captcha.getClientRects().length > 0)) return 'verification';
    button.click(); return 'submitted';
  })()`;
}

export function webString(result: string): string {
  try { const decoded = JSON.parse(result) as string; if (typeof decoded === 'string') return decoded; } catch (_) {}
  return result;
}

// Only insert a digit into the focused field on the school's trusted CAS page.
export function officialDigitScript(digit: string): string {
  if (!/^[0-9]$/.test(digit)) return "'ignored'";
  return `(() => {
    if (location.origin !== 'https://zjuam.zju.edu.cn' || location.pathname !== '/cas/login') return 'untrusted';
    const input = document.activeElement;
    if (!input || input.tagName !== 'INPUT' || input.disabled || input.readOnly || !['text','password','email','tel','number'].includes(input.type)) return 'ignored';
    const digit = ${JSON.stringify(digit)};
    const start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
    const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;
    input.value = input.value.slice(0, start) + digit + input.value.slice(end);
    try { input.setSelectionRange(start + 1, start + 1); } catch (_) {}
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'inserted';
  })()`;
}
