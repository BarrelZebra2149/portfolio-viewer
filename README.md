# CODESEEKER 포트폴리오 뷰어

백엔드 개발자 이은총의 포트폴리오를 읽기 위한 **자체 제작 PDF 뷰어**입니다.
열자마자 포트폴리오 PDF가 열리고, 프로젝트별 이동·검색·쪽 링크(`?p=7`)·핵심 보기를 제공합니다.
다른 PDF 파일도 "PDF 열기"로 같은 화면에서 볼 수 있습니다(파일은 서버로 올라가지 않습니다).

- 프레임워크: Next.js (App Router) + TypeScript
- PDF 렌더링 엔진: PDF.js (react-pdf 경유). 화면, 탐색, 검색, 핵심 보기는 직접 구현했습니다.
- 글꼴: Freesentation (OFL)

## 실행

```bash
npm install
npm run dev   # http://localhost:3000
```

## 구조

- `components/PdfViewer.tsx` 뷰어(쪽 이동, 검색, 앞뒤 쪽 미리 그리기)
- `components/HighlightPanel.tsx` 핵심 보기(프로젝트별 카드, 읽음 표시)
- `lib/highlights.json` 핵심 카드와 근거 문장(PDF 원문 그대로)
- `public/portfolio.pdf` 기본으로 열리는 포트폴리오
