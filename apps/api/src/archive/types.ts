/** Destination abstraction for archive objects. */
export interface ObservationArchive {
  putObject(key: string, bytes: Uint8Array): Promise<void>;
  getObject(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
}

/** An object exists at the destination with bytes that differ from ours. */
export class ArchiveIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveIntegrityError";
  }
}
