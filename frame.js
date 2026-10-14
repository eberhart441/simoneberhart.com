// The glass frame. On wide screens it is fixed in the left half and only its text scrolls: the page scrolls as
// usual (wheel, keys, scrollbar), and the text inside is moved to match. Because the frame itself never moves over
// the drawing, the displacement map never rebuilds while scrolling. Fixed lighting is pre-rendered; live refraction uses four filter passes.
// On narrow screens the content flows normally on a plain frosted card (no refraction, so nothing changes mid-scroll).
(() => {
  const root = document.documentElement, card = document.querySelector('main');
  const view = card.querySelector('.view'), content = card.querySelector('.content');
  const wide = matchMedia('(min-width: 1040px)');
  // Hyalite.js (MIT): no colour fringing, no saturation pass, one displacement pass, for speed
  const GLASS = {bevel: 40, thickness: 70, blur: 6, dispersion: 0, sat: 1, smooth: 0, shade: .368, rim: 1.2, edge: .36, staticLighting:true,
                 light: -140, settle: 150};
  window.SimonGlass = GLASS;                                        // shared with bubble.mjs
  let framed = false, ratio = 1;

  // The right half shows four pre-rendered drawings, one per stretch of scroll (study-player.mjs). Each stretch is at least
  // SEG of the screen height, so the drawings do not fly past; when that makes the page longer than the text
  // needs, the text scrolls proportionally slower and still reaches its end exactly at the bottom.
  const SEG = .8;
  const sync = () => { if (framed) content.style.transform = `translate3d(0, ${-Math.round(scrollY * ratio)}px, 0)`; };

  function layout() {
    framed = wide.matches;
    root.classList.toggle('framed', framed);
    if (framed) {
      // the page is as tall as the text needs, or as the drawings need, whichever is longer
      const extra = Math.max(0, content.offsetHeight - view.clientHeight);
      const scenes = +(document.querySelector('.visuals')?.dataset.scenes || 1);
      const total = Math.max(extra, Math.round((scenes - .5) * SEG * innerHeight));
      ratio = total ? extra / total : 1;
      document.body.style.height = innerHeight + total + 'px';
      if (window.Hyalite && !root.classList.contains('liquid')) Hyalite.attach(card, GLASS);   // liquid.mjs draws it otherwise
      sync();
    } else {
      document.body.style.height = '';
      content.style.transform = '';
      if (window.Hyalite) Hyalite.detach(card);
    }
  }

  // the order the text rises in on first load (style.css, @keyframes rise)
  content.querySelectorAll(':scope > header > *, :scope > section > h2, :scope > section > article, :scope > footer')
    .forEach((el, i) => el.style.setProperty('--i', i));

  addEventListener('scroll', sync, {passive: true});
  addEventListener('resize', layout);
  wide.addEventListener('change', layout);
  new ResizeObserver(layout).observe(content);                      // fonts arriving change the text height
  layout();
})();
