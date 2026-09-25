/*! vinqy-ring v4 — procedural ambient ring. No dependencies.
 *
 *   <div id="ring" style="width:100%;aspect-ratio:1"></div>
 *   <script src="./js/ring.js"></script>
 *   <script>VinqyRing.mount('#ring');</script>
 *
 * Motion idea: energy comes from the center. Before a hit, a faint pressure
 * front accelerates from the center toward the ring; the ring draws in slightly
 * (anticipation), then the impact throws spikes mostly outward, the ring springs
 * out, overshoots once and settles. Big hits come in phrases (a hit, sometimes
 * an aftershock or two, then a pause); small tremors keep the ring alive between
 * them. Both rings and the dust circles move as one radial wave (each layer a
 * beat later than the one inside it), so they never cross. Big hits throw a
 * scattered burst of motion-streaked sparks.
 * All events are scheduled inside `loop` seconds, so the piece repeats exactly.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VinqyRing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TAU = Math.PI * 2, DEG = Math.PI / 180, C45 = Math.SQRT1_2;
  var HMAX = 0.26;          // tallest spike, outer-radius units
  var ATTACK = 0.14;        // s, spike shoots out (fast start, eases into the peak)
  var RELEASE = 1.4;        // s, spike settles
  var WINDOW = ATTACK + RELEASE * 6.5;
  var LEAD = 0.42;          // s, pressure front travel time from center to ring
  var BULGE = 0.075;        // radial wave amplitude, outer-radius units
  var SPRING_W = TAU / 0.95, SPRING_TAU = 0.36;
  // Spike reach per ring, outer-radius units (soft caps keep the gap between rings clean):
  // inner ring stays out of the text area and never reaches the outer ring;
  // the outer ring shoots outward where there is room.
  var INNER_OUT = 0.04, INNER_IN = 0.055, OUTER_IN = 0.028;

  var DEFAULTS = {
    loop: 60,               // s; the whole piece repeats exactly
    speed: 1,
    energy: 1,              // spike height (0..1.6)
    spike: 1,               // tip length: 0 = short bevel, 1 = whole mark is a spike
    dust: 1,                // dust visibility (0..1.5)
    scale: 0.6,             // outer ring radius / half of element size
    ink: '#212226',
    dustColor: '#646c98',
    background: 'transparent',
    pointer: true,
    intro: 2.4,             // s, draw-on at load (0 = off)
    seed: 11,
    chaos: 1,               // how often impulses hit (0.4 = sparse, 1.4 = restless)
    fronts: true,           // faint pressure fronts travelling from the center
    maxDpr: 2
  };

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function wrapPi(d) { d = (d + Math.PI) % TAU; if (d < 0) d += TAU; return d - Math.PI; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smoothstep(e0, e1, x) { var t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  // Spike envelope around an impact at dt = 0: nothing before the hit, an
  // ease-out rise (instant velocity = impact), then a critically damped release.
  function envelope(dt) {
    if (dt <= 0) return 0;
    if (dt < ATTACK) { var u = 1 - dt / ATTACK; return 1 - u * u * u; }
    var r = (dt - ATTACK) / RELEASE;
    return (1 + r) * Math.exp(-r);
  }
  // Ring displacement: slight draw-in while the front approaches, then a
  // damped spring (out, one small overshoot in, settle). 0 at dt = 0 both sides.
  function spring(dt) {
    if (dt < -LEAD || dt > 3) return 0;
    if (dt < 0) return -0.14 * Math.sin(Math.PI * (dt + LEAD) / LEAD);
    return Math.exp(-dt / SPRING_TAU) * Math.sin(SPRING_W * dt);
  }

  // ---------- static layout (deterministic from seed) ----------
  function buildModel(seed) {
    var R = mulberry32(seed);
    function rand(a, b) { return a + (b - a) * R(); }
    function randInt(a, b) { return a + Math.floor(R() * (b - a + 1)); }
    function gauss() { var u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * R()); }
    var BASE_T = 60; // schedule is authored in seconds of a 60 s loop, stored as fractions

    // Radii/offsets measured from the source image (outer ring = 1).
    var ringDefs = [
      { r: 0.8896, ox: -0.0083, oy: -0.003, n: 112, delay: 0, gain: 1, wave: 1, gaps: [[236, 246, 0.3], [134, 164, 0.22], [324, 354, 0.18]] },
      { r: 1.0, ox: 0.0096, oy: -0.0012, n: 124, delay: 0.06, gain: 1.05, wave: 1.12, gaps: [[266, 276, 0.3], [152, 170, 0.22], [4, 22, 0.16]] }
    ];
    var rings = ringDefs.map(function (def) {
      var slots = [];
      for (var i = 0; i < def.n; i++) {
        var deg = ((i + rand(-0.08, 0.08)) / def.n) * 360;
        var drop = 0.03;
        def.gaps.forEach(function (g) { if (deg >= g[0] && deg < g[1]) drop = Math.max(drop, g[2]); });
        var block = R() < 0.28;
        var s = {
          a: deg * DEG,
          w0: block ? rand(0.02, 0.025) : rand(0.03, 0.046),
          h0: block ? rand(0.018, 0.028) : 0.0125,
          sh: block ? 0.06 : 0.3,               // resting sharpness: blocks square, dashes barely tapered
          spec: 0.22 + 0.78 * Math.pow(R(), 1.5),
          sq: randInt(2, 5), sph: rand(0, TAU), iv: R()
        };
        if (R() >= drop) slots.push(s);
      }
      return { r: def.r, ox: def.ox, oy: def.oy, delay: def.delay, gain: def.gain, wave: def.wave, slots: slots };
    });

    // Resting accents where the source has its bar clusters (breathe, never move).
    var idle = [[66, 0.55, 9], [96, 0.6, 7], [184, 0.55, 7], [216, 0.5, 8], [300, 0.35, 10], [48, 0.25, 8]]
      .map(function (b) { return { c: b[0] * DEG, amp: b[1], sig: b[2] * DEG, q: randInt(2, 4), ph: rand(0, TAU) }; });

    function mkHit(t, a, s, sigDeg, major, rank) {
      var h = { u: t / BASE_T, a: a, s: s, sig: sigDeg * DEG, major: major, rank: rank, sparks: [] };
      if (major) {
        // a scattered burst: every particle has its own direction, reach, speed, curve and start
        var np = Math.round(rand(22, 36) * (0.6 + 0.4 * s));
        for (var p = 0; p < np; p++) {
          h.sparks.push({
            a: a + h.sig * gauss() * 0.8,
            drift: rand(-8, 8) * DEG,
            delay: rand(0, 0.24),
            r0: rand(0.985, 1.04),
            dist: rand(0.06, 0.4) * (0.6 + 0.4 * s),
            life: rand(1.2, 2.8),
            size: rand(0.0035, 0.0065),
            alpha: rand(0.6, 1)
          });
        }
      }
      return h;
    }
    // Phrases: a main hit, sometimes 1–2 aftershocks nearby, then a pause of varying length.
    var hits = [], tt = rand(0.2, 1.2);
    while (tt < BASE_T - 0.6) {
      var rank = R();
      var main = mkHit(tt, rand(0, TAU), rand(0.65, 1), rand(11, 26), true, rank);
      hits.push(main);
      var na = R() < 0.55 ? randInt(1, 2) : 0, ta = tt;
      for (var k = 0; k < na; k++) {
        ta += rand(0.22, 0.6);
        hits.push(mkHit(ta, main.a + rand(-32, 32) * DEG, main.s * rand(0.4, 0.65), rand(6, 14), false, rank));
      }
      tt += rand(0.9, 2.8);
    }
    // Tremors: small random hits between phrases.
    for (var m = 0; m < 150; m++) {
      hits.push(mkHit(((m + rand(0.1, 0.9)) / 150) * BASE_T, rand(0, TAU), rand(0.16, 0.36), rand(3, 8), false, R() * 0.9));
    }

    // Dust circles like the site: concentric dotted rings with breaks. They don't
    // rotate; hits ripple through them from the inside out.
    var circleRadii = [1.035, 1.075, 1.115, 1.16, 1.205, 1.25, 1.295, 1.34];
    var circles = circleRadii.map(function (rc, j) {
      var dots = [], ang = rand(0, 0.3), on = R() < 0.7;
      var fade = 1 - 0.5 * (j / (circleRadii.length - 1));
      var pitch = rand(0.046, 0.06) / rc;
      while (ang < TAU - 0.02) {
        var len = on ? rand(10, 44) * DEG : rand(6, 30 + j * 4) * DEG;
        if (on) for (var x = ang; x < Math.min(ang + len, TAU - pitch * 0.5); x += pitch * rand(0.85, 1.2)) {
          dots.push({ a: x, dr: rand(-0.005, 0.005), size: rand(0.0058, 0.0085), alpha: rand(0.5, 1) * fade });
        }
        ang += len; on = !on;
      }
      return { r: rc, dots: dots, delay: 0.14 + 0.07 * j };
    });

    return { rings: rings, idle: idle, hits: hits, circles: circles };
  }

  // ---------- renderer (pure function of time) ----------
  function createRenderer(options) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in options || {}) o[k] = options[k];
    var model = buildModel(o.seed);
    var BUCKETS = 12;

    function included(h) { return h.rank < o.chaos * (h.major ? 0.8 : 0.72); }
    // wrapped time since impact, in [-T/2, T/2)
    function since(h, t, delay) { var T = o.loop, dt = t - delay - h.u * T; return dt - T * Math.floor(dt / T + 0.5); }

    // Hits relevant at time t for a layer reacting `delay` s after the inner ring.
    // Flat list: angle, sigma, spike envelope, spring displacement.
    function activeHits(t, delay) {
      var out = [], hs = model.hits;
      for (var i = 0; i < hs.length; i++) {
        var h = hs[i];
        if (!included(h)) continue;
        var dt = since(h, t, delay);
        if (dt < -LEAD || dt > WINDOW) continue;
        out.push(h.a, h.sig, h.s * envelope(dt), (h.major ? 1 : 0.35) * h.s * spring(dt), dt);
      }
      return out;
    }
    // Spike activity (soft union of hits) and radial wave displacement. The wave is
    // wider than the spike sector and broadens as it settles, like a ripple.
    function hitAt(theta, list, pointer) {
      var prod = 1, disp = 0;
      for (var i = 0; i < list.length; i += 5) {
        var dth = wrapPi(theta - list[i]), sig = list[i + 1];
        var d = dth / sig;
        if (d < 3.5 && d > -3.5) prod *= 1 - list[i + 2] * Math.exp(-d * d);
        if (list[i + 3] !== 0) {
          var wd = dth / (sig * (1.6 + 0.9 * Math.max(0, list[i + 4])));
          if (wd < 3.5 && wd > -3.5) disp += list[i + 3] * Math.exp(-wd * wd);
        }
      }
      if (pointer && pointer.amp > 0.002) {
        var dp = wrapPi(theta - pointer.angle) / (14 * DEG);
        prod *= 1 - 0.6 * pointer.amp * Math.exp(-dp * dp);
      }
      HIT.act = 1 - prod; HIT.disp = disp;
      return HIT;
    }
    var HIT = { act: 0, disp: 0 };
    function idleAt(theta, t) {
      var T = o.loop, prod = 1, id = model.idle;
      for (var i = 0; i < id.length; i++) {
        var b = id[i], d = wrapPi(theta - b.c) / b.sig;
        if (d > 3.5 || d < -3.5) continue;
        prod *= 1 - b.amp * (0.6 + 0.4 * Math.sin(TAU * b.q * t / T + b.ph)) * Math.exp(-d * d);
      }
      return 1 - prod;
    }

    // Mark shape: octagon with separate inward (hin) / outward (hout) reach and a
    // sharpness `sh` (0 = rectangle, 1 = pointed along the long axis: tall marks
    // become spikes, flat dashes become lenses). The two cases agree when the mean
    // height equals hw, so shapes morph without pops.
    function spikeMark(ctx, px, py, ang, hw, hin, hout, tipK, sh) {
      var aO, aI, b = hw * (1 - sh);
      if ((hin + hout) * 0.5 >= hw) {
        aO = hout - sh * Math.min(hout, hw * tipK);
        aI = hin - sh * Math.min(hin, hw * tipK);
      } else {
        aO = (1 - sh) * hout; aI = (1 - sh) * hin;
        b = hw - sh * Math.min(hw, (hin + hout) * 0.5 * 1.6);
      }
      var nx = Math.cos(ang), ny = Math.sin(ang), tx = -ny, ty = nx;
      function P(u, v, first) { var x = px + u * tx + v * nx, y = py + u * ty + v * ny; if (first) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      P(hw, aO, true); P(b, hout); P(-b, hout); P(-hw, aO);
      P(-hw, -aI); P(-b, -hin); P(b, -hin); P(hw, -aI);
      ctx.closePath();
    }
    function sat(x, cap) { return cap * (1 - Math.exp(-x / cap)); }

    function draw(ctx, w, h, t, ex) {
      ex = ex || {};
      var T = o.loop;
      var size = Math.min(w, h), R = size * 0.5 * o.scale, cx = w / 2, cy = h / 2;
      var pointer = o.pointer ? { angle: ex.pointerAngle || 0, amp: ex.pointerAmp || 0 } : null;
      var energy = o.energy, tipK = 1 + 4 * o.spike;

      // intro: a full circular front leaves the center and ignites the ring
      var introP = ex.intro == null ? 1 : ex.intro;
      var introDur = Math.max(0.001, o.intro), tI = introP >= 1 ? 1e9 : introP * introDur;
      var ignite = LEAD * 1.5;                         // s until the intro front reaches the ring
      var litT = tI - ignite;                          // s since ignition

      ctx.globalAlpha = 1;
      if (o.background && o.background !== 'transparent') { ctx.fillStyle = o.background; ctx.fillRect(0, 0, w, h); }
      else ctx.clearRect(0, 0, w, h);

      // ---- dust layer: fronts, sparks, drift (all as tiny needles, bucketed by alpha) ----
      var paths = [];
      for (var bk = 0; bk < BUCKETS; bk++) paths.push([]);
      var minW = 0.5, dOx = cx + 0.0096 * R, dOy = cy - 0.0012 * R;
      function put(x, y, ang, hl, hw, al) {
        if (al < 0.02) return;
        var bi = Math.min(BUCKETS - 1, Math.floor(clamp01(al) * BUCKETS));
        paths[bi].push(x, y, ang, Math.max(minW, hl), Math.max(minW, hw));
      }
      function arcFront(a0, span, rr, al) {                // dotted arc: tiny tangential dashes
        var pitch = 0.021 * R / rr, n = Math.max(1, Math.floor(span / pitch));
        for (var i = 0; i <= n; i++) {
          var f = n ? i / n * 2 - 1 : 0, th = a0 + f * span * 0.5;
          var edge = 1 - f * f;                            // fade toward the arc ends
          put(cx + rr * Math.cos(th), cy + rr * Math.sin(th), th + Math.PI / 2, 0.0085 * R, 0.0027 * R, al * edge);
        }
      }
      var dustK = o.dust * smoothstep(0, 0.6, litT);

      if (o.fronts !== false) {
        if (tI < ignite + 0.15) {                         // intro ring-front
          var ip = clamp01(tI / ignite);
          var ir = (0.1 + 0.77 * ip * ip) * R;
          var ia = 0.5 * smoothstep(0, 0.25, ip) * (1 - smoothstep(0.9, 1, ip));
          if (ia > 0.01) arcFront(0, TAU, ir, ia);
        }
        if (dustK > 0) {
          var hsF = model.hits;
          for (var fI = 0; fI < hsF.length; fI++) {
            var hf = hsF[fI];
            if (!hf.major || !included(hf)) continue;
            var dtf = since(hf, t, 0);
            if (dtf < -LEAD || dtf >= 0) continue;
            var fp = (dtf + LEAD) / LEAD;                  // 0 → 1 as the front reaches the inner ring
            var fr = (0.2 + 0.67 * fp * fp) * R;           // accelerating
            var fa = 0.5 * hf.s * smoothstep(0, 0.3, fp) * (1 - smoothstep(0.86, 1, fp)) * Math.min(1, dustK);
            arcFront(hf.a, hf.sig * 2.2, fr, fa);
          }
        }
      }

      if (dustK > 0) {
        var wave = BULGE * Math.min(1.4, energy);
        for (var cI = 0; cI < model.circles.length; cI++) {
          var circ = model.circles[cI];
          var cl = activeHits(t, circ.delay);
          var cIntro = 1.6 * spring(litT - circ.delay);
          for (var dI0 = 0; dI0 < circ.dots.length; dI0++) {
            var cd = circ.dots[dI0];
            var ch = hitAt(cd.a, cl, null);
            var cr = (circ.r + cd.dr + wave * 1.15 * (ch.disp + cIntro)) * R;
            put(dOx + cr * Math.cos(cd.a), dOy + cr * Math.sin(cd.a), cd.a, cd.size * R, cd.size * R,
                cd.alpha * (0.62 + 0.8 * ch.act * energy) * dustK);
          }
        }
        var hsR = model.hits, reach = 0.7 + 0.3 * Math.min(1.6, energy);
        for (var hI = 0; hI < hsR.length; hI++) {
          var hr = hsR[hI];
          if (!hr.sparks.length || !included(hr)) continue;
          var dt = since(hr, t, 0.1);
          if (dt < 0) dt += T;
          if (dt > 3.2) continue;
          var hitK = hr.s * Math.min(1, energy) * dustK;
          for (var sI = 0; sI < hr.sparks.length; sI++) {
            var sp = hr.sparks[sI], ls = dt - sp.delay;
            if (ls < 0 || ls >= sp.life) continue;
            var uu = ls / sp.life, e = 1 - Math.pow(1 - uu, 3), speed = Math.pow(1 - uu, 2);
            var th2 = sp.a + sp.drift * e;
            var r2 = sp.r0 + sp.dist * reach * e;
            var al = sp.alpha * Math.pow(1 - uu, 1.4) * smoothstep(0, 0.04, uu) * smoothstep(0.99, 1.03, r2) * hitK;
            var hl = sp.size * (1 + 4 * speed * (sp.dist / 0.2)) * R;   // motion streak: long while fast
            put(dOx + r2 * R * Math.cos(th2), dOy + r2 * R * Math.sin(th2), th2 + sp.drift * speed * 0.6, hl, sp.size * 0.8 * R, al);
          }
        }
      }

      ctx.fillStyle = o.dustColor;
      for (var bb = 0; bb < BUCKETS; bb++) {
        var pp = paths[bb]; if (!pp.length) continue;
        ctx.globalAlpha = (bb + 0.5) / BUCKETS;
        ctx.beginPath();
        for (var q = 0; q < pp.length; q += 5) {
          var X = pp[q], Y = pp[q + 1], ca = Math.cos(pp[q + 2]), sa = Math.sin(pp[q + 2]), L = pp[q + 3], W = pp[q + 4];
          ctx.moveTo(X + L * ca, Y + L * sa); ctx.lineTo(X - W * sa, Y + W * ca);
          ctx.lineTo(X - L * ca, Y - L * sa); ctx.lineTo(X + W * sa, Y - W * ca); ctx.closePath();
        }
        ctx.fill();
      }

      // ---- rings ----
      ctx.globalAlpha = 1;
      ctx.fillStyle = o.ink;
      ctx.beginPath();
      for (var r = 0; r < model.rings.length; r++) {
        var ring = model.rings[r];
        var ox = cx + ring.ox * R, oy = cy + ring.oy * R;
        var list = activeHits(t, ring.delay);
        var introDisp = 1.6 * spring(litT - ring.delay);   // whole ring springs at ignition
        for (var i = 0; i < ring.slots.length; i++) {
          var sl = ring.slots[i];
          var vis = smoothstep(0, 0.12 + 0.5 * sl.iv, litT - ring.delay);
          if (vis <= 0) continue;
          var hit = hitAt(sl.a, list, pointer);
          var act = 1 - (1 - hit.act) * (1 - idleAt(sl.a, t));
          var mod = 0.82 + 0.18 * Math.sin(TAU * sl.sq * t / T + sl.sph);
          var grow = energy * ring.gain * act * HMAX * sl.spec * mod;
          var kb = smoothstep(0, 0.04, grow);
          var hw = (sl.w0 + (0.022 - sl.w0) * kb * smoothstep(0.22, 0.65, hit.act)) * 0.5 * R * vis;
          var rad = (ring.r + BULGE * ring.wave * Math.min(1.4, energy) * (hit.disp + introDisp)) * R;
          var base = sl.h0 * 0.5, gIn, gOut;
          if (r === 0) { gIn = sat(0.55 * grow, INNER_IN); gOut = sat(0.45 * grow, INNER_OUT); }
          else { gIn = sat(0.2 * grow, OUTER_IN); gOut = 0.8 * grow; }
          var strike = smoothstep(0.22, 0.65, hit.act);                        // only real hits, not tremors
          var sharp = sl.sh + (1 - sl.sh) * strike;                            // hits sharpen marks into spikes
          spikeMark(ctx, ox + rad * Math.cos(sl.a), oy + rad * Math.sin(sl.a), sl.a, hw,
                    (base + gIn) * R * vis, (base + gOut) * R * vis, tipK, sharp);
        }
      }
      ctx.fill();
    }

    function set(next) {
      var reseed = next.seed !== undefined && next.seed !== o.seed;
      for (var k2 in next) o[k2] = next[k2];
      if (reseed) model = buildModel(o.seed);
    }
    // Test hook: radial extent [angle, inner edge, outer edge] of every mark at time t.
    function probe(t) {
      var res = [];
      for (var r = 0; r < model.rings.length; r++) {
        var ring = model.rings[r], list = activeHits(t, ring.delay), out = [];
        for (var i = 0; i < ring.slots.length; i++) {
          var sl = ring.slots[i], hit = hitAt(sl.a, list, null);
          var act = 1 - (1 - hit.act) * (1 - idleAt(sl.a, t));
          var grow = o.energy * ring.gain * act * HMAX * sl.spec * (0.82 + 0.18 * Math.sin(TAU * sl.sq * t / o.loop + sl.sph));
          var base = sl.h0 * 0.5, gIn, gOut;
          if (r === 0) { gIn = sat(0.55 * grow, INNER_IN); gOut = sat(0.45 * grow, INNER_OUT); }
          else { gIn = sat(0.2 * grow, OUTER_IN); gOut = 0.8 * grow; }
          var rad = ring.r + BULGE * ring.wave * Math.min(1.4, o.energy) * hit.disp;
          out.push([sl.a, rad - base - gIn, rad + base + gOut]);
        }
        res.push(out);
      }
      return res;
    }
    return { draw: draw, set: set, options: o, _probe: probe };
  }

  // ---------- browser mount ----------
  function mount(target, options) {
    if (typeof target === 'string') target = document.querySelector(target);
    if (!target) throw new Error('VinqyRing: target element not found');
    var canvas = target.tagName === 'CANVAS' ? target : target.appendChild(document.createElement('canvas'));
    if (canvas !== target) canvas.style.cssText = 'display:block;width:100%;height:100%;';
    canvas.setAttribute('aria-hidden', 'true');

    var renderer = createRenderer(options), o = renderer.options;
    var ctx = canvas.getContext('2d');
    var w = 1, h = 1, dpr = 1, simT = 0, introT = 0, last = 0, raf = 0;
    var running = true, onScreen = true;
    var pAng = 0, pTarget = 0, pAmp = 0, pOn = false;
    var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

    function render() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var intro = o.intro > 0 ? clamp01(introT / o.intro) : 1;
      renderer.draw(ctx, w, h, simT, { pointerAngle: pAng, pointerAmp: pAmp, intro: intro });
    }
    function tick(now) {
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      var reduced = mq && mq.matches;
      introT += reduced ? o.intro : dt;
      simT = (simT + dt * o.speed * (reduced ? 0.25 : 1)) % o.loop;
      pAmp += ((pOn ? 1 : 0) - pAmp) * Math.min(1, dt * 1.4);
      pAng += wrapPi(pTarget - pAng) * Math.min(1, dt * 2.5);
      render();
      raf = requestAnimationFrame(tick);
    }
    function update() {
      if (running && onScreen) { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } }
      else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }
    function resize() {
      var rect = canvas.getBoundingClientRect();
      w = Math.max(1, rect.width); h = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      render();
    }
    function onMove(e) {
      var rect = canvas.getBoundingClientRect();
      var dx = e.clientX - (rect.left + rect.width / 2), dy = e.clientY - (rect.top + rect.height / 2);
      var reach = (Math.min(rect.width, rect.height) / 2) * Math.min(1, o.scale * 1.7);
      pOn = o.pointer && Math.hypot(dx, dy) < reach;
      pTarget = Math.atan2(dy, dx);
    }
    function onLeave() { pOn = false; }

    var ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(canvas); else window.addEventListener('resize', resize);
    var io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(function (en) { onScreen = en[0].isIntersecting; update(); }) : null;
    if (io) io.observe(canvas);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    resize(); update();

    return {
      canvas: canvas, options: o,
      set: function (next) { renderer.set(next); if ('maxDpr' in next) resize(); else render(); },
      play: function () { running = true; update(); },
      pause: function () { running = false; update(); render(); },
      replayIntro: function () { introT = 0; },
      seek: function (t) { simT = ((t % o.loop) + o.loop) % o.loop; render(); },
      destroy: function () {
        running = false; update();
        if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
        if (io) io.disconnect();
        window.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerleave', onLeave);
        if (canvas !== target) canvas.remove();
      }
    };
  }

  return { mount: mount, createRenderer: createRenderer, DEFAULTS: DEFAULTS };
});
