/**
 * Simplified port of HackMIT's Gavel / Crowd-BT algorithm.
 * Reference: https://github.com/anishathalye/gavel
 *
 * Each project has a Gaussian quality belief (mu, sigmaSq).
 * After each vote the beliefs are updated via a Laplace approximation
 * of the Thurstone (probit) model posterior.
 *
 * Opponent selection is epsilon-greedy over Expected Information Gain:
 * pick the previously-seen project that maximises the binary entropy of
 * the predicted win probability — i.e., the one whose mu is closest to
 * the new project's mu, giving the most information per comparison.
 */

const EPSILON = 0.25; // exploration probability
export const MU_PRIOR = 0;
export const SIGMA_SQ_PRIOR = 1;

export interface GavelItem {
  id: string;
  mu: number;
  sigmaSq: number;
}

export function createItem(id: string): GavelItem {
  return { id, mu: MU_PRIOR, sigmaSq: SIGMA_SQ_PRIOR };
}

// ── Math helpers ───────────────────────────────────────────────────────────────

/** Standard normal CDF via rational approximation (Horner's method). */
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const p =
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const phi = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const result = 1 - phi * p;
  return x >= 0 ? result : 1 - result;
}

/** Standard normal PDF. */
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Binary entropy H(p). */
function binaryEntropy(p: number): number {
  if (p <= 1e-10 || p >= 1 - 1e-10) return 0;
  return -p * Math.log(p) - (1 - p) * Math.log(1 - p);
}

/** Win probability P(A > B) under the probit / Thurstone model. */
export function winProbability(a: GavelItem, b: GavelItem): number {
  const c = Math.sqrt(a.sigmaSq + b.sigmaSq + 1e-10);
  return normalCDF((a.mu - b.mu) / c);
}

// ── Core algorithm ─────────────────────────────────────────────────────────────

/**
 * Expected information gain for a comparison between newItem and candidate.
 * Approximated as the binary entropy of the win probability — maximised when
 * the match-up is most uncertain (i.e., mu values are closest).
 */
function expectedInfoGain(newItem: GavelItem, candidate: GavelItem): number {
  const p = winProbability(newItem, candidate);
  return binaryEntropy(p);
}

/**
 * Pick the best opponent from seenItems for the given newItem.
 * Epsilon-greedy: with probability EPSILON choose randomly;
 * otherwise choose the item that maximises EIG.
 */
export function pickOpponent(newItem: GavelItem, seenItems: GavelItem[]): GavelItem {
  if (seenItems.length === 0) throw new Error("No seen items to compare against");
  if (seenItems.length === 1) return seenItems[0];

  // Explore: random pick
  if (Math.random() < EPSILON) {
    return seenItems[Math.floor(Math.random() * seenItems.length)];
  }

  // Exploit: pick the opponent that maximises expected information gain
  return seenItems.reduce((best, candidate) => {
    return expectedInfoGain(newItem, candidate) > expectedInfoGain(newItem, best)
      ? candidate
      : best;
  });
}

/**
 * Update quality estimates for winner and loser after a comparison.
 * Uses the Laplace approximation of the Thurstone model posterior.
 */
export function updateItems(
  winner: GavelItem,
  loser: GavelItem,
): { winner: GavelItem; loser: GavelItem } {
  const c = Math.sqrt(winner.sigmaSq + loser.sigmaSq + 1e-10);
  const z = (winner.mu - loser.mu) / c;
  const p = Math.max(normalCDF(z), 1e-10);
  const pdf = normalPDF(z);

  // Gradient step on means
  const muWinner = winner.mu + (winner.sigmaSq / c) * (pdf / p);
  const muLoser = loser.mu - (loser.sigmaSq / c) * (pdf / p);

  // Second-order update on variances (keep variance positive with a floor)
  const sharedFactor = (pdf / p) * (z + pdf / p);
  const sigmaSqWinner = Math.max(
    0.05,
    winner.sigmaSq * (1 - (winner.sigmaSq / (c * c)) * sharedFactor),
  );
  const sigmaSqLoser = Math.max(
    0.05,
    loser.sigmaSq * (1 - (loser.sigmaSq / (c * c)) * sharedFactor),
  );

  return {
    winner: { ...winner, mu: muWinner, sigmaSq: sigmaSqWinner },
    loser: { ...loser, mu: muLoser, sigmaSq: sigmaSqLoser },
  };
}

/**
 * Return items sorted by descending mu — the current best estimate of ranking.
 */
export function getRanking(items: GavelItem[]): GavelItem[] {
  return [...items].sort((a, b) => b.mu - a.mu);
}
