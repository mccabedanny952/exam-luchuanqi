import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "鲸天系统 · 转运文件处理台",
  description: "基于字段规则库和 LLM 的转运文件接入与明细核对系统",
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
