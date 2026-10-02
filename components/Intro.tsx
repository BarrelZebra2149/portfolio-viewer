"use client";

import { useState } from "react";

const STEPS = 3;

export default function Intro({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const next = () => (step === STEPS - 1 ? onDone() : setStep(step + 1));

  return (
    <main className="intro">
      <section className="intro-card" key={step} aria-live="polite">
        <div className="intro-brand">CODESEEKER</div>
        <div className="intro-body">

        {step === 0 && (
          <>
            <h1>자체 제작 PDF 뷰어입니다</h1>
            <p>
              포트폴리오 설명에 앞서, 본 PDF 뷰어는 기존에 만들어진 PDF 뷰어를 띄우는 걸 역링크한 것이
              아니며, 자체적으로 제작했음을 알립니다.
            </p>
            <p className="fine">
              PDF를 화면에 그리는 엔진은 오픈소스 PDF.js(Mozilla)를 사용했고, 화면과 탐색 기능은 직접
              구현했습니다.
            </p>
          </>
        )}

        {step === 1 && (
          <>
            <h1>왜 직접 만들었나요</h1>
            <p>
              파일을 내려받아 열지 않고, 열자마자 읽으면서 프로젝트별로 바로 이동할 수 있는 뷰어가
              필요하다고 생각했습니다.
            </p>
            <p className="fine">
              이 사이트는 Next.js로 만들어 Vercel에 배포했습니다. 다른 PDF 파일도 같은 화면에서 열 수
              있습니다.
            </p>
          </>
        )}

        {step === 2 && (
          <>
            <h1>사용법</h1>
            <ul className="intro-list">
              <li>
                <b>쪽 이동</b>
                <span>← → 키, 화면 좌우 밀기, 위쪽 쪽 번호 입력</span>
              </li>
              <li>
                <b>프로젝트 이동</b>
                <span>왼쪽 목록에서 프로젝트를 누르면 해당 첫 쪽으로 이동합니다.</span>
              </li>
              <li>
                <b>검색</b>
                <span>위쪽 검색창에 단어를 입력하면 일치하는 쪽을 찾아 표시합니다.</span>
              </li>
              <li>
                <b>쪽 링크</b>
                <span>주소의 ?p=7처럼 쪽 번호가 들어 있어 특정 쪽을 바로 공유할 수 있습니다.</span>
              </li>
              <li>
                <b>다른 PDF</b>
                <span>&quot;PDF 열기&quot;로 내 PDF를 열 수 있습니다. 파일은 서버로 올라가지 않습니다.</span>
              </li>
            </ul>
          </>
        )}

        <div className="intro-actions">
          {step > 0 && (
            <button className="btn ghost" onClick={() => setStep(step - 1)}>
              이전
            </button>
          )}
          <button className="btn primary" onClick={next} autoFocus>
            {step === STEPS - 1 ? "포트폴리오 보기" : "확인"}
          </button>
        </div>
        <div className="dots" aria-hidden>
          {Array.from({ length: STEPS }, (_, i) => (
            <i key={i} className={i === step ? "on" : ""} />
          ))}
        </div>
        </div>
      </section>
    </main>
  );
}
