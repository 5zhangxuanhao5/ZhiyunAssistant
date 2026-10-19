// Also handles errors saved by older builds in the offline download index.
export function userMessage(value) {
  let text = String(value?.message ?? value ?? '操作未完成，请重试');
  const replacements = [
    [/The request timed out\.?|request timeout|timeout exceeded|ETIMEDOUT/gi, '网络请求超时，请稍后重试'],
    [/The Internet connection appears to be offline\.?|not connected to (?:the )?internet\.?/gi, '当前没有网络连接，请连接网络后重试'],
    [/The network connection was lost\.?|network connection lost\.?|ECONNRESET/gi, '网络连接中断，请重试'],
    [/A server with the specified hostname could not be found\.?|cannot find host\.?|ENOTFOUND/gi, '无法解析服务器地址，请检查网络'],
    [/Could not connect to the server\.?|cannot connect to host\.?|ECONNREFUSED/gi, '无法连接服务器，请稍后重试'],
    [/An SSL error has occurred[^\n；]*/gi, '安全连接校验失败，请检查系统时间或网络'],
    [/The (?:operation|request) (?:was |has been )?(?:cancelled|canceled|aborted)\.?|cancelled|canceled/gi, '请求已取消'],
    [/Failed to fetch|Load failed|NetworkError(?::[^\n；]*)?|Network request failed/gi, '网络请求失败，请检查网络后重试'],
  ];
  for (const [pattern, message] of replacements) text = text.replace(pattern, message);
  if (/NSURLErrorDomain/i.test(text)) {
    const code = /Code[= :]+(-\d+)/i.exec(text)?.[1];
    return ({ '-1001': '网络请求超时，请稍后重试', '-999': '请求已取消', '-1009': '当前没有网络连接，请连接网络后重试', '-1005': '网络连接中断，请重试' })[code] || '网络请求失败，请检查网络后重试';
  }
  return text;
}
export const isCancelled = value => /^(?:请求)?已取消[。. ]*$/.test(userMessage(value));
