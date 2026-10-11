/**
 * Keep the app inside the part of the screen the on-screen keyboard leaves.
 *
 * Mobile browsers and WebViews mostly shrink only the *visual* viewport when
 * the keyboard opens and then pan the whole page to reveal the focused field,
 * which shoves the header off screen. Instead we size #root to the visual
 * viewport (`--app-h`) and undo the pan, so the composer simply rides on top
 * of the keyboard. `html[data-kb]` is set while the keyboard is up so the
 * bottom safe-area padding (home indicator / gesture bar) can collapse.
 */
export function initViewport() {
  const vv = window.visualViewport;
  if (!vv || !matchMedia("(pointer: coarse)").matches) return;
  const root = document.documentElement;
  let full = 0;
  let orientation = screen.orientation?.type;

  const update = () => {
    if (screen.orientation?.type !== orientation) {
      orientation = screen.orientation?.type;
      full = 0;
    }
    const h = vv.height;
    full = Math.max(full, h, window.innerHeight);
    root.style.setProperty("--app-h", `${Math.round(h)}px`);
    const kb = full - h > 120;
    root.toggleAttribute("data-kb", kb);
    // Undo the browser's pan-to-input; our layout already fits.
    if (window.scrollY !== 0 || vv.offsetTop !== 0) window.scrollTo(0, 0);
  };

  root.toggleAttribute("data-touch", true);
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  window.addEventListener("orientationchange", () => setTimeout(update, 250));
  update();
}
