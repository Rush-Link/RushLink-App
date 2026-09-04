import type { RushLinkSyncDocument } from "../domain/rushlink-sync";

/**
 * Account backends implement one compare-and-swap document per RushLink account.
 * Authentication tokens belong to the platform credential store and are never
 * accepted as part of a RushLinkSyncDocument.
 */
export interface RushLinkSyncAccountTransport {
  pull(accountId: string): Promise<RushLinkSyncDocument | null>;
  push(accountId: string, document: RushLinkSyncDocument, expectedRevision: number): Promise<RushLinkSyncDocument>;
}

export class RushLinkSyncRevisionError extends Error {
  constructor(public readonly latest: RushLinkSyncDocument) {
    super(`RushLink Sync revision changed to ${latest.revision}. Pull and merge before retrying.`);
    this.name = "RushLinkSyncRevisionError";
  }
}
