import { hashText } from "../util/ids.js";

export interface OutboundMessageRecord {
  kinId: string;
  textHash: string;
  timestamp: number;
  requestId: string;
  idempotencyKey: string;
  confirmedAt?: number;
}

export interface DedupeMatch {
  matched: boolean;
  record?: OutboundMessageRecord;
}

export interface DedupeStore {
  recordOutbound(input: {
    kinId: string;
    text: string;
    requestId: string;
    idempotencyKey: string;
  }): Promise<OutboundMessageRecord>;
  matchRecentOutbound(input: { kinId: string; text: string; now?: number }): Promise<DedupeMatch>;
  confirm(record: OutboundMessageRecord, confirmedAt?: number): Promise<void>;
}

export class InMemoryDedupeStore implements DedupeStore {
  private readonly records: OutboundMessageRecord[] = [];

  constructor(private readonly windowMs: number) {}

  async recordOutbound(input: {
    kinId: string;
    text: string;
    requestId: string;
    idempotencyKey: string;
  }): Promise<OutboundMessageRecord> {
    const now = Date.now();
    this.prune(now);

    const record: OutboundMessageRecord = {
      kinId: input.kinId,
      textHash: hashText(input.text),
      timestamp: now,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey
    };

    this.records.push(record);
    return record;
  }

  async matchRecentOutbound(input: { kinId: string; text: string; now?: number }): Promise<DedupeMatch> {
    const now = input.now ?? Date.now();
    this.prune(now);

    const textHash = hashText(input.text);
    const record = this.records.find((candidate) => {
      return candidate.kinId === input.kinId && candidate.textHash === textHash;
    });

    return record ? { matched: true, record } : { matched: false };
  }

  async confirm(record: OutboundMessageRecord, confirmedAt = Date.now()): Promise<void> {
    record.confirmedAt = confirmedAt;
  }

  private prune(now: number): void {
    const oldest = now - this.windowMs;
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      if (this.records[index]!.timestamp < oldest) {
        this.records.splice(index, 1);
      }
    }
  }
}
