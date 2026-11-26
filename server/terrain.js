// Salinan murni (tanpa three.js) dari fungsi medan di survival.js, supaya server tahu mana air / jurang / area lompat.
// PENTING: jika rumus medan di survival.js berubah, ubah di sini juga (ada tes yang membandingkan keduanya).
const CH = 30, WL = -4.2, ZC = 340, ZR = 62, Z_RIM = 34, Z_ISL = 11.5;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function hash(a, b, seed) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const POND = { plain: 0.2, forest: 0.3, desert: 0.08, swamp: 0.55 };

export function makeTerrain(worldSeed) {
  const vnoise = (x, y, salt) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const r = (i, j) => hash(i, j, worldSeed + salt) / 4294967295;
    return lerp(lerp(r(xi, yi), r(xi + 1, yi), u), lerp(r(xi, yi + 1), r(xi + 1, yi + 1), u), v);
  };
  function pondChance(x, z) {
    if (Math.hypot(x, z) < 90) return POND.plain;
    const n1 = 0.65 * vnoise(x / 200, z / 200, 11) + 0.35 * vnoise(x / 70, z / 70, 23);
    const n2 = vnoise(x / 150 + 40, z / 150 + 40, 37);
    if (n1 < 0.38) return POND.desert;
    if (n1 > 0.62) return POND.forest;
    if (n2 > 0.66) return POND.swamp;
    return POND.plain;
  }
  function rawHeight(x, z) {
    const big = (vnoise(x / 66, z / 66, 71) - 0.5) * 12.5, mid = (vnoise(x / 26, z / 26, 72) - 0.5) * 2.8, dist = Math.hypot(x, z);
    const mesa = smooth(0.50, 0.62, vnoise(x / 80, z / 80, 93)) * 4.8 * smooth(30, 65, dist);
    return (big + mid) * smooth(12, 70, dist) + mesa;
  }
  function riverT(x, z) {
    const rv = Math.abs(vnoise(x / 120, z / 120, 91) - 0.5);
    return (1 - smooth(0.008, 0.11, rv)) * smooth(25, 55, Math.hypot(x, z));
  }
  const pondCache = new Map(), zoneCache = new Map();
  function pondOf(cx, cz) {
    const key = cx + ',' + cz;
    if (pondCache.has(key)) return pondCache.get(key);
    const rng = mulberry(hash(cx, cz, worldSeed + 555));
    const pc = pondChance(cx * CH + CH / 2, cz * CH + CH / 2);
    let p = null;
    if ((cx === 0 && cz === -1) || rng() < pc) {
      const r = 3 + rng() * 2;
      const x = cx * CH + 11 + rng() * (CH - 22), z = cz * CH + 11 + rng() * (CH - 22);
      const b0 = rawHeight(x, z), guaranteed = cx === 0 && cz === -1;
      let rough = !guaranteed && (riverT(x, z) > 0 || b0 < WL + 1.2);
      for (let k = 0; k < 4 && !rough && !guaranteed; k++) {
        const ax = x + Math.cos(k * 1.571) * 9, az = z + Math.sin(k * 1.571) * 9;
        if (Math.abs(rawHeight(ax, az) - b0) > 1.4 || riverT(ax, az) > 0) rough = true;
      }
      if (!rough) p = { x, z, r, base: b0 - 0.3 };
    }
    if (p && zoneNear(p.x, p.z, 12)) p = null;
    pondCache.set(key, p);
    return p;
  }
  function buildZone(ix, iz) {
    const rng = mulberry(hash(ix, iz, worldSeed + 777));
    const first = ix === 0 && iz === 0;
    if (!first && rng() > 0.4) return null;
    let cx, cz;
    if (first) { const a = rng() * 6.2832, d = 85 + rng() * 15; cx = Math.cos(a) * d; cz = Math.sin(a) * d; }
    else { cx = ix * ZC + (rng() - 0.5) * 200; cz = iz * ZC + (rng() - 0.5) * 200; }
    const h0 = Math.max(rawHeight(cx, cz), WL + 6), floor = Math.min(h0 - 14, WL - 3);
    return { cx, cz, h0, floor, isl: h0 + 1.2 };
  }
  function zoneCell(ix, iz) {
    const key = ix + ',' + iz;
    if (zoneCache.has(key)) return zoneCache.get(key);
    const z = buildZone(ix, iz); zoneCache.set(key, z); return z;
  }
  function zoneNear(x, z, margin) {
    const Zn = zoneCell(Math.floor((x + ZC / 2) / ZC), Math.floor((z + ZC / 2) / ZC));
    if (!Zn) return null;
    const dx = x - Zn.cx, dz = z - Zn.cz, rr = ZR + (margin || 0);
    return dx * dx + dz * dz < rr * rr ? Zn : null;
  }
  const zoneHeight = (Zn, d) => lerp(d < 22 ? Zn.isl : Zn.h0, Zn.floor, smooth(Z_ISL - 1, Z_ISL + 1, d) * (1 - smooth(Z_RIM - 2.5, Z_RIM, d)));
  function heightAt(x, z) {
    let h = rawHeight(x, z);
    const rt = riverT(x, z);
    if (rt > 0) h = lerp(h, Math.min(h, Math.max(WL - 0.8, h - 7)), rt);
    const p = pondOf(Math.floor(x / CH), Math.floor(z / CH));
    if (p) {
      const d = Math.hypot(x - p.x, z - p.z);
      h = lerp(h, p.base, 1 - smooth(p.r + 1, p.r + 6, d));
      h -= 0.5 * (1 - smooth(p.r - 0.5, p.r + 1.5, d));
    }
    const Zn = zoneNear(x, z);
    if (Zn) { const d = Math.hypot(x - Zn.cx, z - Zn.cz); h = lerp(h, zoneHeight(Zn, d), 1 - smooth(40, ZR, d)); }
    return h;
  }
  // tempat yang wajar untuk NPC darat: bukan air/rawa dalam, bukan jurang sungai, bukan di dekat area lompat
  function walkable(x, z) {
    if (riverT(x, z) > 0.12) return false;
    if (zoneNear(x, z, 12)) return false;
    return heightAt(x, z) > WL + 0.7;
  }
  return { heightAt, riverT, zoneNear, walkable, WL };
}
