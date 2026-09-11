/** Destination abstraction for archive objects. */
export interface ObservationArchive {
  putObject(key: string, bytes: Uint8Array): Promise<void>;
  getObject(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
}
