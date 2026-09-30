/**
 * Distribution primitives (pure, tested against published values).
 *
 * A prop asks a tail question — P(stat > line) — not "is the average above the
 * line". Answering it directly is roughly 1.5x more statistically efficient
 * than counting how often a player cleared the number, because a hit-rate count
 * throws away magnitude: 62 yards and 140 yards against a 60.5 line are the
 * same single "hit".
 *
 * No dependencies; these are standard series/continued-fraction approximations.
 */

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 error function. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  let q: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pLow) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ---- log gamma & incomplete beta (for the Student-t tail) ----------------

export function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = 0.99999999999980993;
  const t = z + 7.5;
  for (let i = 0; i < g.length; i++) a += g[i] / (z + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularized incomplete beta I_x(a,b) by continued fraction. */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta);
  // Use the symmetry relation where the series converges faster.
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a);

  let f = 1;
  let c = 1;
  let d = 0;
  const tiny = 1e-30;
  for (let i = 0; i <= 300; i++) {
    const m = Math.floor(i / 2);
    let numerator: number;
    if (i === 0) numerator = 1;
    else if (i % 2 === 0) numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else numerator = -(((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1)));
    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    const cd = c * d;
    f *= cd;
    if (Math.abs(1 - cd) < 1e-12) break;
  }
  return (front * (f - 1)) / a;
}

/** Student-t CDF with `df` degrees of freedom. */
export function studentTCdf(t: number, df: number): number {
  if (!Number.isFinite(df) || df <= 0) return normalCdf(t);
  if (df > 300) return normalCdf(t); // indistinguishable, and cheaper
  const x = df / (df + t * t);
  const p = 0.5 * incompleteBeta(x, df / 2, 0.5);
  return t > 0 ? 1 - p : p;
}

// ---- discrete counts -----------------------------------------------------

/** P(X <= k) for Poisson(mean). */
export function poissonCdf(k: number, mean: number): number {
  if (mean <= 0) return k >= 0 ? 1 : 0;
  const kk = Math.floor(k);
  if (kk < 0) return 0;
  let term = Math.exp(-mean);
  let sum = term;
  for (let i = 1; i <= kk; i++) {
    term *= mean / i;
    sum += term;
  }
  return Math.min(1, sum);
}

/**
 * P(X <= k) for a negative binomial parameterised by mean and variance.
 * Counts like receptions are often *under*-dispersed because targets are
 * role-constrained, which would give a negative dispersion parameter — so we
 * fall back to Poisson whenever the variance does not exceed the mean.
 */
export function negBinomialCdf(k: number, mean: number, variance: number): number {
  if (mean <= 0) return k >= 0 ? 1 : 0;
  if (!(variance > mean)) return poissonCdf(k, mean);
  const r = (mean * mean) / (variance - mean);
  const p = r / (r + mean);
  const kk = Math.floor(k);
  if (kk < 0) return 0;
  // P(X=0) = p^r, then the standard recurrence.
  let term = Math.exp(r * Math.log(p));
  let sum = term;
  for (let i = 1; i <= kk; i++) {
    term *= ((r + i - 1) / i) * (1 - p);
    sum += term;
  }
  return Math.min(1, sum);
}

/** 20-node Gauss-Legendre abscissae/weights on [-1, 1] (symmetric halves). */
const GL20_X = [
  0.0765265211334973, 0.2277858511416451, 0.3737060887154195, 0.5108670019508271,
  0.6360536807265150, 0.7463319064601508, 0.8391169718222188, 0.9122344282513259,
  0.9639719272779138, 0.9931285991850949,
];
const GL20_W = [
  0.1527533871307258, 0.1491729864726037, 0.1420961093183820, 0.1316886384491766,
  0.1181945319615184, 0.1019301198172404, 0.0832767415767048, 0.0626720483341091,
  0.0406014298003869, 0.0176140071391521,
];

/**
 * Standard bivariate normal CDF: P(X <= h, Y <= k) with correlation rho.
 *
 * Uses the classic one-dimensional reduction
 *   Phi2(h,k,rho) = Phi(h)Phi(k) + (1/2pi) * integral_0^rho f(r) dr,
 *   f(r) = (1-r^2)^-1/2 * exp(-(h^2 - 2 r h k + k^2) / (2(1-r^2)))
 * evaluated by 20-node Gauss-Legendre quadrature, which is smooth and accurate
 * for |rho| well away from 1 — the range that matters for correlated prop legs.
 */
export function bivariateNormalCdf(h: number, k: number, rho: number): number {
  const r = Math.max(-0.999999, Math.min(0.999999, rho));
  const base = normalCdf(h) * normalCdf(k);
  if (r === 0) return base;
  const half = r / 2;
  let sum = 0;
  for (let i = 0; i < GL20_X.length; i++) {
    for (const sign of [-1, 1]) {
      const t = half + half * sign * GL20_X[i];
      const om = 1 - t * t;
      sum += GL20_W[i] * Math.exp(-(h * h - 2 * t * h * k + k * k) / (2 * om)) / Math.sqrt(om);
    }
  }
  return Math.max(0, Math.min(1, base + (half * sum) / (2 * Math.PI)));
}

/**
 * Regularised lower incomplete gamma P(a, x) — the gamma distribution's CDF
 * with unit scale. Series for x < a + 1, continued fraction otherwise
 * (Numerical Recipes, gammp).
 */
export function regularizedGammaP(a: number, x: number): number {
  if (!(a > 0) || !(x > 0)) return 0;
  const lnPre = a * Math.log(x) - x - logGamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return Math.min(1, Math.exp(lnPre) * sum);
  }
  // Lentz's continued fraction for Q(a, x).
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.max(0, 1 - Math.exp(lnPre) * h);
}

/** Gamma CDF with shape k and scale theta. */
export function gammaCdf(x: number, shape: number, scale: number): number {
  if (x <= 0) return 0;
  return regularizedGammaP(shape, x / scale);
}

/** Log-normal CDF where ln X ~ N(mu, s^2). */
export function lognormalCdf(x: number, mu: number, s: number): number {
  if (x <= 0) return 0;
  return normalCdf((Math.log(x) - mu) / s);
}
