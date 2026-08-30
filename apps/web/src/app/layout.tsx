import type { ReactNode } from "react";

export const metadata = {
  title: "AfroTune",
  description: "AI-made personalized songs, straight from WhatsApp.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          margin: 0,
          background: "#0d0d12",
          color: "#f5f5f5",
        }}
      >
        {children}
      </body>
    </html>
  );
}
