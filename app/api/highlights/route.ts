import Anthropic from "@anthropic-ai/sdk";
import { GENERIC_SYSTEM_PROMPT } from "@/lib/chatConfig";
import {
  checkUploadedPdf,
  clientIp,
  fail,
  makeClient,
  openStream,
  pdfDocumentBlock,
  rateLimited,
  sameOrigin,
} from "@/lib/serverShared";

export const runtime = "nodejs";
export const maxDuration = 60;

type Card = { id: string; title: string; summary: string; page: number; cited: string };

const INSTRUCTION =
  "이 문서에서 독자가 꼭 알아야 할 핵심 내용을 6~8개 고르세요. 각각 한 문장(60자 이내)으로 쓰고, 문장마다 문서에서 근거를 인용하세요. 번호나 글머리 기호, 서론 없이 문장만 줄바꿈으로 구분하세요.";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, "허용되지 않은 요청입니다.");
  const client = makeClient();
  if (!client) return fail(503, "AI 기능이 아직 설정되지 않았습니다.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "요청을 읽을 수 없습니다.");
  }
  const pdf = (body as { pdf?: unknown }).pdf;
  const problem = checkUploadedPdf(pdf);
  if (problem) return fail(400, problem);
  if (rateLimited("upload", clientIp(req))) return fail(429, "요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요.");

  // 챗봇과 같은 시스템 문구와 문서 블록을 쓰므로 같은 문서의 캐시를 함께 사용한다.
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: [pdfDocumentBlock(pdf as string, "사용자가 올린 문서"), { type: "text", text: INSTRUCTION }] },
  ];
  const { model, stream } = openStream(client, { system: GENERIC_SYSTEM_PROMPT, messages, maxTokens: 900 });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg: any = await (stream as unknown as { finalMessage(): Promise<unknown> }).finalMessage();
    if (msg.stop_reason === "refusal") return fail(422, "이 문서는 AI가 처리할 수 없습니다.");
    console.log("highlights usage", model, JSON.stringify(msg.usage));

    const cards: Card[] = [];
    for (const block of msg.content ?? []) {
      if (block.type !== "text" || !Array.isArray(block.citations)) continue;
      const c = block.citations.find((x: { type: string }) => x.type === "page_location");
      const title = oneLine(String(block.text ?? "")).replace(/^[-•*\d.)\s]+/, "");
      if (!c || title.length < 4) continue;
      const cited = String(c.cited_text ?? "");
      const summary = oneLine(cited);
      cards.push({
        id: `ai-${cards.length}`,
        title: title.slice(0, 80),
        summary: summary.length > 140 ? summary.slice(0, 140) + "…" : summary,
        page: c.start_page_number,
        cited,
      });
      if (cards.length >= 8) break;
    }
    if (cards.length === 0) return fail(422, "이 문서에서 핵심을 찾지 못했습니다.");
    return new Response(JSON.stringify({ model, cards }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    console.error("highlights error", status, (e as Error)?.message);
    return fail(status === 429 ? 429 : 502, "핵심을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}
