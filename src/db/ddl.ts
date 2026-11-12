/**
 * Schéma SQL appliqué au démarrage. Idempotent : on peut le rejouer
 * autant de fois qu'on veut. Pas de dossier de migrations à gérer pour
 * une app locale à trois utilisateurs.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'membre',
  invited_via   TEXT,
  created_at    INTEGER NOT NULL
);

/* Projets ouverts à un invité. Voir le commentaire du schéma : un droit
   descend dans les sous-dossiers, et la table reste vide pour les comptes
   qui voient tout. */
CREATE TABLE IF NOT EXISTS folder_grants (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id  TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  link_id    TEXT REFERENCES share_links(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, folder_id)
);
CREATE INDEX IF NOT EXISTS folder_grants_user_idx ON folder_grants(user_id);

/* Acces a une video precise, sans passer par son dossier. Voir le schema :
   un lien qui ne partage qu'un montage ne doit pas ouvrir tout le projet. */
CREATE TABLE IF NOT EXISTS video_grants (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id   TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  link_id    TEXT REFERENCES share_links(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS video_grants_user_idx ON video_grants(user_id);

/* Lien de partage. Supprimer la ligne revoque le lien. */
CREATE TABLE IF NOT EXISTS share_links (
  id         TEXT PRIMARY KEY,
  token      TEXT NOT NULL UNIQUE,
  folder_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
  video_id   TEXT REFERENCES videos(id) ON DELETE CASCADE,
  expires_at INTEGER,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS share_links_token_idx ON share_links(token);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS folders_parent_idx ON folders(parent_id);

CREATE TABLE IF NOT EXISTS videos (
  id          TEXT PRIMARY KEY,
  folder_id   TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  filename    TEXT NOT NULL,
  size        INTEGER NOT NULL,
  duration    REAL,
  fps         REAL,
  status      TEXT NOT NULL DEFAULT 'a_review',
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS videos_folder_idx ON videos(folder_id);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  video_id   TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timecode      REAL NOT NULL,
  timecode_end  REAL,
  annotation    TEXT,
  body          TEXT NOT NULL,
  resolved   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_video_idx ON comments(video_id, timecode);

/* Réponses à une note. Table séparée plutôt qu'un "parent_id" sur "comments" :
   tout le reste de l'app, repères de la piste, note sous la tête de lecture,
   numérotation, filtres, part du principe qu'une ligne de "comments" est une
   note posée à un timecode. Une réponse n'en est pas une, elle n'a ni
   timecode, ni dessin, ni état résolu. Les mélanger obligerait à filtrer
   partout, et il suffirait d'un oubli pour qu'une réponse apparaisse comme un
   repère sur la piste. */
CREATE TABLE IF NOT EXISTS comment_replies (
  id         TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comment_replies_comment_idx
  ON comment_replies(comment_id, created_at);
`;
