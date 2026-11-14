export type Basis = "rectilinear" | "diagonal";
export type EntanglementMode = "correlated" | "anticorrelated";

export interface EntangledOutcomes {
  alice: 0 | 1;
  bobRaw: 0 | 1;
}

export function basisAngle(basis: Basis): number {
  return basis === "rectilinear" ? 0 : Math.PI / 4;
}

export function measureEntangledPair(
  aliceBasis: Basis,
  bobBasis: Basis,
  mode: EntanglementMode,
  randomAlice: number,
  randomRelation: number,
  visibility = 1,
): EntangledOutcomes {
  const angleDifference = basisAngle(aliceBasis) - basisAngle(bobBasis);
  const sameOutcomeProbability =
    (1 + visibility * Math.cos(2 * angleDifference)) / 2;
  const alice = (randomAlice < 0.5 ? 0 : 1) as 0 | 1;
  const sameOutcome = randomRelation < sameOutcomeProbability;
  const bobRaw =
    (mode === "correlated"
      ? sameOutcome
        ? alice
        : 1 - alice
      : sameOutcome
        ? 1 - alice
        : alice) as 0 | 1;

  return { alice, bobRaw };
}

export function correctedBobBit(
  bit: 0 | 1,
  mode: EntanglementMode,
): 0 | 1 {
  return (mode === "anticorrelated" ? 1 - bit : bit) as 0 | 1;
}

export function basisLabel(basis: Basis): string {
  return basis === "rectilinear" ? "Rectilinear (+)" : "Diagonal (×)";
}
