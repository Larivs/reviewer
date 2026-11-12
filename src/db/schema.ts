import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";

/**
 * Une instance = un espace. Hugo fait tourner la sienne, Jérôme la sienne,
 * et chacun invite qui il veut chez lui : il n'y a donc pas de table
 * d'espaces, seulement des rôles au sein de celui-ci.
 *
 * - `admin`  : gère les comptes. Un par instance, celui du `npm run seed`.
 * - `membre` : le studio. Voit tout, dépose, commente.
 * - `invite` : un client. Ne voit que les projets qu'on lui a ouverts.
 */
export const USER_ROLES = ["admin", "membre", "invite"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<UserRole>().notNull().default("membre"),
  /**
   * Lien de partage qui a fait naître ce compte, pour un invité entré sans
   * mot de passe. `null` pour tout compte ouvert depuis la page des comptes.
   *
   * C'est ce qui rend l'expiration réelle : sans cette trace, un invité
   * garderait son accès trente jours après la mort du lien, simplement parce
   * que son cookie de session, lui, n'a pas expiré.
   */
  invitedVia: text("invited_via"),
  createdAt: integer("created_at").notNull(),
});

/**
 * Portée d'un invité : les projets qui lui sont ouverts. Un droit posé sur un
 * dossier descend dans ses sous-dossiers, sinon il faudrait le redonner à
 * chaque sous-dossier créé, et un oubli rendrait du contenu invisible à celui
 * qui doit le commenter.
 *
 * Table vide pour un admin ou un membre : leur portée est l'espace entier,
 * elle ne s'énumère pas.
 */
/**
 * Lien de partage : une adresse qu'on transmet, et qui ouvre un projet ou
 * une vidéo à qui l'a.
 *
 * Exactement l'un des deux champs de portée est renseigné. Un lien vers une
 * seule vidéo est le geste le plus courant, « voilà le montage », et un
 * lien vers un projet sert au client récurrent qui suivra les versions.
 *
 * Pas de mot de passe et pas de journal d'accès : le choix assumé est la
 * friction zéro, avec l'expiration pour seul garde-fou. Supprimer la ligne
 * révoque le lien.
 */
export const shareLinks = sqliteTable(
  "share_links",
  {
    id: text("id").primaryKey(),
    /** Ce qui figure dans l'URL. Distinct de l'id : jamais deviné. */
    token: text("token").notNull().unique(),
    folderId: text("folder_id"),
    videoId: text("video_id"),
    /** `null` = sans expiration. */
    expiresAt: integer("expires_at"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("share_links_token_idx").on(t.token)],
);

/**
 * Accès à une vidéo précise, sans passer par son dossier. Pendant de
 * `folderGrants` pour les liens qui ne partagent qu'un montage : sans cette
 * table, ouvrir une vidéo à un client ouvrirait tout le projet qui la
 * contient.
 */
export const videoGrants = sqliteTable(
  "video_grants",
  {
    userId: text("user_id").notNull(),
    videoId: text("video_id").notNull(),
    /**
     * Lien qui a ouvert cet accès, ou `null` pour un droit posé à la main.
     * Le droit ne vaut que tant que ce lien vit : c'est ce qui fait qu'une
     * révocation retire vraiment l'accès, à qui que ce soit qui l'ait obtenu
     * par là, y compris un compte né d'un autre lien.
     */
    linkId: text("link_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.videoId] }),
    index("video_grants_user_idx").on(t.userId),
  ],
);

export const folderGrants = sqliteTable(
  "folder_grants",
  {
    userId: text("user_id").notNull(),
    folderId: text("folder_id").notNull(),
    /** Voir `videoGrants.linkId` : `null` = droit posé par un admin. */
    linkId: text("link_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.folderId] }),
    index("folder_grants_user_idx").on(t.userId),
  ],
);

export const sessions = sqliteTable("sessions", {
  // On stocke le SHA-256 du token, jamais le token lui-même :
  // une fuite de la base ne permet pas d'usurper une session.
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const folders = sqliteTable(
  "folders",
  {
    id: text("id").primaryKey(),
    parentId: text("parent_id"), // null = racine
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("folders_parent_idx").on(t.parentId)],
);

export const VIDEO_STATUSES = [
  "a_review",
  "en_cours",
  "modifs_demandees",
  "valide",
] as const;

export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const videos = sqliteTable(
  "videos",
  {
    id: text("id").primaryKey(),
    folderId: text("folder_id"),
    name: text("name").notNull(),
    filename: text("filename").notNull(), // nom sur disque, dans data/videos/
    size: integer("size").notNull(),
    duration: real("duration"), // secondes
    fps: real("fps"),
    status: text("status").$type<VideoStatus>().notNull().default("a_review"),
    uploadedBy: text("uploaded_by"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("videos_folder_idx").on(t.folderId)],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    videoId: text("video_id").notNull(),
    userId: text("user_id").notNull(),
    timecode: real("timecode").notNull(), // secondes
    /** Fin de plage, quand la note couvre un intervalle plutôt qu'un point. */
    timecodeEnd: real("timecode_end"),
    /** Formes dessinées sur l'image, en JSON. Coordonnées normalisées. */
    annotation: text("annotation"),
    body: text("body").notNull(),
    resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("comments_video_idx").on(t.videoId, t.timecode)],
);

/**
 * Réponses à une note. Voir le DDL : c'est une table à part et non un
 * `parent_id` sur `comments`, parce qu'une réponse n'est pas une note posée
 * à un timecode.
 */
export const commentReplies = sqliteTable(
  "comment_replies",
  {
    id: text("id").primaryKey(),
    commentId: text("comment_id").notNull(),
    userId: text("user_id").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("comment_replies_comment_idx").on(t.commentId, t.createdAt)],
);
