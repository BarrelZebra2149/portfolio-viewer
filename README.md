# CODESEEKER 포트폴리오 뷰어

백엔드 개발자 이은총의 포트폴리오(한국어·영어)를 읽기 위한 **자체 제작 PDF 뷰어**입니다.
열자마자 한국어 포트폴리오 PDF가 열리고 위쪽 KO·EN 버튼으로 영어 포트폴리오로 바꿀 수 있고, 프로젝트별 이동·검색·쪽 링크(`?p=7`)·핵심 보기를 제공합니다.
다른 PDF 파일도 "PDF 열기"로 같은 화면에서 볼 수 있습니다(파일은 서버로 올라가지 않습니다).

- 프레임워크: Next.js (App Router) + TypeScript
- PDF 렌더링 엔진: PDF.js (react-pdf 경유). 화면, 탐색, 검색, 핵심 보기는 직접 구현했습니다.
- 글꼴: Freesentation (OFL)

## 환경변수 (AI 기능용 API 키)

```bash
cp .env.example .env.local   # 이미 .env.local이 있으면 건너뜁니다
```

`.env.local`의 `ANTHROPIC_API_KEY=` 뒤에 새 키를 붙여 넣고 개발 서버를 다시 시작합니다. 파일은 git에 올라가지 않습니다. Vercel에서는 Project Settings > Environment Variables에 같은 이름으로 넣고 다시 배포하세요. 키가 없어도 PDF 보기, 검색, 핵심 보기는 동작하고 질문하기·AI 목차만 멈춥니다.

## 실행

```bash
npm install
npm run dev   # http://localhost:3000
```

## 구조

- `components/PdfViewer.tsx` 뷰어(쪽 이동, 검색, 앞뒤 쪽 미리 그리기)
- `components/HighlightPanel.tsx` 핵심 보기(프로젝트별 카드, 읽음 표시)
- `lib/highlights.json` 핵심 카드와 근거 문장(PDF 원문 그대로)
- `public/portfolio_ko.pdf`, `public/portfolio_en.pdf` 기본으로 열리는 포트폴리오(한국어·영어). 질문하기용 사본은 `data/`에 같은 이름으로 둡니다.
- 포트폴리오를 바꿀 때는 위 4개 파일을 교체하고, `lib/portfolio.ts`의 쪽 구성과 `lib/highlights.json`의 핵심 카드(쪽 번호·근거 문장)를 함께 고칩니다.
