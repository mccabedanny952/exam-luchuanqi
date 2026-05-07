import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cargo Flow Console",
  description: "多模板 Excel 智能导入与运单管理系统",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
