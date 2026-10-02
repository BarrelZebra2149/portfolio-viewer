"use client";

// 맨 바깥(layout)에서 오류가 났을 때의 마지막 안내. 스타일 파일에 기대지 않고 직접 꾸민다.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, background: "#d2d2d2", color: "#262626", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 520, margin: "0 auto", padding: "64px 20px", textAlign: "center" }}>
          <h1 style={{ fontSize: 24 }}>화면을 불러오지 못했습니다</h1>
          <p style={{ lineHeight: 1.7 }}>포트폴리오 PDF를 아래 버튼으로 바로 열 수 있습니다.</p>
          <p>
            <button onClick={() => reset()} style={{ padding: "10px 18px", marginRight: 8 }}>
              다시 시도
            </button>
            <a href="/portfolio.pdf" style={{ padding: "10px 18px", background: "#262626", color: "#fff", borderRadius: 6, textDecoration: "none" }}>
              PDF 바로 열기
            </a>
          </p>
          <p style={{ fontSize: 12, color: "#555", wordBreak: "break-all" }}>오류 정보: {error.message || "알 수 없음"}</p>
        </main>
      </body>
    </html>
  );
}
