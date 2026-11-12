/**
 * Follows the theme chosen in main. Main sets Electron's `nativeTheme.themeSource`, which
 * drives `prefers-color-scheme` here, so the page only has to follow the media query; in
 * "Match system" mode that also covers the OS switching live.
 */
export function followColorScheme(root: HTMLElement = document.documentElement): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    root.classList.toggle('dark', query.matches)
    root.style.colorScheme = query.matches ? 'dark' : 'light'
  }
  apply()
  query.addEventListener('change', apply)
  return () => query.removeEventListener('change', apply)
}
