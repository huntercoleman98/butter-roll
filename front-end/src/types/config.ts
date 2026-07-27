// Mirrors the JSON served by GET /api/config (see back-end/config.go).
// Rules are enforced authoritatively on the backend; the client only reads them
// to preview/mirror behavior (e.g. show a status badge instantly).

export interface Rule {
  on: string; // proto oneof name, e.g. "tokenUpdate"
  when: string; // condition expression
  do: string[]; // actions applied in order when `when` is true
}

export interface Config {
  rules: Rule[];
  // Confines the /player token picker to the folder with this id and its
  // subfolders. Empty/absent means the whole library is available.
  playerTokenFolderId?: string;
}
