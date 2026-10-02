"use client";

import { useEffect } from "react";

// 화면에서 오류가 나도 막다른 길이 되지 않게: 다시 시도하거나 PDF를 바로 열 수 있게 한다.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="intro">
      <section className="intro-card">
        <div className="intro-brand">CODESEEKER</div>
        <div className="intro-body">
          <h1>화면을 불러오지 못했습니다</h1>
          <p>
            이 기기의 브라우저에서는 뷰어가 동작하지 않았습니다.
            <br />
            아래 버튼으로 포트폴리오 PDF를 바로 열 수 있습니다.
          </p>
          <div className="intro-actions">
            <button className="btn ghost" onClick={() => reset()}>
              다시 시도
            </button>
            <a className="btn primary" href="/portfolio.pdf" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
              PDF 바로 열기
            </a>
          </div>
          <p className="fine" style={{ wordBreak: "break-all" }}>
            오류 정보: {error.message || "알 수 없음"}
          </p>
        </div>
      </section>
    </main>
  );
}
