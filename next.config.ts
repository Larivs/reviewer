import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Modules natifs (better-sqlite3, argon2) et paquets qui embarquent un
  // binaire (ffmpeg, ffprobe) : ils doivent rester en require() Node. Bundlés,
  // ils résolvent un chemin d'exécutable qui n'existe pas.
  serverExternalPackages: [
    "better-sqlite3",
    "@node-rs/argon2",
    "ffmpeg-static",
    "ffprobe-static",
  ],
  // Inutile de dire à qui sonde quel serveur répond.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Un fichier déposé n'est jamais réinterprété comme autre chose
          // que le type qu'on annonce.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // L'app n'a aucune raison d'être affichée dans le cadre d'un autre
          // site, où un clic piégé résoudrait ou supprimerait à ta place.
          { key: "X-Frame-Options", value: "DENY" },
          // L'adresse d'un lien de review **est** le droit d'entrer : elle ne
          // doit pas partir dans l'en-tête Referer vers un autre site.
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
