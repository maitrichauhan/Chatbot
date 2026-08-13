/* ============================================================================
   Host page chrome: segmented control
   Vallejo's Segmented ships a single sliding .segmented-indicator whose width
   and offset are set by code. Without it the control falls back to a per-segment
   pill, so this wires up the slide.
   ========================================================================== */

(function () {
  'use strict';

  document.querySelectorAll('.segmented').forEach(function (track) {
    const indicator = track.querySelector('.segmented-indicator');
    const segments = Array.prototype.slice.call(track.querySelectorAll('.segment'));
    if (!indicator || !segments.length) return;

    function place() {
      const active = track.querySelector('.segment[aria-checked="true"]') || segments[0];
      indicator.style.width = active.offsetWidth + 'px';
      indicator.style.transform = 'translateX(' + active.offsetLeft + 'px)';
      track.classList.add('has-indicator');
    }

    segments.forEach(function (segment) {
      segment.addEventListener('click', function () {
        segments.forEach(function (other) {
          other.setAttribute('aria-checked', String(other === segment));
        });
        place();
      });
    });

    /* Wait for the webfont so the measured widths match the painted labels. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(place);
    }
    place();
    window.addEventListener('resize', place);
  });
})();
