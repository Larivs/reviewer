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
};

export default nextConfig;
