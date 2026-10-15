// Theme changes only presentation; preserve live editors, selection and media.
export function applyAppearanceTheme(value) {
  const theme = ['playful', 'editorial'].includes(value) ? 'playful' : 'collage';
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('.welcome img, .theme-icon').forEach(image => {
    image.src = 'theme-' + theme + '.png';
  });
  return theme;
}
applyAppearanceTheme(window.__zhiyunTheme);
window.native.on('appearanceTheme', applyAppearanceTheme);
// A login/recovery screen may be mounted after a native theme event.
const observer = new window.MutationObserver(records => {
  if (records.some(record => record.addedNodes.length)) {
    const theme = document.documentElement.dataset.theme;
    document.querySelectorAll('.welcome img, .theme-icon').forEach(image => {
      const target = 'theme-' + theme + '.png';
      if (image.getAttribute('src') !== target) image.setAttribute('src', target);
    });
  }
});
observer.observe(document.body, {childList:true, subtree:true});
