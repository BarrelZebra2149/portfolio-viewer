// 기본으로 열리는 포트폴리오 PDF(한국어·영어, 각 35쪽)와 프로젝트별 쪽 구성
export type Lang = "ko" | "en";
export const DEFAULT_LANG: Lang = "ko";

export const DOCS: Record<Lang, { pdf: string; download: string }> = {
  ko: { pdf: "/portfolio_ko.pdf", download: "이은총_포트폴리오.pdf" },
  en: { pdf: "/portfolio_en.pdf", download: "Eunchong_Lee_Portfolio.pdf" },
};
export const DEFAULT_PDF = DOCS[DEFAULT_LANG].pdf;

export function isDocPdf(source: unknown): boolean {
  return source === DOCS.ko.pdf || source === DOCS.en.pdf;
}

export type ProjectRange = { id: string; title: string; from: number; to: number };

// 한국어·영어 포트폴리오는 쪽 구성이 같다(35쪽).
const RANGES = (t: Record<string, string>): ProjectRange[] => [
  { id: "intro", title: t.intro, from: 1, to: 5 },
  { id: "studyjam", title: "Google Study Jam", from: 6, to: 9 },
  { id: "argus", title: "ARGUS", from: 10, to: 14 },
  { id: "server", title: "Server Manager", from: 15, to: 18 },
  { id: "drawmind", title: "DRAWMIND", from: 19, to: 21 },
  { id: "aeye", title: "AEye", from: 22, to: 23 },
  { id: "ecoreport", title: "EcoReport", from: 24, to: 26 },
  { id: "nypc", title: "NYPC", from: 27, to: 29 },
  { id: "talk", title: "TalkCompass", from: 30, to: 31 },
  { id: "muse", title: "MUSEMATE", from: 32, to: 33 },
  { id: "grid", title: "GridPuzzle", from: 34, to: 35 },
];
export const PROJECTS: Record<Lang, ProjectRange[]> = {
  ko: RANGES({ intro: "소개 · 기술 스택" }),
  en: RANGES({ intro: "Intro · Tech Stack" }),
};

export function projectOfPage(lang: Lang, page: number): ProjectRange | undefined {
  return PROJECTS[lang].find((p) => page >= p.from && page <= p.to);
}
