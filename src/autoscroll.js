/* ============================================================
   autoscroll.js — requestAnimationFrame-based smooth scroller
   ============================================================ */

window.Autoscroll = (function () {
  'use strict';

  let scrolling = false;
  let speed = 0.5;        // pixels per frame at 60fps
  let rafId = null;
  let containerEl = null;
  let pauseOnInteractionHandler = null;

  function step() {
    if (!scrolling || !containerEl) return;
    containerEl.scrollTop += speed;
    if (containerEl.scrollTop + containerEl.clientHeight < containerEl.scrollHeight - 1) {
      rafId = requestAnimationFrame(step);
    } else {
      scrolling = false;
    }
  }

  function start(el, s) {
    stop();
    containerEl = el;
    speed = s ?? speed;
    scrolling = true;

    if (!pauseOnInteractionHandler) {
      pauseOnInteractionHandler = () => toggle(containerEl, speed);
      // Note: a simple click toggles; we attach once per element.
    }

    rafId = requestAnimationFrame(step);
  }

  function stop() {
    scrolling = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function toggle(el, s) {
    if (scrolling) stop();
    else start(el, s);
  }

  function setSpeed(s) { speed = s; }

  return { start, stop, toggle, setSpeed };
})();
