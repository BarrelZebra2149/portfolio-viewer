import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  devIndicators: false,
  turbopack: { root: path.resolve(__dirname) },
  // 챗봇 API가 서버에서 읽는 PDF를 배포 결과물에 포함시킨다.
  outputFileTracingIncludes: { "/api/chat": ["./data/portfolio.pdf"] },
};

export default nextConfig;
