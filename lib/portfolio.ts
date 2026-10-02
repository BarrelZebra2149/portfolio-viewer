// 기본으로 열리는 포트폴리오 PDF와 프로젝트별 쪽 구성 (portfolio_NaverWebtoon.pdf, 19쪽 기준)
export const DEFAULT_PDF = "/portfolio.pdf";

export type ProjectRange = { id: string; title: string; from: number; to: number };

export const PROJECTS: ProjectRange[] = [
  { id: "intro", title: "소개 · 기술 스택", from: 1, to: 4 },
  { id: "argus", title: "ARGUS", from: 5, to: 7 },
  { id: "ecoreport", title: "EcoReport", from: 8, to: 10 },
  { id: "server", title: "Server Manager", from: 11, to: 14 },
  { id: "drawmind", title: "DRAWMIND", from: 15, to: 17 },
  { id: "aeye", title: "AEye", from: 18, to: 19 },
];

export function projectOfPage(page: number): ProjectRange | undefined {
  return PROJECTS.find((p) => page >= p.from && page <= p.to);
}
