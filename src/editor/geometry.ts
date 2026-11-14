/** Géométrie des tracés du croquis (fonctions pures). */

export type Pt = { x: number; y: number };

/** Points d'un chemin « M x y L x y … » (les anciens croquis n'ont que ces commandes). */
export function pathPoints(d: string): Pt[] {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

export function toPath(pts: Pt[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer-Douglas-Peucker : retire les points qui s'écartent de moins de `epsilon` de la ligne. */
export function simplify(pts: Pt[], epsilon = 0.6): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  // Pile plutôt que récursion : un long tracé ne doit pas faire déborder la pile d'appels.
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    let far = -1;
    let max = epsilon;
    for (let i = from + 1; i < to; i++) {
      const d = distToSegment(pts[i], pts[from], pts[to]);
      if (d > max) {
        max = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = true;
      stack.push([from, far], [far, to]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Le point `p` touche-t-il ce tracé (à `radius` près) ? */
export function hitsPath(d: string, p: Pt, radius: number): boolean {
  const pts = pathPoints(d);
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= radius;
  for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= radius) return true;
  return false;
}
