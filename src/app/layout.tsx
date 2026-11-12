import type { Metadata } from "next";
// Servie depuis le projet, comme les autres polices : aucun appel à un CDN.
import "@fontsource-variable/inter";
import "./globals.css";
import { Toaster } from "@/components/toast";

export const metadata: Metadata = {
  title: "Reviewer",
  description: "Review vidéo collaborative avec commentaires au timecode",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="min-h-dvh">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
