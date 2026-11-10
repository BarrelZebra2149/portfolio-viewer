// 미리 준비한 예상 질문 답변. AI 호출이 불가능할 때(키 없음, 크레딧·인증 문제 등) 방문자에게 대신 보여 준다.
// 답변과 근거 문장은 포트폴리오 PDF(한국어·영어)에 적힌 내용만 쓴다. 내용은 prepared.json에 있다.
import data from "./prepared.json";
import type { Lang } from "./portfolio";

type Cite = { page: number; text: string };
type Answer = { text: string; cites: Cite[] };
type Entry = { id: string; keywords: string[]; ko: Answer; en: Answer };

const ENTRIES = data as Entry[];

export const PREPARED_MODEL: Record<Lang, string> = { ko: "준비된 답변", en: "prepared answers" };

const INTRO: Record<Lang, string> = {
  ko: "예상 질문에 대한 답변을 미리 준비해 두었습니다.\n\n",
  en: "I have prepared answers to the questions I expect.\n\n",
};

const NO_MATCH: Record<Lang, string> = {
  ko: "이 질문에 대한 답은 아직 준비하지 못했습니다. 대신 아래 주제는 답변을 준비해 두었습니다. ARGUS, Server Manager, EcoReport, AEye, DRAWMIND, NYPC, TalkCompass, MUSEMATE, GridPuzzle, Google Study Jam, 기술 스택, 가장 큰 성과, 자기소개 중 하나를 넣어 질문해 주세요.",
  en: "I have not prepared an answer for this question. I have answers ready for these topics: ARGUS, Server Manager, EcoReport, AEye, DRAWMIND, NYPC, TalkCompass, MUSEMATE, GridPuzzle, Google Study Jam, tech stack, biggest achievement, and a short introduction. Please ask about one of them.",
};

// 질문에 들어 있는 키워드가 가장 많이 맞는 항목을 고른다. 맞는 것이 없으면 null.
export function findPrepared(question: string, lang: Lang): { text: string; cites: Cite[] } {
  const q = question.toLowerCase();
  let best: Entry | null = null;
  let bestScore = 0;
  for (const e of ENTRIES) {
    let score = 0;
    for (const k of e.keywords) if (q.includes(k.toLowerCase())) score += k.length >= 4 ? 2 : 1;
    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }
  if (!best) return { text: NO_MATCH[lang], cites: [] };
  const a = best[lang];
  return { text: INTRO[lang] + a.text, cites: a.cites };
}

// AI 호출이 실패했을 때 준비된 답변으로 대신할 만한 오류인지 판단한다.
// 키가 없거나(503), 인증·결제·크레딧 문제(400 credit balance, 401, 402, 403)일 때만 대신 답한다.
export function shouldUsePrepared(status: number | undefined, message: string | undefined): boolean {
  if (status === 401 || status === 402 || status === 403) return true;
  if (status === 400 && /credit|billing|balance|quota|usage limit/i.test(message ?? "")) return true;
  return false;
}
