import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CODESEEKER 이은총 포트폴리오",
  description: "백엔드 개발자 이은총의 포트폴리오를 읽는 자체 제작 PDF 뷰어입니다.",
};

export const viewport: Viewport = {
  themeColor: "#0c0e14",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
