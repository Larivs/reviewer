import type { Metadata } from "next";
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
