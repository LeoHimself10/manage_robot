/** Browser utilities: body scroll lock, mobile keyboard / viewport handling. */

let bodyScrollLockCount = 0;
let savedBodyOverflow = "";

export function lockBodyScroll(): void {
  if (typeof document === "undefined") return;
  if (bodyScrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyScrollLockCount += 1;
}

export function unlockBodyScroll(): void {
  if (typeof document === "undefined") return;
  if (bodyScrollLockCount <= 0) return;
  bodyScrollLockCount -= 1;
  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = savedBodyOverflow;
  }
}

export function scrollInputIntoView(input: HTMLElement, scrollRoot?: HTMLElement | null): void {
  if (typeof window === "undefined") return;
  requestAnimationFrame(() => {
    try {
      input.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      /* ignore */
    }
    if (scrollRoot) {
      const rootRect = scrollRoot.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      if (inputRect.bottom > rootRect.bottom - 12) {
        scrollRoot.scrollTop += inputRect.bottom - rootRect.bottom + 24;
      } else if (inputRect.top < rootRect.top + 12) {
        scrollRoot.scrollTop -= rootRect.top + 24 - inputRect.top;
      }
    }
  });
}

export function attachMobileInputScroll(
  input: HTMLElement,
  scrollRoot?: HTMLElement | null,
): () => void {
  const onFocus = () => scrollInputIntoView(input, scrollRoot);
  input.addEventListener("focus", onFocus);
  let vvCleanup: (() => void) | undefined;
  if (typeof window !== "undefined" && window.visualViewport) {
    const onResize = () => {
      if (document.activeElement === input) scrollInputIntoView(input, scrollRoot);
    };
    window.visualViewport.addEventListener("resize", onResize);
    window.visualViewport.addEventListener("scroll", onResize);
    vvCleanup = () => {
      window.visualViewport?.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("scroll", onResize);
    };
  }
  return () => {
    input.removeEventListener("focus", onFocus);
    vvCleanup?.();
  };
}

export function attachMobileInputScrollAll(
  root: ParentNode,
  scrollRoot?: HTMLElement | null,
): () => void {
  const cleanups: Array<() => void> = [];
  root.querySelectorAll("input, textarea, select").forEach((el) => {
    cleanups.push(attachMobileInputScroll(el as HTMLElement, scrollRoot));
  });
  return () => cleanups.forEach((fn) => fn());
}

export const MOBILE_MQ = "(max-width: 767px)";

export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_MQ).matches;
}
