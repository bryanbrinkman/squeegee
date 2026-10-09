/* ============================================================
   SQUEEGEE PAINT SMEAR — ABX edition build (template mode)
   Deploy:  abx deploy-code --script paint-smear.abx.js --dep p5@<ver>
            --max 1 --copies <n|open> ...
   - styles are injected here (template mode serves a script, not a page)
   - the FIRST painting is seeded from the token's mint seed, so the
     marketplace still is a fixed, reproducible composition; abx.done()
     fires when that first smear finishes
   - after that the gallery loop and hands-on mode run exactly as before,
     with fresh random paintings
   - installation features (MegPad remote, Fully bridge, presentation
     mode, hidden corner buttons) only run with ?install=1 in the URL or
     window.PAINT_SMEAR_INSTALL = true
   ============================================================ */

/* ---------- page styles ---------- */
(function injectStyles() {
  const st = document.createElement('style');
  st.textContent = `html, body {
    margin: 0; padding: 0;
    background: #d8d6c8;
    height: 100vh; height: 100dvh;
    width: 100vw;
    display: flex;
    align-items: center; justify-content: center;
    font-family: Helvetica, Arial, sans-serif;
    overscroll-behavior: none;
    overflow: hidden;
  }
  canvas {
    box-shadow: 0 14px 44px rgba(0,0,0,.28); border-radius: 6px;
    /* fill the frame: explicit height scales up AND down, 9:16 kept */
    width: auto !important;
    height: min(98vh, calc(98vw * 16 / 9)) !important;
    height: min(98dvh, calc(98vw * 16 / 9)) !important;
    max-width: 98vw;
    touch-action: none;
  }
  /* still capture: the painting fills the shot edge to edge. 9:16 shows
     it whole; any other shape crops to fit (cover), centered — never
     pillarboxed */
  html.abx-still canvas {
    box-shadow: none !important; border-radius: 0 !important;
    width:  max(100vw, calc(100vh * 9 / 16)) !important;
    height: max(100vh, calc(100vw * 16 / 9)) !important;
    max-width: none !important; flex: none;
  }`;
  document.head.appendChild(st);
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp) vp.setAttribute('content',
    'width=device-width, initial-scale=1.0, user-scalable=no');
})();

/* ---------- installation flag ---------- */
const INSTALL = (() => {
  try {
    if (window.PAINT_SMEAR_INSTALL === true) return true;
    return new URLSearchParams(location.search).get('install') === '1';
  } catch (e) { return false; }
})();

/* ---------- still-capture mode ----------
   ABX's render effect (and abx preview --shoot) load the page in a
   headless, automated browser and screenshot it at abx.done() — or at a
   timeout if done never comes. A slow CPU renderer could hit that timeout
   mid-animation, so when the page is being captured, the token's painting
   is computed straight to its finished, post-smear state (same seed, same
   rows, same pixels as the animated version) and done fires immediately.
   ?still=1 forces this mode by hand. */
const CAPTURE = (() => {
  try {
    if (new URLSearchParams(location.search).get('still') === '1') return true;
    return navigator.webdriver === true;
  } catch (e) { return false; }
})();
if (CAPTURE) document.documentElement.classList.add('abx-still');

/* ---------- ABX token data + seeding ---------- */
const TOKEN = (window.abx && abx.tokenData) || {};
function hash32(str) {                       // cyrb53-style string hash
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 >>> 0;
}
// token's mint seed → else its coordinates → else (no ABX at all, e.g.
// the installation page) a fresh random first painting like the original
const TOKEN_SEED = hash32(String(
  TOKEN.seed ||
  (TOKEN.contractAddress ? TOKEN.contractAddress + ':' + TOKEN.tokenId
                         : Math.random())));
// sfc32-ish PRNG that stands in for Math.random() inside the smear model
let _rs = 1;
function _rng() {
  _rs = (_rs + 0x6D2B79F5) | 0;
  let t = Math.imul(_rs ^ (_rs >>> 15), 1 | _rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function seedAll(s) {
  s = s >>> 0;
  randomSeed(s);
  noiseSeed(s);
  _rs = s ^ 0x9E3779B9;
}
let runIndex = -1;          // 0 = the canonical, token-seeded painting
let canonicalReported = false, doneFrames = 0;
const PULL_NAMES = { sine: 'Wave', arc: 'Arc', scurve: 'S-Curve', straight: 'Straight' };
let canonicalTraits = null;

/* ============================================================
   SQUEEGEE PAINT SMEAR — p5.js  v4
   - fixed palette (pink/cyan/green/yellow + black/grey on cream)
   - 3D-shaded paint droplets (gradient body, specular, shadow)
   - first run plays an auto demo; TAP resets, then YOU drag
     the squeegee to smear (multi-pass, re-smearable)
   ============================================================ */

const W = 450, H = 800;                       // 9:16 logical units
const S = 2;                                  // internal supersampling
const RW = W * S, RH = H * S;                 // real paint-model pixels
const BG = [242, 241, 223];                   // #f2f1df cream paper
const BG_CSS = 'rgb(242,241,223)';
const MARGIN = 40;

const PINK = '#f2668b', CYAN = '#23c7d9', GREEN = '#48d9a4',
      YELLOW = '#f2bf27', BLACK = '#26262b', GREY = '#8a8f98',
      WHITE = '#f7faff';
const ROWCOLORS = [PINK, CYAN, GREEN, YELLOW, WHITE, BLACK];

function pick() {                             // weighted palette pick
  const r = random();
  if (r < 0.20) return PINK;
  if (r < 0.40) return CYAN;
  if (r < 0.60) return GREEN;
  if (r < 0.80) return YELLOW;
  if (r < 0.89) return WHITE;
  if (r < 0.965) return BLACK;
  return GREY;
}

let buffer;
let phase;            // 'place' | 'enter' | 'autoSmear' | 'done' | 'manual'
let manualMode = false;
let placeQueue, placeIdx, phaseStart, placeDuration;

// smear model
let snap;             // LIVE pixel model of the paint layer (kept in sync)
let cols, texFrac = 0.2, lozChance = 0.5;
const COL_STEP = 4;   // real px per blade column (was 3)
let bladeX, bladeY;   // squeegee position (center x, blade y)
let bladeStartY, bladeEndY, smearStyle, sway = 0;
let dragging = false, pressPos = null, pressMoved = false;
let tool = 'squeegee';            // 'squeegee' | 'none' | a palette color
let presentationMode = false;     // physical-squeegee install: tool hidden
let tiltMode = false, tiltCur = 0; // blade follows the pull direction
let lastBrush = PINK;              // remembered paint for remote toggling
let remoteGesture = null;          // synthetic swipe/click from the IR remote
let painting = false, modelDirty = false;
let strokePts = [], strokeT0 = 0;  // current brush stroke
let grabDX = 0, grabDY = 0;        // where on the tool it was grabbed

const rx = (a, b) => random(a, b);
const ri = (a, b) => floor(random(a, b + 1));
const yTop = 55, yBot = () => H - 55;

/* ---------- color helpers ---------- */
function lighten(cStr, t) { return lerpColor(color(cStr), color(255), t).toString(); }
function darken(cStr, t)  { return lerpColor(color(cStr), color(20), t).toString(); }

function setup() {
  createCanvas(W, H);
  pixelDensity(2);                 // crisp when CSS scales the canvas up
  buffer = createGraphics(RW, RH); // paint layer is supersampled 2x
  buffer.pixelDensity(1);
  noStroke();
  seedAll(TOKEN_SEED);             // paper grain is part of the token too
  makePaperTexture();
  buildFrameLayer();
  buildSqueegeeSprite();
  startRun(false);                             // first run = auto demo
  if (CAPTURE) finishCanonicalNow();
}

/* ---------- paper texture (built once, multiplied over everything) ---------- */
let paperTex;
function makePaperTexture() {
  paperTex = createGraphics(RW, RH);
  paperTex.pixelDensity(1);
  paperTex.loadPixels();
  for (let y = 0; y < RH; y++) {
    for (let x = 0; x < RW; x++) {
      // fine tooth + broad fiber blotches
      const grain = random(-9, 4);
      const blotch = (noise(x * 0.009, y * 0.009) - 0.5) * 10;
      const v = constrain(251 + grain + blotch, 228, 255);
      const i = 4 * (y * RW + x);
      paperTex.pixels[i] = v;
      paperTex.pixels[i + 1] = v;
      paperTex.pixels[i + 2] = v - 1;   // hint of warmth
      paperTex.pixels[i + 3] = 255;
    }
  }
  paperTex.updatePixels();
  // sparse fibers
  paperTex.stroke(130, 125, 110, 22);
  paperTex.strokeWeight(1);
  for (let k = 0; k < 500; k++) {
    const x = random(RW), y = random(RH), a = random(TWO_PI), l = random(3, 8);
    paperTex.line(x, y, x + cos(a) * l, y + sin(a) * l);
  }
}

let enteringCustom = false, hintsShownAt = -99999;
function startRun(manual) {
  runIndex++;
  // first painting = the token's own seed; every later one is fresh
  seedAll(runIndex === 0 ? hash32('run0:' + TOKEN_SEED)
                         : (Math.random() * 4294967296) >>> 0);
  enteringCustom = manual && !manualMode;   // coming in from the gallery
  manualMode = manual;
  buffer.resetMatrix();
  buffer.scale(S);                 // composition code keeps logical coords
  buffer.background(...BG);
  buffer.noStroke();
  phase = 'place';
  phaseStart = millis();
  placeQueue = buildPlaceQueue();
  if (runIndex === 0) canonicalTraits = compositionTraits();
  placeDuration = manual
    ? constrain(placeQueue.length * 6, 900, 1600)   // quick when playing
    : constrain(placeQueue.length * 14, 2200, 4200);
  placeIdx = 0;
  dragging = false;
  runStartT = millis();
  tool = 'squeegee';
  tiltCur = 0;
  painting = false; modelDirty = false; strokePts = [];
}

/* wipe the blade: drop all carried paint and any live dabs. Called by
   the clean-blade button, by clearing the sheet, and implicitly by every
   reset/reroll (those rebuild the blade model from scratch). */
function cleanBlade() {
  if (cols) for (const c of cols) { c.amt = 0; c.loz = null; }
}

/* re-capture the paint layer into the live smear model
   (called after the user paints their own droplets) */
function resyncModel() {
  buffer.loadPixels();
  snap = Uint8ClampedArray.from(buffer.pixels);
  snapImg = new ImageData(snap, RW, RH);
  smearDirtyMin = Infinity; smearDirtyMax = -1;
  modelDirty = false;
}

/* ---------- side palette (manual mode) ---------- */
function paletteItems() {
  const items = ['squeegee', 'clean', 'tilt', 'reroll', 'present', PINK, CYAN, GREEN, YELLOW, WHITE, BLACK, GREY, 'clear', 'preview'];
  return INSTALL ? items : items.filter(i => i !== 'present');
}
const PAL_SCALE = 0.5;              // swatches drawn at half size
function paletteLayout() {
  const items = paletteItems();
  const r = 13 * PAL_SCALE, gap = 37 * PAL_SCALE + 1.5;
  const x = W - 17;
  const y0 = H / 2 - ((items.length - 1) * gap) / 2;
  return items.map((item, k) => ({ item, x, y: y0 + k * gap, r }));
}
function paletteHit(mx, my) {
  for (const s of paletteLayout()) {
    if (dist(mx, my, s.x, s.y) <= s.r + 5) return s.item;
  }
  return null;
}
let paletteG = null, paletteGY0 = 0, paletteGCount = 0;
let paletteAlpha = 1, squeegeeLiftAt = -99999;
function drawPalette() {
  const lay = paletteLayout();

  // fade the palette out while the squeegee is being pulled, and back
  // in one second after it's lifted
  const pulling = dragging && !painting;
  const target = pulling ? 0 : (millis() - squeegeeLiftAt > 1000 ? 1 : 0);
  paletteAlpha += (target - paletteAlpha) * (target < paletteAlpha ? 0.22 : 0.10);
  if (paletteAlpha < 0.01) { paletteAlpha = 0; return; }
  if (paletteAlpha > 0.995) paletteAlpha = 1;
  const pa = paletteAlpha;
  if (!paletteG || paletteGCount !== lay.length) {
    paletteGCount = lay.length;
    // render all swatches (minus the selection ring) once into a strip
    const y0 = lay[0].y - 16, y1 = lay[lay.length - 1].y + 16;
    paletteGY0 = y0;
    paletteG = createGraphics(56, y1 - y0);
    paletteG.pixelDensity(2);
    paletteG.clear();
    paletteG.push();
    paletteG.translate(-(W - 56), -y0);
    drawPaletteSwatches(paletteG, lay);
    paletteG.pop();
  }
  tint(255, 255 * pa);
  image(paletteG, W - 56, paletteGY0);
  noTint();

  // explainer labels: hold 5s after entering custom mode, then a slow
  // 1.5s fade
  const hintAge = millis() - hintsShownAt;
  if (hintAge < 6500) {
    const alpha = (hintAge < 5000 ? 1 : 1 - (hintAge - 5000) / 1500) * pa;
    const LABELS = {
      squeegee: 'squeegee \u2014 drag to pull, tap T to hide',
      clean:    'clean the blade',
      tilt:     'blade tilts to follow your pull',
      reroll:   'new random paints',
      present:  'presentation mode (fullscreen, tool hidden)',
      clear:    'blank sheet',
      preview:  'auto mode'
    };
    LABELS[PINK] = 'paints \u2014 tap = dot, hold = bigger, drag = line';
    textAlign(RIGHT, CENTER); textSize(9.5); textStyle(BOLD);
    for (const sw of lay) {
      const label = LABELS[sw.item];
      if (!label) continue;
      const tw = textWidth(label) + 14;
      const lx = sw.x - sw.r - 8, ly = sw.y;
      noStroke();
      fill(38, 38, 43, 205 * alpha);
      rect(lx - tw, ly - 9, tw, 18, 9);
      fill(245, 245, 240, 255 * alpha);
      text(label, lx - 7, ly + 0.5);
    }
    textStyle(NORMAL); textAlign(CENTER, CENTER);
  }

  // live selection ring only
  for (const sw of lay) {
    const ringed = tool === sw.item ||
                   (sw.item === 'present' && presentationMode) ||
                   (sw.item === 'tilt' && tiltMode);
    if (ringed) {
      noFill(); stroke(38, 38, 43, 255 * pa); strokeWeight(1.8);
      circle(sw.x, sw.y, sw.r * 2 + 5);
      noStroke();
    }
  }
}
function drawPaletteSwatches(pg, layout) {
  const ctx = pg.drawingContext;
  for (const s0 of layout) {
    // glyphs are authored at the original 13px radius and scaled down
    const sw = { x: 0, y: 0, r: 13, item: s0.item };
    pg.push();
    pg.translate(s0.x, s0.y);
    pg.scale(PAL_SCALE);
    ctx.save();
    ctx.shadowColor = 'rgba(30,30,20,0.30)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    if (sw.item === 'squeegee') {
      pg.fill(252); pg.stroke(180); pg.strokeWeight(1);
      pg.circle(sw.x, sw.y, sw.r * 2);
      ctx.restore();
      pg.noStroke(); pg.fill(70);
      pg.rect(sw.x - 8, sw.y - 4, 16, 3.5, 1.5);
      pg.rect(sw.x - 1.7, sw.y - 1, 3.4, 9, 1.5);
    } else if (sw.item === 'reroll') {
      pg.fill(252); pg.stroke(180); pg.strokeWeight(1);
      pg.circle(sw.x, sw.y, sw.r * 2);
      ctx.restore();
      pg.noFill(); pg.stroke(70); pg.strokeWeight(2); pg.strokeCap(ROUND);
      pg.arc(sw.x, sw.y, 11.5, 11.5, -0.55, 4.35);
      const tipA = -0.55;
      const tx = sw.x + cos(tipA) * 5.75, ty = sw.y + sin(tipA) * 5.75;
      pg.noStroke(); pg.fill(70);
      pg.push();
      pg.translate(tx, ty);
      pg.rotate(tipA - HALF_PI);
      pg.triangle(-2.6, 1.2, 2.6, 1.2, 0, -3.6);
      pg.pop();
    } else if (sw.item === 'clean') {
      pg.fill(252); pg.stroke(180); pg.strokeWeight(1);
      pg.circle(sw.x, sw.y, sw.r * 2);
      ctx.restore();
      // a blade with sparkle ticks above it = clean blade
      pg.noStroke(); pg.fill(70);
      pg.rect(sw.x - 7, sw.y + 2, 14, 3.2, 1.5);
      pg.stroke(70); pg.strokeWeight(1.6); pg.strokeCap(ROUND);
      pg.line(sw.x, sw.y - 6.5, sw.x, sw.y - 2.5);
      pg.line(sw.x - 5, sw.y - 5, sw.x - 3, sw.y - 2.5);
      pg.line(sw.x + 5, sw.y - 5, sw.x + 3, sw.y - 2.5);
    } else if (sw.item === 'tilt') {
      pg.fill(252); pg.stroke(180); pg.strokeWeight(1);
      pg.circle(sw.x, sw.y, sw.r * 2);
      ctx.restore();
      // a tilted blade with a curved motion arrow
      pg.push(); pg.translate(sw.x, sw.y); pg.rotate(0.35);
      pg.noStroke(); pg.fill(70);
      pg.rect(-8, -1.6, 16, 3.2, 1.5);
      pg.pop();
      pg.noFill(); pg.stroke(70); pg.strokeWeight(1.5); pg.strokeCap(ROUND);
      pg.arc(sw.x - 2, sw.y + 4, 9, 9, PI * 0.15, PI * 0.85);
    } else if (sw.item === 'preview') {
      pg.fill(252); pg.stroke(180); pg.strokeWeight(1);
      pg.circle(sw.x, sw.y, sw.r * 2);
      ctx.restore();
      // play triangle = back to the auto gallery
      pg.noStroke(); pg.fill(70);
      pg.triangle(sw.x - 4, sw.y - 5.5, sw.x - 4, sw.y + 5.5, sw.x + 6, sw.y);
    } else if (sw.item === 'present') {
      pg.fill(252); pg.stroke(180); pg.strokeWeight(1);
      pg.circle(sw.x, sw.y, sw.r * 2);
      ctx.restore();
      // fullscreen corner brackets
      pg.noFill(); pg.stroke(70); pg.strokeWeight(1.8); pg.strokeCap(ROUND);
      const cbr = 5, cbl = 3;
      pg.line(sw.x - cbr, sw.y - cbr + cbl, sw.x - cbr, sw.y - cbr);
      pg.line(sw.x - cbr, sw.y - cbr, sw.x - cbr + cbl, sw.y - cbr);
      pg.line(sw.x + cbr - cbl, sw.y - cbr, sw.x + cbr, sw.y - cbr);
      pg.line(sw.x + cbr, sw.y - cbr, sw.x + cbr, sw.y - cbr + cbl);
      pg.line(sw.x + cbr, sw.y + cbr - cbl, sw.x + cbr, sw.y + cbr);
      pg.line(sw.x + cbr, sw.y + cbr, sw.x + cbr - cbl, sw.y + cbr);
      pg.line(sw.x - cbr + cbl, sw.y + cbr, sw.x - cbr, sw.y + cbr);
      pg.line(sw.x - cbr, sw.y + cbr, sw.x - cbr, sw.y + cbr - cbl);
    } else if (sw.item === 'clear') {
      pg.fill(...BG); pg.stroke(180); pg.strokeWeight(1);
      pg.circle(sw.x, sw.y, sw.r * 2);
      ctx.restore();
      pg.stroke(120); pg.strokeWeight(2);
      pg.line(sw.x - 4.5, sw.y - 4.5, sw.x + 4.5, sw.y + 4.5);
      pg.line(sw.x + 4.5, sw.y - 4.5, sw.x - 4.5, sw.y + 4.5);
    } else {
      pg.noStroke(); pg.fill(sw.item);
      pg.circle(sw.x, sw.y, sw.r * 2);
      ctx.restore();
      pg.fill(255, 255, 255, 150);
      pg.circle(sw.x - sw.r * 0.32, sw.y - sw.r * 0.36, sw.r * 0.5);
    }
    pg.noStroke();
    pg.pop();
  }
}

/* is this point on the drawn squeegee (crossbar or handle)? */
function squeegeeHit(mx, my) {
  const cx = bladeX / S, cy = bladeY / S;
  const lx = mx - cx, ly = my - cy;
  const halfBar = (W - 48) / 2;
  const onBar    = lx > -halfBar - 6 && lx < halfBar + 6 && ly > -10 && ly < 22;
  const onHandle = lx > -16 && lx < 16 && ly > 10 && ly < 114;
  return onBar || onHandle;
}

/* quick click = a dot (holding in place grows it); hold + drag = a line */
function heldDotSize() {
  return map(min(millis() - strokeT0, 1200), 0, 1200, 7.5, 20);
}
function strokeLen() {
  let L = 0;
  for (let i = 1; i < strokePts.length; i++)
    L += dist(strokePts[i-1].x, strokePts[i-1].y, strokePts[i].x, strokePts[i].y);
  return L;
}
function commitStroke() {
  if (!strokePts.length) return;
  if (strokeLen() < 7) {
    // a dot — sized by how long it was held
    const p0 = strokePts[0];
    const d = heldDotSize();
    droplet(buffer, p0.x, p0.y, d, tool);
    manifest.push({ kind: 'dot', x: p0.x, y: p0.y, d, col: tool });
  } else {
    // a piped line along the dragged path
    const pts = strokePts.map(p => [p.x, p.y]);
    const sw = rx(5.5, 8);
    pipePath(buffer, pts, sw, tool);
    manifest.push({ kind: 'line', pts, sw, col: tool });
  }
  modelDirty = true;
  strokePts = [];
}

/* =========================================================
   3D DROPLET RENDERING
   Every element is drawn like piped acrylic sitting on the
   paper: soft cast shadow, gradient body, specular highlight.
========================================================= */
function droplet(g, x, y, d, colStr) {
  const ctx = g.drawingContext;
  // cast shadow — tucked close under the drop, soft falloff
  const sh = ctx.createRadialGradient(x + d*0.05, y + d*0.13, 0,
                                      x + d*0.05, y + d*0.13, d*0.85);
  sh.addColorStop(0,    'rgba(40,40,35,0.17)');
  sh.addColorStop(0.45, 'rgba(40,40,35,0.10)');
  sh.addColorStop(1,    'rgba(40,40,35,0)');
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(x + d*0.05, y + d*0.15, d*0.68, d*0.55, 0, 0, TWO_PI);
  ctx.fill();
  // glossy body
  const hx = x - d*0.17, hy = y - d*0.20;
  const gr = ctx.createRadialGradient(hx, hy, d*0.05, x, y, d*0.62);
  gr.addColorStop(0,    lighten(colStr, 0.55));
  gr.addColorStop(0.55, colStr);
  gr.addColorStop(1,    darken(colStr, 0.30));
  ctx.fillStyle = gr;
  ctx.beginPath(); ctx.arc(x, y, d/2, 0, TWO_PI); ctx.fill();
  // specular — kept small and soft so its blend zone can't read as paint
  ctx.fillStyle = 'rgba(255,252,240,0.55)';
  ctx.beginPath(); ctx.ellipse(hx, hy, d*0.10, d*0.07, -0.5, 0, TWO_PI); ctx.fill();
}

// layered "piped icing" renderer with imperfect squeeze: the line's
// thickness wanders along its length — thin spots where the tube let up,
// bulges where it squeezed out extra — plus a soft ramp-in at the start
function preparePipe(pts, sw, colStr) {
  if (pts.length < 2) return null;

  // subdivide long segments so straight strokes get variance too
  const dense = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const d = dist(ax, ay, bx, by);
    const n = max(1, floor(d / 5));
    for (let k = 1; k <= n; k++)
      dense.push([lerp(ax, bx, k / n), lerp(ay, by, k / n)]);
  }

  // per-point squeeze factor — variation drifts SLOWLY along the line.
  // The old high-frequency wobble + abrupt bulges made rhythmic rings
  // every few px, reading as caterpillar segments instead of paint.
  const seed = random(5000);
  const wf = dense.map((p, i) => {
    let f = 0.80 + 0.40 * noise(seed, i * 0.045);              // slow drift
    f *= 1 + max(0, noise(seed + 9, i * 0.04) - 0.68) * 1.1;   // gentle swells
    if (i < 3) f *= 0.55 + 0.15 * i;                           // ramp-in
    return f;
  });
  // half the lines end on a little blob, half trail off thin
  const endBlob = random() < 0.5;
  const L = wf.length;
  for (let i = max(0, L - 3); i < L; i++)
    wf[i] *= endBlob ? 1 + 0.14 * (i - (L - 4)) : 1 - 0.16 * (i - (L - 4));

  const layers = [
    { c: 'rgba(40,40,35,0.12)', r: 1.05, dx: 1.2, dy: 2.2 },  // shadow
    { c: darken(colStr, 0.22),  r: 1,    dx: 0,   dy: 0   },  // dark base
    { c: colStr,                r: 0.72, dx: -sw*0.06, dy: -sw*0.10 },
    { c: lighten(colStr, 0.38), r: 0.38, dx: -sw*0.14, dy: -sw*0.20 },
    { c: 'rgba(255,252,240,0.40)', r: 0.14, dx: -sw*0.18, dy: -sw*0.26 }
  ];
  return { dense, wf, layers, sw };
}

// One layer of the pipe rendered as a FILLED variable-width polygon
// along the path — no chained stroke segments, no round caps at every
// joint, therefore no scalloped "caterpillar" edges. The outline flows
// smoothly through every width change.
function pipeLayerPoly(g, prep, li, i0, i1, startCap, endCap) {
  const { dense, wf, layers, sw } = prep;
  const Ly = layers[li];
  const Lpts = [], Rpts = [];
  const last = dense.length - 1;
  for (let i = i0; i <= i1; i++) {
    const f = wf[i];
    const w = max(0.4 * Ly.r + 0.15, sw * Ly.r * f) / 2;
    const pPrev = dense[max(0, i - 1)], pNext = dense[min(last, i + 1)];
    let dx = pNext[0] - pPrev[0], dy = pNext[1] - pPrev[1];
    const m = sqrt(dx * dx + dy * dy) || 1;
    dx /= m; dy /= m;
    const px = dense[i][0] + Ly.dx * f, py = dense[i][1] + Ly.dy * f;
    Lpts.push([px - dy * w, py + dx * w]);
    Rpts.push([px + dy * w, py - dx * w]);
  }
  g.noStroke(); g.fill(Ly.c);
  g.beginShape();
  for (const q of Lpts) g.vertex(q[0], q[1]);
  for (let k = Rpts.length - 1; k >= 0; k--) g.vertex(Rpts[k][0], Rpts[k][1]);
  g.endShape(CLOSE);
  // rounded tips only at the true ends of the line
  if (startCap) {
    const w0 = max(0.4 * Ly.r + 0.15, sw * Ly.r * wf[i0]);
    g.circle(dense[i0][0] + Ly.dx * wf[i0], dense[i0][1] + Ly.dy * wf[i0], w0);
  }
  if (endCap) {
    const w1 = max(0.4 * Ly.r + 0.15, sw * Ly.r * wf[i1]);
    g.circle(dense[i1][0] + Ly.dx * wf[i1], dense[i1][1] + Ly.dy * wf[i1], w1);
  }
}

// full-path shadow laid down up front (chunked shadow ringed the line)
function renderPipeShadow(g, prep) {
  pipeLayerPoly(g, prep, 0, 0, prep.dense.length - 1, true, true);
}

// Animated chunks render only the OPAQUE body layers, overlapping one
// point back so seams are impossible. The highlight + gloss layers are
// laid over the WHOLE line in a single pass at completion — chunking
// them left a faint anti-aliased seam at every chunk edge, which read
// as residual caterpillar rings on saturated lines.
function renderPipeBodyRange(g, prep, i0, i1) {
  const last = prep.dense.length - 1;
  const from = max(0, i0 - 1);          // 1-point overlap stitch
  pipeLayerPoly(g, prep, 1, from, i1, from === 0, i1 === last);
  pipeLayerPoly(g, prep, 2, from, i1, from === 0, i1 === last);
}
function renderPipeFinish(g, prep) {
  const last = prep.dense.length - 1;
  pipeLayerPoly(g, prep, 3, 0, last, true, true);
  pipeLayerPoly(g, prep, 4, 0, last, true, true);
}

function pipePath(g, pts, sw, colStr) {
  const prep = preparePipe(pts, sw, colStr);
  if (!prep) return;
  renderPipeShadow(g, prep);
  renderPipeBodyRange(g, prep, 0, prep.dense.length - 1);
  renderPipeFinish(g, prep);
}

/* =========================================================
   COMPOSITION GENERATORS
========================================================= */
function buildPlaceQueue() {
  const q = [];
  const g = buffer;
  // item kinds: pop (instant), pipe (line draws on), beads (chain grows)
  const addPop   = fn => q.push({ type: 'pop', fn, dur: 0, done: false });
  const addPipe  = (pts, sw, col) => {
    const prep = preparePipe(pts, sw, col);
    if (prep) q.push({ type: 'pipe', prep, idx: 0, done: false,
                       dur: min(500, (prep.dense.length - 1) * 12) });
  };
  const addBeads = beads => q.push({ type: 'beads', beads, idx: 0, done: false,
                                     dur: min(650, beads.length * 20) });
  manifest = [];                  // fresh recipe for this design
  const dense = random(0.75, 1.3);
  const n = base => max(0, round(base * dense * random(0.7, 1.3)));

  /* ---- occupancy grid: elements claim their footprint so nothing
     is generated on top of anything else ---- */
  const CELL = 6, PAD = 2.5;
  const GW = ceil(W / CELL), GH = ceil(H / CELL);
  const occ = new Uint8Array(GW * GH);
  function cellBox(x, y, r) {
    return [max(0, floor((x - r) / CELL)), min(GW - 1, floor((x + r) / CELL)),
            max(0, floor((y - r) / CELL)), min(GH - 1, floor((y + r) / CELL))];
  }
  function testCircle(x, y, r) {
    const [x0, x1, y0, y1] = cellBox(x, y, r);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++)
        if (occ[cy * GW + cx]) return true;
    return false;
  }
  function markCircle(x, y, r) {
    const [x0, x1, y0, y1] = cellBox(x, y, r);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++)
        occ[cy * GW + cx] = 1;
  }
  function testRect(rx0, ry0, rx1, ry1) {
    const x0 = max(0, floor(rx0 / CELL)), x1 = min(GW - 1, floor(rx1 / CELL));
    const y0 = max(0, floor(ry0 / CELL)), y1 = min(GH - 1, floor(ry1 / CELL));
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++)
        if (occ[cy * GW + cx]) return true;
    return false;
  }
  function markRect(rx0, ry0, rx1, ry1) {
    const x0 = max(0, floor(rx0 / CELL)), x1 = min(GW - 1, floor(rx1 / CELL));
    const y0 = max(0, floor(ry0 / CELL)), y1 = min(GH - 1, floor(ry1 / CELL));
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++)
        occ[cy * GW + cx] = 1;
  }

  // 1. dot grids — claim the whole block. Several pattern variants:
  //    rainbow rows, confetti, checkerboard, wave, diagonal stripes,
  //    rainbow columns
  const gridCount = ri(1, 3);
  for (let gI = 0; gI < gridCount; gI++) {
    const rows = ri(4, 8), colsN = ri(5, 9), sp = rx(12, 16);
    const variant = random(['rainbow', 'rainbow', 'confetti', 'checker',
                            'wave', 'diagonal', 'columns']);
    const waveAmp = variant === 'wave' ? sp * rx(0.45, 0.8) : 0;
    const waveF   = rx(0.7, 1.2), waveP = rx(0, TWO_PI);
    // two-tone pairs for the checkerboard
    const ca = pick(); let cb = pick();
    while (cb === ca) cb = pick();
    let placed = false;
    for (let att = 0; att < 12 && !placed; att++) {
      const gx = rx(MARGIN + 10, W - MARGIN - colsN * sp - 10);
      const gy = rx(yTop + waveAmp, yBot() - rows * sp - waveAmp);
      if (testRect(gx - 8, gy - 8 - waveAmp, gx + colsN * sp + 8,
                   gy + rows * sp + 8 + waveAmp)) continue;
      markRect(gx - 5, gy - 5 - waveAmp, gx + colsN * sp + 5,
               gy + rows * sp + 5 + waveAmp);
      placed = true;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < colsN; c++) {
          let col;
          switch (variant) {
            case 'rainbow':  col = ROWCOLORS[r % ROWCOLORS.length]; break;
            case 'columns':  col = ROWCOLORS[c % ROWCOLORS.length]; break;
            case 'diagonal': col = ROWCOLORS[(r + c) % ROWCOLORS.length]; break;
            case 'checker':  col = (r + c) % 2 === 0 ? ca : cb; break;
            case 'wave':     col = ROWCOLORS[r % ROWCOLORS.length]; break;
            default:         col = pick();
          }
          const x = gx + c * sp + rx(-1, 1);
          const y = gy + r * sp + rx(-1, 1)
                  + (waveAmp ? sin(c * waveF + waveP) * waveAmp : 0);
          const d = rx(7, 10);
          manifest.push({ kind: 'dot', x, y, d, col });
          addPop(() => droplet(g, x, y, d, col));
        }
      }
    }
  }

  // 2. dash-line groups — colliding dashes are skipped (leaves a gap)
  for (let i = 0; i < n(6); i++) {
    const rows = ri(1, 4);
    const x0 = rx(MARGIN, W - MARGIN - 130);
    const y0 = rx(yTop, yBot());
    const ang = random() < 0.7 ? rx(-0.12, 0.12) : rx(-0.6, 0.6);
    const ca = cos(ang), sa = sin(ang);
    const oneColor = random() < 0.4 ? pick() : null;
    for (let r = 0; r < rows; r++) {
      const nDash = ri(4, 11);
      const rowY = y0 + r * rx(10, 14);
      let x = 0;
      for (let k = 0; k < nDash; k++) {
        const col = oneColor || pick();
        if (random() < 0.35) {
          const px = x0 + (x + 2.5) * ca, py = rowY + (x + 2.5) * sa;
          const d = rx(5, 6.5);
          if (!testCircle(px, py, d / 2 + PAD)) {
            markCircle(px, py, d / 2 + PAD);
            manifest.push({ kind: 'dot', x: px, y: py, d, col });
            addPop(() => droplet(g, px, py, d, col));
          }
          x += rx(9, 12);
        } else {
          const len = rx(7, 15), sw = rx(4, 5.5);
          const ax = x0 + x * ca, ay = rowY + x * sa;
          const bx = x0 + (x + len) * ca, by = rowY + (x + len) * sa;
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          const rr = sw / 2 + PAD;
          if (!testCircle(ax, ay, rr) && !testCircle(mx, my, rr) && !testCircle(bx, by, rr)) {
            markCircle(ax, ay, rr); markCircle(mx, my, rr); markCircle(bx, by, rr);
            manifest.push({ kind: 'line', pts: [[ax, ay], [bx, by]], sw, col });
            addPipe([[ax, ay], [bx, by]], sw, col);
          }
          x += len + rx(6, 10);
        }
      }
    }
  }

  // 3. bead chains — truncate where they would run into something
  for (let i = 0; i < n(5); i++) {
    let start = null;
    for (let att = 0; att < 10 && !start; att++) {
      const sx = rx(MARGIN + 40, W - MARGIN - 40);
      const sy = rx(yTop + 30, yBot() - 30);
      if (!testCircle(sx, sy, 7)) start = { sx, sy };
    }
    if (!start) continue;
    const nB = ri(22, 60);
    const mode = random(['bw', 'color', 'mixed', 'pairs']);
    const chainCol = pick();
    const a0 = rx(0, TWO_PI);
    const wob = rx(0.10, 0.24);
    const turn = rx(-0.06, 0.06);
    const beads = [];
    let x = start.sx, y = start.sy, a = a0;
    for (let k = 0; k < nB; k++) {
      const d = rx(4.8, 5.8);
      if (testCircle(x, y, d / 2 + PAD)) break;   // ran into paint: stop
      let col;
      if (mode === 'bw')         col = k % 2 === 0 ? BLACK : WHITE;
      else if (mode === 'color') col = pick();
      else if (mode === 'pairs') col = k % 4 < 2 ? chainCol : BLACK;
      else                       col = k % 3 === 0 ? BLACK : pick();
      beads.push({ x, y, d, col });
      a += turn + sin(k * wob) * 0.4;
      x = constrain(x + cos(a) * 6, MARGIN, W - MARGIN);
      y = constrain(y + sin(a) * 6, yTop - 15, yBot() + 20);
    }
    if (beads.length < 8) continue;               // too stunted: drop it
    for (const b of beads) {
      markCircle(b.x, b.y, b.d / 2 + PAD);
      manifest.push({ kind: 'dot', x: b.x, y: b.y, d: b.d, col: b.col });
    }
    addBeads(beads);
  }

  // 4. squiggles — truncate on contact, keep only if a decent length
  for (let i = 0; i < n(8); i++) {
    const col = pick();
    const sw  = rx(4.5, 9);
    let start = null;
    for (let att = 0; att < 10 && !start; att++) {
      const sx = rx(MARGIN + 30, W - MARGIN - 30);
      const sy = rx(yTop + 20, yBot() - 20);
      if (!testCircle(sx, sy, sw / 2 + PAD + 2)) start = { sx, sy };
    }
    if (!start) continue;
    const len = random() < 0.3 ? rx(160, 260) : rx(60, 150);
    const a0  = rx(0, TWO_PI);
    const curl = rx(-0.05, 0.05);
    const wobF = rx(0.05, 0.13), wobA = rx(0.05, 0.16);
    const pts = [];
    let x = start.sx, y = start.sy, a = a0;
    for (let t = 0; t < len; t += 4) {
      if (testCircle(x, y, sw / 2 + PAD)) break;  // would cross paint: stop
      pts.push([x, y]);
      a += curl + sin(t * wobF) * wobA;
      x = constrain(x + cos(a) * 4, MARGIN, W - MARGIN);
      y = constrain(y + sin(a) * 4, yTop - 15, yBot() + 25);
    }
    if (pts.length < 8) continue;
    for (const pt of pts) markCircle(pt[0], pt[1], sw / 2 + PAD);
    manifest.push({ kind: 'line', pts, sw, col });
    addPipe(pts, sw, col);
  }

  // 5. straight strokes — retried until they fit clean
  for (let i = 0; i < n(5); i++) {
    const col = pick();
    const sw = rx(4.5, 8);
    for (let att = 0; att < 10; att++) {
      const x0 = rx(MARGIN + 20, W - MARGIN - 20);
      const y0 = rx(yTop, yBot());
      const len = rx(30, 95);
      const a = random() < 0.5 ? rx(-0.15, 0.15) : rx(0, TWO_PI);
      const x1 = constrain(x0 + cos(a) * len, MARGIN, W - MARGIN);
      const y1 = constrain(y0 + sin(a) * len, yTop - 15, yBot() + 25);
      const rr = sw / 2 + PAD;
      let clear = true;
      const steps = max(2, floor(dist(x0, y0, x1, y1) / 10));
      for (let s = 0; s <= steps && clear; s++)
        if (testCircle(lerp(x0, x1, s / steps), lerp(y0, y1, s / steps), rr)) clear = false;
      if (!clear) continue;
      for (let s = 0; s <= steps; s++)
        markCircle(lerp(x0, x1, s / steps), lerp(y0, y1, s / steps), rr);
      manifest.push({ kind: 'line', pts: [[x0, y0], [x1, y1]], sw, col });
      addPipe([[x0, y0], [x1, y1]], sw, col);
      break;
    }
  }

  // 6. clusters — claim a disc
  for (let i = 0; i < n(6); i++) {
    for (let att = 0; att < 10; att++) {
      const cx = rx(MARGIN + 20, W - MARGIN - 20);
      const cy = rx(yTop, yBot());
      if (testCircle(cx, cy, 22)) continue;
      markCircle(cx, cy, 20);
      const nD = ri(5, 13);
      const oneColor = random() < 0.5 ? pick() : null;
      const dots = [];
      for (let k = 0; k < nD; k++) {
        const a = rx(0, TWO_PI), r = rx(0, 16);
        dots.push({ x: cx + cos(a) * r, y: cy + sin(a) * r,
                    d: rx(4.5, 7.5), col: oneColor || pick() });
      }
      for (const dd of dots) manifest.push({ kind: 'dot', ...dd });
      addPop(() => { for (const dd of dots) droplet(g, dd.x, dd.y, dd.d, dd.col); });
      break;
    }
  }

  // 7. scattered dots + big blobs — retried into open paper
  for (let i = 0; i < n(28); i++) {
    for (let att = 0; att < 8; att++) {
      const col = pick();
      const x = rx(MARGIN + 12, W - MARGIN - 12);
      const y = rx(yTop - 5, yBot() + 20);
      const d = random() < 0.15 ? rx(16, 26) : rx(6, 12);
      if (testCircle(x, y, d / 2 + PAD)) continue;
      markCircle(x, y, d / 2 + PAD);
      manifest.push({ kind: 'dot', x, y, d, col });
      addPop(() => droplet(g, x, y, d, col));
      break;
    }
  }

  const items = shuffleTail(q, min(q.length, 40));
  // stagger each item across the placement window
  items.forEach((it, k) => { it.startF = k / items.length; });
  return items;
}

function stepPlaceItem(it, pr) {
  if (it.type === 'pop') {
    it.fn();
    it.done = true;
  } else if (it.type === 'pipe') {
    const nSeg = it.prep.dense.length - 1;
    const upto = max(1, ceil(pr * nSeg));
    if (upto > it.idx) {
      if (it.idx === 0) renderPipeShadow(buffer, it.prep);
      renderPipeBodyRange(buffer, it.prep, it.idx, upto);
      it.idx = upto;
    }
    if (pr >= 1) {
      renderPipeFinish(buffer, it.prep);   // highlight sweeps on at the end
      it.done = true;
    }
  } else if (it.type === 'beads') {
    const upto = ceil(pr * it.beads.length);
    for (; it.idx < upto; it.idx++) {
      const b = it.beads[it.idx];
      droplet(buffer, b.x, b.y, b.d, b.col);
    }
    if (pr >= 1) it.done = true;
  }
}

function shuffleTail(arr, keep) {
  const head = arr.slice(0, keep);
  const tail = arr.slice(keep);
  for (let i = tail.length - 1; i > 0; i--) {
    const j = floor(random(i + 1));
    [tail[i], tail[j]] = [tail[j], tail[i]];
  }
  return head.concat(tail);
}

/* =========================================================
   SMEAR MODEL
   `snap` is a live copy of the paint pixels. Every smeared
   row is written back into it, so dragging over an area you
   already smeared re-smears the streaks (multi-pass).
========================================================= */
let snapImg = null;
let smearAA = true;                 // anti-aliased deposit edges
// lateral shading across each ribbon column: slightly darker at the
// edges, lighter in the middle, like a rounded bead of wet paint.
// One fixed-point profile per span width, built once.
const SHADE_LUT = [];
for (let n = 0; n < 24; n++) {
  const lut = new Uint16Array(Math.max(1, n));
  for (let i = 0; i < lut.length; i++) {
    const t = (i + 0.5) / lut.length;
    const e = Math.abs(2 * t - 1);             // 0 center .. 1 edge
    const f = 0.945 + 0.115 * (1 - e * e);     // edge 0.945, center 1.06
    lut[i] = Math.round(f * 256);
  }
  SHADE_LUT.push(lut);
}
let smearDirtyMin = Infinity, smearDirtyMax = -1;
let depPx, depW, depR, depG, depB;   // preallocated deposit scratch
const DEP = { px: null, w: null, r: null, g: null, b: null, rb: null };
function SNAP_REF() { return snap; }
function COLS_REF() { return cols; }

function initSmearModel() {
  buffer.loadPixels();
  snap = Uint8ClampedArray.from(buffer.pixels);
  snapImg = new ImageData(snap, RW, RH);
  smearDirtyMin = Infinity; smearDirtyMax = -1;
  const nC2 = ceil(RW / COL_STEP) * 2 + 4;     // room for dabs too
  depPx = new Float32Array(nC2); depW = new Float32Array(nC2);
  depR = new Float32Array(nC2);  depG = new Float32Array(nC2);
  depB = new Float32Array(nC2);
  DEP.px = depPx; DEP.w = depW; DEP.r = depR; DEP.g = depG; DEP.b = depB;
  DEP.rb = new Int32Array(nC2);
  const wet = random(0.9, 1.6);
  texFrac   = rx(0.10, 0.30);      // share of stippled dry-texture columns
  lozChance = rx(0.55, 0.90);      // how often crossed dots survive as dabs
  cols = [];
  for (let i = 0; i < ceil(RW / COL_STEP); i++) {
    cols.push({
      r: 0, g: 0, b: 0, amt: 0,
      decay: rx(0.18, 0.55) / wet / S,   // finite load: runs out mid-sheet
      jitter: rx(-6, 6),
      wSeed: rx(0, 1000),
      grab: rx(0.7, 1.3),                // uneven pickup efficiency
      scratch: random() < 0.06,          // debris caught under the blade
      textured: random() < texFrac,      // stippled thin-paint column
      loz: null,                         // surviving "stretched dot"
      nY: -99, n50: 0, n300: 0, n200: 0, n600: 0, n0: 0   // noise cache
    });
  }
}

// fast smooth value-noise for the smear hot loop — p5's noise() was
// costing tens of ms on fast pulls (hundreds of rows x hundreds of
// columns x several calls each)
function fnHash(s, i) {
  const v = sin(s * 12.9898 + i * 78.233) * 43758.5453;
  return v - floor(v);
}
function vnoise(s, t) {
  const i = floor(t), f = t - i;
  const a = fnHash(s, i), b = fnHash(s, i + 1);
  return a + (b - a) * f * f * (3 - 2 * f);
}

function sampleSnap(x, y) {
  x = floor(constrain(x, 0, RW - 1));
  y = floor(constrain(y, 0, RH - 1));
  const i = 4 * (y * RW + x);
  return [snap[i], snap[i + 1], snap[i + 2]];
}

function writeSnap(y, x0, x1, r, g, b) {
  y = floor(constrain(y, 0, RH - 1));
  x0 = max(0, floor(x0)); x1 = min(RW, ceil(x1));
  for (let x = x0; x < x1; x++) {
    const i = 4 * (y * RW + x);
    snap[i] = r; snap[i + 1] = g; snap[i + 2] = b; snap[i + 3] = 255;
  }
}

function isPaint(rgb) {
  // high threshold: soft cast shadows and pale highlights around the
  // droplets don't count as paint, only the real pigment does
  const d = abs(rgb[0] - BG[0]) + abs(rgb[1] - BG[1]) + abs(rgb[2] - BG[2]);
  if (d > 110) return true;
  // white paint is numerically close to the warm cream paper — but it
  // leans cool/blue, which the paper (and warm gloss highlights) never do.
  // Kept strict so specular blends on colored drops can't sneak in.
  return rgb[2] - BG[2] > 24 && rgb[2] >= rgb[0] - 2 && rgb[0] > 235;
}

// candidate ribbon colors — carried paint snaps toward the nearest
// pure palette color, so streaks stay bold and saturated instead of
// averaging into pastel mud
let SNAP_COLORS = null;
function snapColors() {
  if (!SNAP_COLORS) {
    SNAP_COLORS = [PINK, CYAN, GREEN, YELLOW, BLACK, GREY].map(c => {
      const cc = color(c);
      return [red(cc), green(cc), blue(cc)];
    });
  }
  return SNAP_COLORS;
}
function nearestPalette(r, g, b) {
  let best = null, bd = Infinity;
  for (const p of snapColors()) {
    const d = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// smear one horizontal row at height y, blade centered at W/2+offset.
// PERFORMANCE-CRITICAL, hand-optimized: raw Math.* instead of p5 wrapper
// calls, inlined pixel sampling (no per-column array allocations), and
// loops restricted to the columns actually under the blade. Pure speed —
// the logic and therefore the visuals are identical to before.
const BG0 = BG[0], BG1 = BG[1], BG2 = BG[2];
const M = Object.create(Math);
M.random = _rng;                    // seeded: see seedAll()
// integer-hash value-noise: no transcendental calls in the hot loop
function h32(s, i) {
  let x = (M.imul(s | 0, 73856093) ^ M.imul(i | 0, 19349663)) | 0;
  x = M.imul(x ^ (x >>> 13), 0x5bd1e995);
  x ^= x >>> 15;
  return (x >>> 0) * 2.3283064365386963e-10;
}
function vn(s, t) {
  const i = M.floor(t), f = t - i;
  const a = h32(s * 1000, i), b = h32(s * 1000, i + 1);
  return a + (b - a) * f * f * (3 - 2 * f);
}
// `tilt` = slope of the blade line (dy per px of x): 0 = straight
// across. With tilt the blade is sheared, so each column samples and
// deposits on its own row: y + (px - center) * tilt.
function smearRow(y, offset, fan, tilt) {
  tilt = tilt || 0;
  const center = RW / 2 + offset;
  const half = (RW - 36 * S) / 2;
  const x0 = M.max(0, center - half);
  const x1 = M.min(RW, center + half);
  if (x1 <= x0) return;
  // hoist hot globals into locals (register-resident in the JIT)
  const snap = SNAP_REF(), cols = COLS_REF();
  const depPx = DEP.px, depW = DEP.w, depR = DEP.r, depG = DEP.g, depB = DEP.b;
  const depRB = DEP.rb;

  const yy = y < 0 ? 0 : (y > RH - 1 ? RH - 1 : M.floor(y));
  const rowBase0 = 4 * yy * RW;
  let rowBase = rowBase0;

  const bleed = M.min(1, M.max(0, (y - RH * 0.30) / (RH * 0.65)));
  const nCols = cols.length;

  // column index range actually under the blade (+1 margin)
  let iA = M.floor(((x0 - offset - RW / 2) / fan + RW / 2) / COL_STEP) - 1;
  let iB = M.ceil (((x1 - offset - RW / 2) / fan + RW / 2) / COL_STEP) + 1;
  if (iA < 1) iA = 1;
  if (iB > nCols - 2) iB = nCols - 2;

  // 1. color bleed toward the bottom
  if (bleed > 0) {
    const mixT = 0.09 * bleed;
    for (let i = iA; i <= iB; i++) {
      const c = cols[i];
      if (c.amt <= 0) continue;
      const L = cols[i - 1], R = cols[i + 1];
      if (L.amt > 0 && R.amt > 0) {
        c.r += ((L.r + R.r) * 0.5 - c.r) * mixT;
        c.g += ((L.g + R.g) * 0.5 - c.g) * mixT;
        c.b += ((L.b + R.b) * 0.5 - c.b) * mixT;
      }
    }
  }

  // 2. paint spread fills hairline gaps
  const takeMax = 4 + 9 * bleed;
  for (let i = iA; i <= iB; i++) {
    const c = cols[i];
    if (c.amt > 0) continue;
    const L = cols[i - 1], R = cols[i + 1];
    const donor = L.amt > R.amt ? L : R;
    if (donor.amt > 50) {
      const take = M.min(takeMax, donor.amt * 0.10);
      donor.amt -= take;
      c.amt = take;
      c.r = donor.r; c.g = donor.g; c.b = donor.b;
    }
  }

  // pass 1: sample + carry + compute deposits into preallocated arrays
  let nDep = 0;
  const iStart = M.max(0, iA - 1), iEnd = M.min(nCols - 1, iB + 1);
  for (let i = iStart; i <= iEnd; i++) {
    const c = cols[i];
    const px = RW / 2 + (i * COL_STEP - RW / 2) * fan + offset;
    if (px < x0 - COL_STEP || px > x1) continue;
    if (tilt !== 0) {
      const yi = y + (px - center) * tilt;
      const yic = yi < 0 ? 0 : (yi > RH - 1 ? RH - 1 : M.floor(yi));
      rowBase = 4 * yic * RW;
    }

    // inlined sample
    let sx = px + COL_STEP * 0.5;
    sx = sx < 0 ? 0 : (sx > RW - 1 ? RW - 1 : M.floor(sx));
    const si = rowBase + 4 * sx;
    const r0 = snap[si], g0 = snap[si + 1], b0 = snap[si + 2];

    const mx = r0 > g0 ? (r0 > b0 ? r0 : b0) : (g0 > b0 ? g0 : b0);
    const mn = r0 < g0 ? (r0 < b0 ? r0 : b0) : (g0 < b0 ? g0 : b0);
    const chroma = mx - mn;
    const lum = (r0 + g0 + b0) / 3;
    const glossy = lum >= 150 && chroma >= 18 && chroma < 40;
    const dBG = M.abs(r0 - BG0) + M.abs(g0 - BG1) + M.abs(b0 - BG2);
    const paint = dBG > 110 || (b0 - BG2 > 24 && b0 >= r0 - 2 && r0 > 235);

    if (paint && !glossy) {
      const cmx = c.r > c.g ? (c.r > c.b ? c.r : c.b) : (c.g > c.b ? c.g : c.b);
      const cmn = c.r < c.g ? (c.r < c.b ? c.r : c.b) : (c.g < c.b ? c.g : c.b);
      const carriedIsInk = c.amt > 0 && (cmx - cmn) < 45;

      if (chroma < 40 && carriedIsInk) {
        c.amt = M.min(c.amt + (20 + M.random() * 20) * c.grab, 150);
        const carriedLum = (c.r + c.g + c.b) / 3;
        if (chroma < 18 && M.abs(lum - carriedLum) > 80 && M.random() < lozChance) {
          const len = 14 + M.random() * 41;
          if (lum < 90)       c.loz = { r: 38,  g: 38,  b: 43,  left: len, total: len };
          else if (lum < 150) c.loz = { r: 138, g: 143, b: 152, left: len, total: len };
          else                c.loz = { r: 250, g: 250, b: 252, left: len, total: len };
        }
      } else {
        let sr, sg, sb;
        if (chroma < 40) {
          if      (lum < 70)  { sr = 38;  sg = 38;  sb = 43;  }
          else if (lum < 150) { sr = 138; sg = 143; sb = 152; }
          else                { sr = 250; sg = 250; sb = 252; }
        } else {
          const np = nearestPalette(r0, g0, b0);
          sr = r0 + (np[0] - r0) * 0.8;
          sg = g0 + (np[1] - g0) * 0.8;
          sb = b0 + (np[2] - b0) * 0.8;
        }
        const switchDist = M.abs(sr - c.r) + M.abs(sg - c.g) + M.abs(sb - c.b);
        if (c.amt > 0 && switchDist > 70 && M.random() < lozChance) {
          const len = M.random() < 0.75 ? 14 + M.random() * 41 : 60 + M.random() * 70;
          c.loz = { r: sr, g: sg, b: sb, left: len, total: len };
        }
        const t = c.amt <= 0 ? 1 : 0.5;
        c.r += (sr - c.r) * t;
        c.g += (sg - c.g) * t;
        c.b += (sb - c.b) * t;
        c.amt = M.min(c.amt + (20 + M.random() * 20) * c.grab, 150);
      }
    }

    if (c.amt > 0) {
      const ws = c.wSeed;
      // slow-varying noise channels (freq <= 0.035/row) are refreshed
      // every 4 rows and cached on the column — at 2x supersampling
      // that's 2 screen px, well below what the eye can pick out
      if (y - c.nY >= 4 || y - c.nY < 0) {
        c.nY = y;
        c.n50  = vn(ws + 50,  y * 0.01);
        c.n300 = vn(ws + 300, y * 0.035);
        c.n200 = vn(ws + 200, y * 0.0045);
        c.n600 = vn(ws + 600, y * 0.008);
        c.n0   = vn(ws,       y * 0.01);
      }
      const accel = c.amt < 45 ? 1.9 : 1;
      c.amt -= c.decay * accel * (0.7 + c.n50);
      const dry = c.amt < 0 ? 0 : (c.amt > 32 ? 1 : c.amt / 32);
      const skip = c.amt < 24 && c.n300 > 0.30 + dry * 0.65;
      const pinhole = vn(ws + 500, y * 0.09) < 0.04;

      if (c.amt > 0 && !skip && !pinhole) {
        const wob = (c.n200 - 0.5) * 7 + (M.random() * 0.6 - 0.3);
        const stut = M.random() < 0.006 ? (M.random() * 4.4 - 2.2) : 0;
        const a  = M.min(1, dry * 1.6);
        let   wS = 0.5 + 0.5 * dry;
        if (c.scratch && c.n600 > 0.48) wS *= 0.55;
        let blob = 1;
        if (M.random() < 0.004 && c.amt > 30) { blob = 1.5 + M.random() * 0.9; c.amt -= 6; }
        const bf = (0.93 + 0.11 * c.n0)
                 * (0.95 + 0.09 * vn(ws + 400, y * 0.12));

        let aa = a, skipDot = false;
        if (c.textured) {
          const sp = vn(ws + 700, y * 0.16);
          if (sp < 0.30) skipDot = true;
          else if (sp < 0.48) aa *= 0.55;
        }

        if (!skipDot) {
          let rr = c.r * bf + c.jitter, gg = c.g * bf + c.jitter, bb = c.b * bf + c.jitter;
          rr = rr < 0 ? 0 : (rr > 255 ? 255 : rr);
          gg = gg < 0 ? 0 : (gg > 255 ? 255 : gg);
          bb = bb < 0 ? 0 : (bb > 255 ? 255 : bb);
          depPx[nDep] = px + wob + stut;
          depW[nDep]  = (COL_STEP * fan + 1.5) * wS * blob;
          depR[nDep]  = BG0 + (rr - BG0) * aa;
          depG[nDep]  = BG1 + (gg - BG1) * aa;
          depB[nDep]  = BG2 + (bb - BG2) * aa;
          depRB[nDep] = rowBase;
          nDep++;
        }

        const lz = c.loz;
        if (lz) {
          const u = lz.left / lz.total;
          const grown = M.min(1, (lz.total - lz.left) / 5);
          const wl = ((COL_STEP * 1.8) * M.sqrt(u) + 0.5) * M.max(0.25, grown);
          depPx[nDep] = px + wob * 0.6 + (COL_STEP * fan - wl) * 0.5;
          depW[nDep]  = wl;
          depR[nDep]  = lz.r; depG[nDep] = lz.g; depB[nDep] = lz.b;
          depRB[nDep] = rowBase;
          nDep++;
          lz.left -= 0.8 + 0.5 * vn(ws + 800, y * 0.03);
          if (lz.left <= 0) c.loz = null;
        }
      }
    }
  }

  // pass 2: scrape the blade line clean in the model, then lay deposits
  if (tilt === 0) {
    const xs = M.floor(x0), xe = M.min(RW, M.ceil(x1));
    for (let x = xs, k = rowBase0 + 4 * xs; x < xe; x++, k += 4) {
      snap[k] = BG0; snap[k + 1] = BG1; snap[k + 2] = BG2; snap[k + 3] = 255;
    }
  } else {
    // sheared blade: clear a short span per column on that column's row
    for (let i = iStart; i <= iEnd; i++) {
      const px = RW / 2 + (i * COL_STEP - RW / 2) * fan + offset;
      if (px < x0 - COL_STEP || px > x1) continue;
      const yi = y + (px - center) * tilt;
      const yic = yi < 0 ? 0 : (yi > RH - 1 ? RH - 1 : M.floor(yi));
      const rb = 4 * yic * RW;
      let xs = M.floor(px - 1), xe = M.ceil(px + COL_STEP * fan + 1);
      if (xs < 0) xs = 0;
      if (xe > RW) xe = RW;
      for (let x = xs, k = rb + 4 * xs; x < xe; x++, k += 4) {
        snap[k] = BG0; snap[k + 1] = BG1; snap[k + 2] = BG2; snap[k + 3] = 255;
      }
    }
  }
  // deposits with ANTI-ALIASED edges: the end pixels of each span are
  // blended by their fractional coverage instead of snapped to whole
  // pixels — this alone removes most of the hard, digital column look.
  // AA costs ~2x per row, so it's skipped on very fast pulls (where
  // motion hides it anyway) to keep the blade responsive.
  if (!smearAA) {
    for (let d = 0; d < nDep; d++) {
      let xs = M.floor(depPx[d]), xe = M.ceil(depPx[d] + depW[d]);
      if (xs < 0) xs = 0;
      if (xe > RW) xe = RW;
      const r = depR[d], g = depG[d], b = depB[d], rb = depRB[d];
      for (let x = xs, k = rb + 4 * xs; x < xe; x++, k += 4) {
        snap[k] = r; snap[k + 1] = g; snap[k + 2] = b; snap[k + 3] = 255;
      }
    }
    const spread0 = M.abs(tilt) * half + 1;
    if (y - spread0 < smearDirtyMin) smearDirtyMin = y - spread0;
    if (y + spread0 > smearDirtyMax) smearDirtyMax = y + spread0;
    return;
  }
  for (let d = 0; d < nDep; d++) {
    const a = depPx[d], bEnd = a + depW[d];
    let xs = M.floor(a), xe = M.ceil(bEnd);
    if (xs < 0) xs = 0;
    if (xe > RW) xe = RW;
    if (xe <= xs) continue;
    // integer color + 8-bit coverage: edge blends stay in int math,
    // which is far cheaper than float read-modify-write on a clamped array
    const r = depR[d] | 0, g = depG[d] | 0, b = depB[d] | 0, rb = depRB[d];
    const n = xe - xs;
    const lut = SHADE_LUT[n < 24 ? n : 23];
    if (n === 1) {                            // span inside one pixel
      const k = rb + 4 * xs, c = ((bEnd - a) * 256) | 0, ic = 256 - c;
      snap[k]     = (snap[k]     * ic + r * c) >> 8;
      snap[k + 1] = (snap[k + 1] * ic + g * c) >> 8;
      snap[k + 2] = (snap[k + 2] * ic + b * c) >> 8;
      snap[k + 3] = 255;
      continue;
    }
    // left edge pixel (partial, shaded), interior (shaded), right edge
    let k = rb + 4 * xs;
    let F = lut[0];
    let c = (((xs + 1) - a) * 256) | 0, ic = 256 - c;
    snap[k]     = (snap[k]     * ic + ((r * F) >> 8) * c) >> 8;
    snap[k + 1] = (snap[k + 1] * ic + ((g * F) >> 8) * c) >> 8;
    snap[k + 2] = (snap[k + 2] * ic + ((b * F) >> 8) * c) >> 8;
    snap[k + 3] = 255;
    k += 4;
    for (let x = xs + 1, i = 1; x < xe - 1; x++, i++, k += 4) {
      F = lut[i];
      snap[k] = (r * F) >> 8; snap[k + 1] = (g * F) >> 8; snap[k + 2] = (b * F) >> 8;
      snap[k + 3] = 255;
    }
    F = lut[n - 1];
    c = ((bEnd - (xe - 1)) * 256) | 0; ic = 256 - c;
    snap[k]     = (snap[k]     * ic + ((r * F) >> 8) * c) >> 8;
    snap[k + 1] = (snap[k + 1] * ic + ((g * F) >> 8) * c) >> 8;
    snap[k + 2] = (snap[k + 2] * ic + ((b * F) >> 8) * c) >> 8;
    snap[k + 3] = 255;
  }

  const spread = M.abs(tilt) * half + 1;
  if (y - spread < smearDirtyMin) smearDirtyMin = y - spread;
  if (y + spread > smearDirtyMax) smearDirtyMax = y + spread;
}

// blit the touched band of the pixel model onto the paint buffer —
// ONE putImageData call per frame instead of thousands of rects
function flushSmear() {
  if (!snapImg || smearDirtyMax < smearDirtyMin) return;
  const y0 = max(0, floor(smearDirtyMin));
  const y1 = min(RH - 1, ceil(smearDirtyMax));
  buffer.drawingContext.putImageData(snapImg, 0, 0, 0, y0, RW, y1 - y0 + 1);
  smearDirtyMin = Infinity;
  smearDirtyMax = -1;
}

/* ---------- auto demo smear ---------- */
function startAutoSmear() {
  initSmearModel();
  bladeStartY = 7 * S;      // start ABOVE the frame opening (at 10) and
  bladeEndY = RH - 8 * S;   // run just past it at the bottom — both ends
                            // tuck under the border, no bare-paper strips
  bladeY = bladeStartY;
  bladeX = RW / 2;
  sway = 0;   // stale from the previous run's final frame — without this
              // reset the tool drew one frame at the OLD sideways offset
              // right after landing, then snapped back: the glitch
  const mode = random(['sine', 'sine', 'arc', 'scurve', 'straight']);
  smearStyle = {
    mode, dir: random() < 0.5 ? -1 : 1,
    amp1: rx(30, 70), amp2: rx(6, 22),
    f1: rx(0.006, 0.012), f2: rx(0.02, 0.045),
    p1: rx(0, TWO_PI), p2: rx(0, TWO_PI),
    arcAmp: rx(60, 130),
    spread: mode === 'straight'
      ? rx(-0.02, 0.05)
      : (random() < 0.6 ? rx(0.04, 0.22) : rx(-0.10, 0.02)),
    speed: ri(4, 7) * S
  };
  phase = 'autoSmear';
  if (runIndex === 0 && canonicalTraits)
    canonicalTraits['Pull'] = PULL_NAMES[mode] || mode;
}

function swayAt(traveled) {          // takes + returns LOGICAL units
  const s = smearStyle;
  if (s.mode === 'straight') return 0;   // a clean vertical pull
  const total = (bladeEndY - bladeStartY) / S;
  const ease = min(1, traveled / 140);
  const u = traveled / total;
  if (s.mode === 'arc')    return s.dir * s.arcAmp * u * u * 2 * ease;
  if (s.mode === 'scurve') return s.dir * s.arcAmp * sin(u * PI) * ease
                                + s.amp2 * sin(traveled * s.f2 + s.p2) * ease;
  return ease * (s.amp1 * sin(traveled * s.f1 + s.p1)
               + s.amp2 * sin(traveled * s.f2 + s.p2));
}

function autoSmearStep() {
  smearAA = true;                    // gallery pulls always get AA
  const total = bladeEndY - bladeStartY;
  for (let s = 0; s < smearStyle.speed && bladeY < bladeEndY; s++) {
    bladeY += 1;
    const traveled = bladeY - bladeStartY;
    sway = swayAt(traveled / S);            // logical, for the drawn tool
    const fan = 1 + smearStyle.spread * (traveled / total);
    smearRow(bladeY, sway * S, fan);        // real offset for the paint
  }
  if (bladeY >= bladeEndY) { phase = 'done'; doneAt = millis(); }
}

/* =========================================================
   DRAW LOOP + INTERACTION
========================================================= */
function draw() {
  perfMonitor();
  const t = millis() - phaseStart;

  // idle gallery loop: a new painting every 15 seconds — but never
  // while the person is playing (manual mode pauses the cycle)
  if (phase === 'done' && !manualMode && !fadePending &&
      millis() - runStartT > CYCLE_MS &&
      millis() - doneAt > 1200) {
    beginFade(false);
  }

  // finish a pending fade: once fully cream, the next run begins
  if (fadePending && millis() - fadeT0 >= FADE_MS) {
    fadePending = false;
    startRun(fadeManual);
    // bail out for this frame: `t` above was computed against the OLD
    // phaseStart, and letting the place branch run with that huge stale
    // t drew the entire composition in one frame — the paint popped in
    // fully formed instead of animating on like it does at the start
    return;
  }

  if (phase === 'place') {
    // each item starts at its slot in the window and animates over its
    // own duration — lines draw on, chains grow, dots pop
    for (const it of placeQueue) {
      if (it.done) continue;
      const st = it.startF * placeDuration;
      if (t < st) continue;
      const pr = it.dur <= 0 ? 1 : constrain((t - st) / it.dur, 0, 1);
      stepPlaceItem(it, pr);
    }
    if (t > placeDuration + 650) {
      for (const it of placeQueue) if (!it.done) stepPlaceItem(it, 1);
      redrawComposition();
      if (manualMode) {
        initSmearModel();
        bladeX = RW / 2; bladeY = 42 * S;
        phase = 'manual';
        if (enteringCustom) hintsShownAt = millis();   // 2s explainer labels
      } else {
        phase = 'enter';
        phaseStart = millis();
      }
    }
  } else if (phase === 'enter') {
    if (t > 700) startAutoSmear();
  } else if (phase === 'autoSmear') {
    autoSmearStep();
  }

  flushSmear();   // one blit of all smear rows processed this frame

  // hard reset: every pixel repaints from scratch each frame, so no
  // region can ever go stale and collect residue
  background('#d8d6c8');

  // EVERYTHING inside the shadowbox — artwork, texture, and tool — is
  // clipped to the opening, and the frame is drawn LAST each frame, so
  // nothing can ever appear on top of (or through) the border
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(FRAME_P, FRAME_P, W - 2 * FRAME_P, H - 2 * FRAME_P);
  drawingContext.clip();

  image(buffer, 0, 0, W, H);
  if (!lowQuality) {
    // the multiply-blended paper grain is the priciest compositing step;
    // low-quality mode skips it (the frame layer + paint carry the look)
    blendMode(MULTIPLY);
    image(paperTex, 0, 0, W, H);
    blendMode(BLEND);
  }

  if (phase === 'enter') {
    const p = constrain((millis() - phaseStart) / 700, 0, 1);
    // land exactly where the pull begins (bladeStartY) — landing at any
    // other y made the tool visibly jump when the smear took over
    drawSqueegee(0, lerp(-80, 7, 1 - pow(1 - p, 3)));
  } else if (phase === 'autoSmear') {
    drawSqueegee(sway, bladeY / S);
  } else if (phase === 'manual') {
    // poll every frame while pulling: touch-move events can drop out
    // under load, and each dropped event left an unsmeared horizontal
    // band — the poll guarantees every row between frames is covered
    if (dragging && !painting) {
      const tx = constrain(mouseX * S - grabDX, -40 * S, (W + 40) * S);
      const ty = constrain(mouseY * S - grabDY, 6 * S, (H - 4) * S);
      smearTowards(tx, ty);
    }
    if (tool !== 'none' && !presentationMode)
      drawSqueegee((bladeX - RW / 2) / S, bladeY / S,
                   tiltCur !== 0 ? M.atan(tiltCur) : undefined);
    if (painting && strokePts.length) {
      // live preview of the stroke in progress
      const col = color(tool);
      if (strokeLen() < 7) {
        noStroke();
        fill(red(col), green(col), blue(col), 190);
        circle(strokePts[0].x, strokePts[0].y, heldDotSize());
      } else {
        noFill();
        stroke(red(col), green(col), blue(col), 190);
        strokeWeight(6.5); strokeCap(ROUND); strokeJoin(ROUND);
        beginShape();
        for (const pt of strokePts) vertex(pt.x, pt.y);
        endShape();
        noStroke();
      }
    }
    if (!dragging && !painting && tool === 'squeegee' && !presentationMode) {
      fill(38, 38, 43, 160); noStroke();
      textAlign(CENTER); textSize(13); textStyle(BOLD);
      text('drag me', bladeX / S, bladeY / S + 118);
      textStyle(NORMAL);
    }
  }

  // fade-off: wash the whole box interior to blank paper before reset
  if (fadePending) {
    const ft = constrain((millis() - fadeT0) / FADE_MS, 0, 1);
    const e = ft * ft * (3 - 2 * ft);          // smoothstep
    noStroke();
    fill(BG[0], BG[1], BG[2], 255 * e);
    rect(0, 0, W, H);
  }

  drawingContext.restore();          // end shadowbox clip
  drawPaperEdge();                   // the frame goes on top, always last

  if (phase === 'manual') drawPalette();

  reportCanonicalDone();

  if (millis() - savedAt < 1000) {
    noStroke();
    fill(38, 38, 43, 190);
    rect(W / 2 - 44, 22, 88, 26, 13);
    fill(245); textAlign(CENTER, CENTER); textSize(12); textStyle(BOLD);
    text('saved \u2713', W / 2, 34);
    textStyle(NORMAL);
  }
}

function inCanvas() {
  return mouseX >= 0 && mouseX <= W && mouseY >= 0 && mouseY <= H;
}

let clickTimer = null;
let longPressTimer = null, longPressFired = false, savedAt = -9999;
let pressOrigin = null;
let runStartT = 0, doneAt = 0;
const CYCLE_MS = 15000;           // a fresh painting every 15 seconds
let fadePending = false, fadeManual = false, fadeT0 = 0;
const FADE_MS = 380;              // quick fade-off before each reset

/* ---------- adaptive quality ----------
   If the device can't hold frame rate, degrade the DISPLAY only — the
   paint simulation is untouched, so artworks look the same, just
   rendered cheaper. One-way switch (no oscillation). */
let manifest = [];                // design recipe: every dot & line placed
let lowQuality = false;
let perfWarmup = 90, perfSlow = 0, perfTotal = 0;
function perfMonitor() {
  if (lowQuality || (runIndex === 0 && !canonicalReported)) return;   // never degrade the still
  if (perfWarmup > 0) { perfWarmup--; return; }   // ignore startup jank
  perfTotal++;
  if (deltaTime > 24) perfSlow++;                 // slower than ~42fps
  if (perfTotal >= 180) {                         // ~3s windows
    if (perfSlow / perfTotal > 0.5) {
      lowQuality = true;
      pixelDensity(1);   // halve display fill cost (sim stays 2x internally)
    }
    perfSlow = 0; perfTotal = 0;
  }
}

function beginFade(manual) {
  if (fadePending) return;
  if (phase === 'place') { startRun(manual); return; }  // nothing to fade
  fadePending = true;
  fadeManual = manual;
  fadeT0 = millis();
}

function cancelLongPress() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
}

function mousePressed() { onPressStart(false); }
function touchStarted() { onPressStart(true); return false; }

/* hidden fullscreen toggle: an invisible 52x52 hotspot in the top-right
   corner of the canvas.
   wantFullscreen tracks INTENT: Android's swipe-from-top system gesture
   (which a squeegee pull from the top edge triggers) can kick the page
   out of fullscreen — if that happens while we still want it, the next
   touch quietly re-enters. */
let wantFullscreen = false, pendingRefull = false;
function enterFullscreen() {
  wantFullscreen = true;
  try {
    document.documentElement
      .requestFullscreen({ navigationUI: 'hide' })
      .catch(() => {});
  } catch (e) { /* unsupported — ignore */ }
}
function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      wantFullscreen = false;
      pendingRefull = false;
      document.exitFullscreen().catch(() => {});
    } else enterFullscreen();
  } catch (e) { /* not supported (e.g. iOS Safari) — ignore */ }
}

function onPressStart(isTouch) {
  if (!inCanvas() || (!isTouch && mouseButton !== LEFT)) return;

  // quietly restore fullscreen lost to a system edge-swipe; the press
  // itself still goes on to do whatever it was going to do
  if (INSTALL && pendingRefull) {
    pendingRefull = false;
    enterFullscreen();
  }

  // The MegPad's IR remote doesn't send key events for its D-pad/OK: it
  // injects SYNTHETIC touches that start at the exact screen center
  // (OK = a click there, arrows = swipes from there). A real finger
  // essentially never lands within a few px of dead center, so a press
  // that does is treated as a remote command and never paints/smears.
  if (INSTALL && phase === 'manual' && dist(mouseX, mouseY, W / 2, H / 2) < 6) {
    remoteGesture = { x0: mouseX, y0: mouseY };
    pressPos = null; pressMoved = false;
    dragging = false; painting = false;
    cancelLongPress();
    return;
  }

  // hidden corner buttons: swallow the press entirely
  // top-right: fullscreen toggle · top-left: paint-by-number chart export
  if (INSTALL && mouseY < 52 && (mouseX > W - 52 || mouseX < 52)) {
    const isRight = mouseX > W - 52;
    pressPos = null;
    pressMoved = false;
    cancelLongPress();
    if (isRight) toggleFullscreen();
    else exportChart();
    return;
  }

  longPressFired = false;
  pressOrigin = { x: mouseX, y: mouseY };   // always tracked, even when
                                            // the press isn't a "tap"

  // long-press = save (touch stand-in for right click). Not while
  // painting (holding the brush grows a dot), and NEVER in presentation
  // mode: a physical squeegee resting on the glass is a constant press,
  // which was firing "saved" over and over mid-pull.
  const canLongPress = !presentationMode &&
                       !(phase === 'manual' && tool !== 'squeegee');
  if (canLongPress) {
    cancelLongPress();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (!pressMoved) {
        longPressFired = true;
        savedAt = millis();
        saveArt();
      }
    }, 650);
  }

  if (phase === 'manual') {
    // palette first
    const hit = paletteHit(mouseX, mouseY);
    if (hit) {
      pressPos = null;
      if (hit === 'clean') {
        cleanBlade();
        return;
      }
      if (hit === 'tilt') {
        tiltMode = !tiltMode;
        return;
      }
      if (hit === 'preview') {
        // leave custom mode: fade off and resume the auto gallery loop
        beginFade(false);
        return;
      }
      if (hit === 'present') {
        presentationMode = !presentationMode;
        if (presentationMode) {
          tool = 'squeegee';               // ready to pull with the real tool
          if (!document.fullscreenElement) toggleFullscreen();
        }
        return;
      }
      if (hit === 'reroll') {
        // fresh random paints, placed with the intro animation,
        // still in hands-on mode
        beginFade(true);
        return;
      }
      if (hit === 'clear') {
        // wipe to a blank sheet and hand them a brush
        buffer.push(); buffer.resetMatrix();
        buffer.background(...BG);
        buffer.pop();
        resyncModel();
        cleanBlade();                  // a fresh sheet gets a clean blade too
        manifest = [];                 // blank sheet = blank recipe
        if (tool === 'squeegee') tool = PINK;
      } else if (hit === 'squeegee') {
        // tapping T with the squeegee already active hides the tool;
        // tapping again brings it back where it was
        tool = (tool === 'squeegee') ? 'none' : 'squeegee';
      } else {
        tool = hit;
        lastBrush = hit;
      }
      return;
    }
    // grabbing the tool itself works from ANY sub-mode — even with a
    // brush selected, touching the squeegee's handle/bar takes hold of
    // it right where it stands (no teleport, no palette trip)
    if (tool !== 'none' && !presentationMode && squeegeeHit(mouseX, mouseY)) {
      pressPos = null;                  // touching the tool never = tap/reset
      tool = 'squeegee';
      cancelLongPress();
      grabDX = mouseX * S - bladeX;
      grabDY = mouseY * S - bladeY;
      dragging = true;
      return;
    }
    if (tool === 'none') {
      // squeegee is off and no brush selected: presses on paper are
      // just taps (reset gestures still work), nothing to drag or paint
      pressPos = { x: mouseX, y: mouseY };
      pressMoved = false;
      return;
    }
    if (tool !== 'squeegee') {
      // brush: start a stroke (committed on release)
      pressPos = null;
      painting = true;
      strokeT0 = millis();
      strokePts = [{ x: constrain(mouseX, 14, W - 14),
                     y: constrain(mouseY, 14, H - 14) }];
      return;
    }
    // squeegee, pressed on open paper: the blade jumps to the pointer.
    // In presentation mode the pen IS the blade, so paper presses never
    // count as taps (an accidental pen tap must not reset the piece).
    pressPos = presentationMode ? null : { x: mouseX, y: mouseY };
    pressMoved = false;
    grabDX = 0; grabDY = 0;
    const nx = constrain(mouseX, 0, W) * S;
    const ny = constrain(mouseY, 6, H - 4) * S;
    // lift-bridging: a physical squeegee's pen can skip off the glass
    // mid-pull. If the new press lands near where the blade already is,
    // smear across the gap instead of teleporting over it.
    const nearY = abs(ny - bladeY) < 70 * S, nearX = abs(nx - bladeX) < 100 * S;
    dragging = true;
    if (nearY && nearX && ny !== bladeY) smearTowards(nx, ny);
    else { bladeX = nx; bladeY = ny; }
    return;
  }

  pressPos = { x: mouseX, y: mouseY };
  pressMoved = false;
}

function handleDrag() {
  if (remoteGesture) return;         // synthetic remote swipe: swallow
  if (phase === 'manual' && painting) {
    // extend the current stroke
    const x = constrain(mouseX, 14, W - 14);
    const y = constrain(mouseY, 14, H - 14);
    const last = strokePts[strokePts.length - 1];
    if (!last || dist(x, y, last.x, last.y) > 3) strokePts.push({ x, y });
    return;
  }
  // movement cancels a pending long-press no matter what kind of press
  // this is (the old check only ran for tap-eligible presses, so drags
  // that started as tool presses could still trip the save)
  if (pressOrigin && dist(mouseX, mouseY, pressOrigin.x, pressOrigin.y) > 8)
    cancelLongPress();
  // tap-tracking only applies when a tap is actually pending — grabbing
  // the tool clears pressPos on purpose (touching it is never a tap),
  // and gating ALL dragging behind pressPos made those grabs inert
  if (pressPos && dist(mouseX, mouseY, pressPos.x, pressPos.y) > 8)
    pressMoved = true;
  if (phase !== 'manual' || !dragging) return;

  const targetX = constrain(mouseX * S - grabDX, -40 * S, (W + 40) * S);
  const targetY = constrain(mouseY * S - grabDY, 6 * S, (H - 4) * S);
  smearTowards(targetX, targetY);
}

// Step the blade toward a target, smearing every INTEGER row in between.
// Shared by drag events, the per-frame poll, and lift-bridging.
//
// The old stepper advanced by fractional touch deltas but stamped rows
// at floor() — whenever the fractions drifted across a whole number, one
// integer row was silently skipped, combing the pull with hairline
// horizontal gaps. This walks whole rows so a skip is impossible.
//
// Rows per call are capped: a fast flick could demand 400+ rows in one
// event, and the burst stalled the frame ("shuttering"). Excess rows
// simply carry over — the poll finishes them over the next frames.
function smearTowards(targetXr, targetYr) {
  // Blade tilt follows the direction of travel: the blade sits
  // PERPENDICULAR to the motion, so pulling down-right lifts the right
  // end (slope = -dx/dy). The first version had the sign flipped, which
  // laid the blade along the motion and made the paint counter-rotate
  // against the real tool. Scaled to "slightly", clamped ~24deg.
  let tiltWant = 0;
  if (tiltMode) {
    const dxm = targetXr - bladeX, dym = targetYr - bladeY;
    if (M.abs(dym) >= 3 * S) {
      tiltWant = -(dxm / dym) * 0.6;
      tiltWant = tiltWant < -0.45 ? -0.45 : (tiltWant > 0.45 ? 0.45 : tiltWant);
    } else tiltWant = tiltCur;
  }
  const goingDown = targetYr >= bladeY;
  let rows = goingDown
    ? floor(targetYr) - floor(bladeY)
    : ceil(bladeY) - ceil(targetYr);
  if (rows <= 0) { bladeX = lerp(bladeX, targetXr, 0.25); bladeY = targetYr; return; }
  const capped = rows > 150;
  if (capped) rows = 150;
  smearAA = rows <= 70;              // slow/normal pulls get AA edges
  let y = goingDown ? floor(bladeY) : ceil(bladeY);
  for (let k = 1; k <= rows; k++) {
    y += goingDown ? 1 : -1;
    bladeX = lerp(bladeX, targetXr, 0.05);
    // ease the tilt PER ROW, capped so the blade's far ends never move
    // more than ~1 extra px between consecutive rows — changing the
    // tilt in one jump between events sheared the ends by several rows
    // at once, leaving stepped gaps in the paint
    let dT = tiltWant - tiltCur;
    dT = dT < -0.002 ? -0.002 : (dT > 0.002 ? 0.002 : dT);
    tiltCur += dT;
    if (M.abs(tiltCur) < 0.0005) tiltCur = 0;
    smearRow(y, bladeX - RW / 2, 1, tiltCur);
  }
  // reached the target this call? keep its fraction; otherwise park the
  // blade exactly on the last processed row and let the poll continue
  bladeY = capped ? y : targetYr;
}

function mouseDragged() { handleDrag(); }
function touchMoved()  { handleDrag(); return false; }

function mouseReleased() { onPressEnd(); }
function touchEnded()   { onPressEnd(); return false; }

function onPressEnd() {
  cancelLongPress();
  if (remoteGesture) {
    const dx = mouseX - remoteGesture.x0, dy = mouseY - remoteGesture.y0;
    remoteGesture = null;
    if (Math.abs(dx) < 25 && Math.abs(dy) < 25) remoteToggleTool();       // OK
    else if (Math.abs(dx) > Math.abs(dy))     remoteCycleColor(dx > 0 ? 1 : -1); // L/R
    else if (dy < 0)                          remoteToggleTool();          // Up
    else                                      cleanBlade();                // Down
    dragging = false; pressPos = null;
    return;
  }
  if (longPressFired) {
    // the long-press already saved; swallow this release entirely
    longPressFired = false;
    painting = false; strokePts = [];
    dragging = false; pressPos = null;
    return;
  }
  if (painting) {
    painting = false;
    commitStroke();
    if (modelDirty) resyncModel();   // fold the new paint into the model
    return;
  }
  const wasTap = pressPos && !pressMoved && inCanvas();
  if (dragging) squeegeeLiftAt = millis();
  dragging = false;
  pressPos = null;
  // taps never reset or exit custom mode — leaving is an explicit
  // choice via the preview button in the palette
  if (!wasTap || phase === 'manual' || manualMode) return;
  if (clickTimer) {
    // second tap within the window -> double: smear it yourself
    clearTimeout(clickTimer);
    clickTimer = null;
    beginFade(true);
  } else {
    // wait to see if a second tap follows; if not -> new auto piece
    clickTimer = setTimeout(() => {
      clickTimer = null;
      beginFade(false);
    }, 300);
  }
}

/* ---------- paint-by-number chart export (press P) ----------
   A printable JPG of the CURRENT design: outlined dots and line bands,
   each labeled with its paint number, plus a color legend. Paint it
   for real, then pull a squeegee straight down. */
const CHART_COLORS = [
  [PINK, 'Pink', 'R'], [CYAN, 'Blue', 'B'], [GREEN, 'Green', 'G'],
  [YELLOW, 'Yellow', 'Y'], [WHITE, 'White', 'W'], [BLACK, 'Black', 'K'],
  [GREY, 'Grey', 'GY']
];
function chartNum(col) {
  for (const [hex, name, letter] of CHART_COLORS)
    if (hex === col) return letter;
  return '?';
}
function exportChart() {
  if (!manifest.length) return;
  const LG = 150;                       // legend strip below the art
  const c = createGraphics(W, H + LG);
  c.pixelDensity(2);
  c.background(255);
  c.textAlign(CENTER, CENTER);
  c.textFont('Helvetica');

  // art area border
  c.noFill(); c.stroke(180); c.strokeWeight(1);
  c.rect(6, 6, W - 12, H - 12);

  // lines first (dots read better on top of crossings)
  for (const m of manifest) {
    if (m.kind !== 'line') continue;
    // outlined band the width of the piped paint
    c.noFill();
    c.stroke(150); c.strokeWeight(m.sw); c.strokeCap(ROUND); c.strokeJoin(ROUND);
    c.beginShape(); for (const pt of m.pts) c.vertex(pt[0], pt[1]); c.endShape();
    c.stroke(255); c.strokeWeight(max(1, m.sw - 1.8));
    c.beginShape(); for (const pt of m.pts) c.vertex(pt[0], pt[1]); c.endShape();
    // numbers along the path with a white halo
    const num = chartNum(m.col);
    let acc = 999;
    c.textSize(6.5); c.textStyle(BOLD);
    for (let i = 1; i < m.pts.length; i++) {
      acc += dist(m.pts[i-1][0], m.pts[i-1][1], m.pts[i][0], m.pts[i][1]);
      if (acc > 36) {
        acc = 0;
        c.stroke(255); c.strokeWeight(3); c.fill(70);
        c.text(num, m.pts[i][0], m.pts[i][1]);
      }
    }
    c.textStyle(NORMAL);
  }

  // dots: outlined circles with the number inside
  for (const m of manifest) {
    if (m.kind !== 'dot') continue;
    c.stroke(150); c.strokeWeight(0.9); c.fill(255);
    c.circle(m.x, m.y, m.d);
    c.noStroke(); c.fill(70);
    c.textSize(constrain(m.d * 0.62, 3.6, 8.5)); c.textStyle(BOLD);
    c.text(chartNum(m.col), m.x, m.y + 0.3);
    c.textStyle(NORMAL);
  }

  // legend strip
  const ly = H + 14;
  c.noStroke(); c.fill(40);
  c.textAlign(LEFT, CENTER); c.textSize(11); c.textStyle(BOLD);
  c.text('PAINT BY NUMBER', 14, ly);
  c.textStyle(NORMAL); c.textSize(7.5); c.fill(110);
  c.text('place each paint on its mark, then pull a squeegee top to bottom', 14, ly + 14);
  c.textAlign(CENTER, CENTER);
  for (let i = 0; i < CHART_COLORS.length; i++) {
    const colX = 26 + (i % 4) * 108;
    const colY = ly + 36 + floor(i / 4) * 30;
    const [hex, name, letter] = CHART_COLORS[i];
    c.stroke(150); c.strokeWeight(0.8); c.fill(hex);
    c.circle(colX, colY, 17);
    const bright = (red(color(hex)) + green(color(hex)) + blue(color(hex))) / 3;
    c.noStroke(); c.fill(bright > 150 ? 40 : 255);
    c.textSize(letter.length > 1 ? 6.5 : 8); c.textStyle(BOLD);
    c.text(letter, colX, colY + 0.3);
    c.textStyle(NORMAL);
    c.fill(60); c.textAlign(LEFT, CENTER); c.textSize(8);
    c.text(name + '  ' + hex, colX + 13, colY);
    c.textAlign(CENTER, CENTER);
  }

  saveCanvas(c, 'paint-by-number', 'jpg');
  savedAt = millis();
  setTimeout(() => c.remove(), 1000);
}

/* Keyboard / Android remote control.
   The MegPad's IR remote reaches the page as ordinary key events:
   OK/center = Enter, the D-pad = arrow keys. In custom mode:
     OK / Enter / Space  -> toggle between paint brush and squeegee
     Left / Right        -> cycle paint colors (switches to brush)
     Up                  -> clean the blade
     Down                -> toggle blade tilt
   P still exports the paint-by-number chart. */
const PAINT_ORDER = [PINK, CYAN, GREEN, YELLOW, WHITE, BLACK, GREY];
function remoteToggleTool() {
  if (tool === 'squeegee' || tool === 'none') {
    tool = lastBrush;
  } else {
    lastBrush = tool;
    tool = 'squeegee';
    // via the remote, squeegee always means the physical tool: hidden
    // on-screen squeegee, fullscreen presentation mode
    if (INSTALL) {
      presentationMode = true;
      if (!document.fullscreenElement) enterFullscreen();
    }
  }
}
function remoteCycleColor(dir) {
  const cur = PAINT_ORDER.indexOf(tool === 'squeegee' || tool === 'none' ? lastBrush : tool);
  const next = PAINT_ORDER[(cur + dir + PAINT_ORDER.length) % PAINT_ORDER.length];
  tool = next; lastBrush = next;
}
function keyPressed() {
  if (key === 'p' || key === 'P') { exportChart(); return; }
  if (phase !== 'manual') return;
  const k = keyCode;
  const isOK = k === ENTER || k === RETURN || k === 32 || k === 23 || key === 'Enter';
  if (isOK) { remoteToggleTool(); return false; }
  if (k === LEFT_ARROW)  { remoteCycleColor(-1); return false; }
  if (k === RIGHT_ARROW) { remoteCycleColor(+1); return false; }
  if (k === UP_ARROW)   { cleanBlade(); return false; }
  if (k === DOWN_ARROW) { tiltMode = !tiltMode; return false; }
}

/* entering fullscreen = "MegPad view": hands-on paint mode with the
   physical squeegee, so the drawn tool hides and presentation mode is
   on. Leaving fullscreen brings the on-screen tool back. */
document.addEventListener('fullscreenchange', () => {
  if (!INSTALL) return;
  if (document.fullscreenElement) {
    pendingRefull = false;
    presentationMode = true;
    tool = 'squeegee';
    if (phase === 'place') {
      manualMode = true;                 // current load becomes hands-on
    } else if (phase !== 'manual') {
      beginFade(true);                   // fresh paints, hands-on mode
    }
  } else if (wantFullscreen) {
    // kicked out by the system gesture, not the user: stay in meg view
    // and re-enter fullscreen on the very next touch
    pendingRefull = true;
  } else {
    presentationMode = false;
  }
});

/* Fully Kiosk Browser JS bridge: with "Enable JavaScript Interface"
   turned on in Fully's Advanced Web Settings, the remote's Volume +/-
   buttons become dedicated hardware shortcuts. Best-effort: silently
   skipped in any other browser. */
window.addEventListener('load', () => {
  if (!INSTALL) return;
  try {
    if (window.fully && typeof fully.bind === 'function') {
      fully.bind('volumeUpButton',   'remoteToggleTool();');   // paint <-> squeegee
      fully.bind('volumeDownButton', 'remoteCycleColor(1);');  // next color
    }
  } catch (e) { /* no bridge available */ }
});

/* right click = save the artwork (and try the clipboard too) */
function saveArt() {
  try {
    const cnv = document.querySelector('canvas');
    if (cnv && navigator.clipboard && window.ClipboardItem) {
      cnv.toBlob(b => {
        if (b) navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).catch(() => {});
      }, 'image/png');
    }
  } catch (e) { /* clipboard is best-effort */ }
  saveCanvas('paint-smear', 'png');
}
document.addEventListener('contextmenu', e => {
  e.preventDefault();
  saveArt();
});

/* ---------- squeegee tool (handle points down = pulling downward) ----------
   Pre-rendered ONCE into a sprite: canvas shadowBlur is brutally slow on
   mobile GPUs, and re-blurring the tool's shadow every frame was a large
   chunk of the frame budget on the MegPad. */
let squeegeeG = null;
const SQ_PAD = 34;                    // room for the blurred shadow
function buildSqueegeeSprite() {
  const gw = (W - 36) + SQ_PAD * 2;
  const gh = 118 + SQ_PAD * 2;
  squeegeeG = createGraphics(gw, gh);
  squeegeeG.pixelDensity(2);
  squeegeeG.clear();
  const g = squeegeeG, ctx = g.drawingContext;
  g.push();
  g.translate(gw / 2, SQ_PAD);        // origin = blade contact center

  ctx.save();
  ctx.shadowColor = 'rgba(30, 30, 20, 0.38)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 12;

  g.noStroke();
  g.fill(60);
  g.rect(-(W - 36) / 2, -4, W - 36, 8, 3);
  g.fill(252);
  g.stroke(205); g.strokeWeight(1);
  g.rect(-(W - 48) / 2, 4, W - 48, 14, 7);
  g.rect(-10, 14, 20, 96, 9);
  ctx.restore();

  g.noStroke();
  g.fill(228);
  g.rect(-4, 20, 5, 84, 2);
  g.rect(-(W - 60) / 2, 7, W - 60, 3, 2);
  g.pop();
}
function drawSqueegee(sw, y, angle) {
  push();
  translate(W / 2 + sw, y);
  rotate(angle !== undefined ? angle : sin(y * 0.02) * 0.02);
  image(squeegeeG, -squeegeeG.width / 2, -SQ_PAD);
  pop();
}

/* ---------- shadowbox frame ----------
   Rendered ONCE into a static layer at setup. Per-frame gradient and
   stroke drawing over the border was compounding whenever the band
   beneath went stale, slowly burning the frame black — a pre-rendered
   image stamped once per frame cannot accumulate or drift. */
const FRAME_P = 10;                   // frame width around the opening
let frameG = null;
function buildFrameLayer() {
  const P = FRAME_P;
  frameG = createGraphics(W, H);
  frameG.pixelDensity(2);
  frameG.clear();
  const ctx = frameG.drawingContext;
  frameG.noStroke();
  frameG.fill('#d8d6c8');
  frameG.rect(0, 0, W, P); frameG.rect(0, H - P, W, P);
  frameG.rect(0, 0, P, H); frameG.rect(W - P, 0, P, H);

  // inner drop shadow cast by the frame onto the recessed artwork —
  // deepest at the top (light from above), lighter down the sides
  const iw = W - 2 * P, ih = H - 2 * P;
  function shade(x, y, w, h, gx0, gy0, gx1, gy1, alpha) {
    const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, 'rgba(35,33,25,' + alpha + ')');
    g.addColorStop(1, 'rgba(35,33,25,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  shade(P, P, iw, 16, 0, P, 0, P + 16, 0.26);              // top
  shade(P, P, 12, ih, P, 0, P + 12, 0, 0.16);              // left
  shade(W - P - 12, P, 12, ih, W - P, 0, W - P - 12, 0, 0.13); // right
  shade(P, H - P - 9, iw, 9, 0, H - P, 0, H - P - 9, 0.09);    // bottom

  // frame lip: a bright edge where the inner bevel catches the light,
  // over a crisp dark seam
  frameG.noFill();
  frameG.stroke(30, 28, 20, 60); frameG.strokeWeight(1);
  frameG.rect(P - 0.5, P - 0.5, iw + 1, ih + 1);
  frameG.stroke(255, 255, 250, 110); frameG.strokeWeight(1);
  frameG.rect(P - 1.5, P - 1.5, iw + 3, ih + 3, 1);
  frameG.noStroke();
}
function drawPaperEdge() {
  image(frameG, 0, 0, W, H);
}


/* Re-lay the finished composition in queue order. The placement
   animation is timed by the clock, so on different machines items can
   interleave differently mid-animation and leave slightly different
   anti-aliasing; the smear model samples these pixels, so they must be
   identical everywhere for the token's painting to reproduce. */
function redrawComposition() {
  buffer.push();
  buffer.resetMatrix();
  buffer.background(...BG);
  buffer.pop();
  for (const it of placeQueue) {
    if (it.type === 'pop') it.fn();
    else if (it.type === 'pipe') {
      renderPipeShadow(buffer, it.prep);
      renderPipeBodyRange(buffer, it.prep, 0, it.prep.dense.length - 1);
      renderPipeFinish(buffer, it.prep);
    } else if (it.type === 'beads') {
      for (const b of it.beads) droplet(buffer, b.x, b.y, b.d, b.col);
    }
  }
}

/* =========================================================
   ABX: traits + capture point
========================================================= */
function compositionTraits() {
  const NAMES = {};
  NAMES[PINK] = 'Pink'; NAMES[CYAN] = 'Cyan'; NAMES[GREEN] = 'Green';
  NAMES[YELLOW] = 'Yellow'; NAMES[WHITE] = 'White'; NAMES[BLACK] = 'Black';
  NAMES[GREY] = 'Grey';
  const weight = {};
  let dots = 0, lines = 0;
  for (const m of manifest) {
    let w;
    if (m.kind === 'dot') { dots++; w = m.d * m.d; }
    else {
      lines++;
      let L = 0;
      for (let i = 1; i < m.pts.length; i++)
        L += Math.hypot(m.pts[i][0] - m.pts[i-1][0], m.pts[i][1] - m.pts[i-1][1]);
      w = L * m.sw;
    }
    weight[m.col] = (weight[m.col] || 0) + w;
  }
  let dom = null, best = -1;
  for (const c in weight) if (weight[c] > best) { best = weight[c]; dom = c; }
  const n = dots + lines;
  return {
    'Dominant Paint': NAMES[dom] || 'Mixed',
    'Paint Load': n < 280 ? 'Light' : n < 340 ? 'Medium' : 'Heavy',
    'Piped Lines': lines < 25 ? 'Few' : lines < 38 ? 'Some' : 'Many'
  };
}

/* capture mode: lay the paint and run the whole auto smear synchronously.
   autoSmearStep() walks the same rows in the same order whether it runs
   per frame or in one loop, so this is the animated painting's end state. */
function finishCanonicalNow() {
  for (const it of placeQueue) if (!it.done) stepPlaceItem(it, 1);
  redrawComposition();
  startAutoSmear();
  while (phase === 'autoSmear') autoSmearStep();
  flushSmear();
}

function reportCanonicalDone() {
  if (canonicalReported || runIndex !== 0 || phase !== 'done') return;
  // wait two frames so the finished painting is definitely on screen
  if (++doneFrames < 2) return;
  canonicalReported = true;
  if (window.abx) {
    try { if (canonicalTraits) abx.traits(canonicalTraits); } catch (e) {}
    try { abx.done(); } catch (e) {}
  }
}
