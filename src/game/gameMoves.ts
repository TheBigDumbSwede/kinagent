export type PbtARollOutcome = "10+" | "7-9" | "6-";

export interface GameMove {
  id: string;
  name: string;
  trigger: string;
  stat: string;
  outcomes: Record<PbtARollOutcome, string>;
}

export interface RollRequest {
  moveId: string;
  actor?: string;
  modifier: number;
  prompt?: string;
  reason?: string;
}

export interface RollResult {
  moveId: string;
  moveName: string;
  actor?: string;
  dice: [number, number];
  modifier: number;
  total: number;
  outcome: PbtARollOutcome;
  outcomeText: string;
}

export interface DiceRoller {
  rollDie(sides: number): number;
}

export const genericMysteryMoves: GameMove[] = [
  {
    id: "interpret_evidence",
    name: "Interpret Evidence",
    trigger: "When a player studies evidence, asks pointed questions, or follows a clue under uncertainty.",
    stat: "sharp",
    outcomes: {
      "10+": "success",
      "7-9": "partial success with complication",
      "6-": "failure with complication"
    }
  },
  {
    id: "risky_action",
    name: "Risky Action",
    trigger: "When a player does something risky under threat, time pressure, or unstable conditions.",
    stat: "cool",
    outcomes: {
      "10+": "success",
      "7-9": "partial success with complication",
      "6-": "failure with complication"
    }
  },
  {
    id: "shield_another",
    name: "Shield Another",
    trigger: "When a player shields another character from immediate harm or consequences.",
    stat: "tough",
    outcomes: {
      "10+": "success",
      "7-9": "partial success with complication",
      "6-": "failure with complication"
    }
  },
  {
    id: "social_leverage",
    name: "Social Leverage",
    trigger: "When a player persuades, deceives, bargains, or pressures an NPC under uncertainty.",
    stat: "charm",
    outcomes: {
      "10+": "success",
      "7-9": "partial success with complication",
      "6-": "failure with complication"
    }
  },
  {
    id: "face_unknown",
    name: "Face the Unknown",
    trigger: "When a player confronts supernatural dread, impossible evidence, or a destabilizing revelation.",
    stat: "weird",
    outcomes: {
      "10+": "success",
      "7-9": "partial success with complication",
      "6-": "failure with complication"
    }
  }
];

const legacyMoveAliases = new Map<string, string>([
  ["investigate", "interpret_evidence"],
  ["act_under_pressure", "risky_action"],
  ["protect_someone", "shield_another"],
  ["convince", "social_leverage"],
  ["face_the_unknown", "face_unknown"]
]);

export const randomDiceRoller: DiceRoller = {
  rollDie(sides: number): number {
    return Math.floor(Math.random() * sides) + 1;
  }
};

export function createSequenceDiceRoller(values: number[]): DiceRoller {
  let index = 0;
  return {
    rollDie(sides: number): number {
      const value = values[index++];
      if (!Number.isInteger(value) || value < 1 || value > sides) {
        throw new Error(`Deterministic dice value must be between 1 and ${sides}; received ${String(value)}.`);
      }
      return value;
    }
  };
}

export function resolvePbtARoll(
  request: RollRequest,
  input: { moves?: GameMove[]; roller?: DiceRoller } = {}
): RollResult {
  const moves = input.moves ?? genericMysteryMoves;
  const moveId = canonicalMoveId(request.moveId);
  const move = moves.find((candidate) => candidate.id === moveId);
  if (!moveId || !move) {
    throw new Error(`Unknown game move: ${request.moveId}`);
  }

  const roller = input.roller ?? randomDiceRoller;
  const dice: [number, number] = [roller.rollDie(6), roller.rollDie(6)];
  const total = dice[0] + dice[1] + request.modifier;
  const outcome = pbtaOutcome(total);
  return {
    moveId,
    moveName: move.name,
    ...(request.actor ? { actor: request.actor } : {}),
    dice,
    modifier: request.modifier,
    total,
    outcome,
    outcomeText: move.outcomes[outcome]
  };
}

export function pbtaOutcome(total: number): PbtARollOutcome {
  if (total >= 10) {
    return "10+";
  }
  if (total >= 7) {
    return "7-9";
  }
  return "6-";
}

export function normalizeRollRequest(value: unknown, moves: GameMove[] = genericMysteryMoves): RollRequest | undefined {
  const record = objectRecord(value);
  if (!record) {
    return undefined;
  }

  const moveId = canonicalMoveId(optionalText(record.moveId ?? record.move_id, 80));
  if (!moveId || !moves.some((move) => move.id === moveId)) {
    return undefined;
  }

  return {
    moveId,
    ...(optionalText(record.actor, 120) ? { actor: optionalText(record.actor, 120) } : {}),
    modifier: optionalModifier(record.modifier),
    ...(optionalText(record.prompt, 280) ? { prompt: optionalText(record.prompt, 280) } : {}),
    ...(optionalText(record.reason, 280) ? { reason: optionalText(record.reason, 280) } : {})
  };
}

function canonicalMoveId(moveId: string | undefined): string | undefined {
  return moveId ? (legacyMoveAliases.get(moveId) ?? moveId) : undefined;
}

function optionalModifier(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-3, Math.min(3, Math.trunc(value)));
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return normalized ? normalized.slice(0, maxLength) : undefined;
}
