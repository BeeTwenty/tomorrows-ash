/** Mirrors `launcher_core::app`. Kept by hand; the shapes are small and stable. */

export type RowState = "ok" | "warn" | "block" | "busy" | "idle";

export interface Row {
  key: string;
  value: string;
  state: RowState;
  detail: string;
}

export interface Status {
  realm: string;
  realm_address: string;
  client_version: string;
  patch_level: number;
  runtime: string;
  rows: Row[];
  action: string;
  can_launch: boolean;
  blocked_because: string;
}

export type FileState =
  | { state: "match" }
  | { state: "differs"; expected: string; found: string }
  | { state: "wrong_size"; expected: number; found: number }
  | { state: "missing" }
  | { state: "unreadable"; reason: string };

export interface FileReport {
  path: string;
  state: FileState;
}

export interface Report {
  files: FileReport[];
  matched: number;
  differing: number;
  missing: number;
  unreadable: number;
  bytes_hashed: number;
  complete: boolean;
}

export interface Progress {
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
}

export interface Account {
  username: string;
  characters: number;
  token: string;
}

export interface Runtime {
  kind: "wine" | "proton";
  name: string;
  program: string;
  steam_root: string | null;
}

export interface Settings {
  client_path: string | null;
  realm_address: string | null;
  runtime_name: string | null;
  prefix: string | null;
  renderer: "direct3d" | "opengl";
  windowed: boolean;
  account_name: string | null;
  extra_args: string[];
}
