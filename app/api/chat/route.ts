import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { GENERIC_SYSTEM_PROMPT, LIMITS, SYSTEM_PROMPT } from "@/lib/chatConfig";
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

type ChatMsg = { role: "user" | "assistant"; content: string };

let portfolioB64: string | null = null;
function portfolioPdf(): string {
  if (!portfolioB64) {
    portfolioB64 = fs.readFileSync(path.join(process.cwd(), "data", "portfolio.pdf")).toString("base64");
  }
  return portfolioB64;
}

function validate(body: unknown): ChatMsg[] | string {
  const bad = "대화 형식이 올바르지 않습니다.";
  const msgs = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0 || msgs.length > LIMITS.maxMessages) return bad;
  let total = 0;
  const out: ChatMsg[] = [];
  for (const m of msgs) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return bad;
    const content = m.content.trim();
    if (!content) return "빈 메시지가 있습니다.";
    if (m.role === "user" && content.length > LIMITS.maxQuestionChars) {
      return `질문은 ${LIMITS.maxQuestionChars}자 이내로 입력해 주세요.`;
    }
    total += content.length;
    out.push({ role: m.role, content });
  }
  if (out[0].role !== "user" || out[out.length - 1].role !== "user") return bad;
  if (total > LIMITS.maxHistoryChars) return "대화가 너무 깁니다. 새로 시작해 주세요.";
  return out;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, "허용되지 않은 요청입니다.");
  const client = makeClient();
  if (!client) return fail(503, "챗봇이 아직 설정되지 않았습니다.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "요청을 읽을 수 없습니다.");
  }
  const msgs = validate(body);
  if (typeof msgs === "string") return fail(400, msgs);

  // pdf가 함께 오면 사용자가 올린 문서, 없으면 기본 포트폴리오를 근거로 한다.
  const uploaded = (body as { pdf?: unknown }).pdf;
  let doc: string;
  let system: string;
  if (uploaded !== undefined) {
    const problem = checkUploadedPdf(uploaded);
    if (problem) return fail(400, problem);
    if (rateLimited("upload", clientIp(req))) return fail(429, "올린 문서에 대한 질문이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요.");
    doc = uploaded as string;
    system = GENERIC_SYSTEM_PROMPT;
  } else {
    if (rateLimited("chat", clientIp(req))) return fail(429, "질문이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요.");
    doc = portfolioPdf();
    system = SYSTEM_PROMPT;
  }

  // 첫 질문에 문서를 붙인다.
  const messages: Anthropic.MessageParam[] = msgs.map((m, i) =>
    i === 0
      ? {
          role: "user",
          content: [pdfDocumentBlock(doc, uploaded !== undefined ? "사용자가 올린 문서" : "이은총 포트폴리오"), { type: "text", text: m.content }],
        }
      : { role: m.role, content: m.content },
  );

  const { model, stream } = openStream(client, { system, messages, maxTokens: LIMITS.maxOutputTokens });

  const enc = new TextEncoder();
  const out = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        send({ t: "model", v: model });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const ev of stream as AsyncIterable<any>) {
          if (ev.type === "content_block_start" && ev.content_block?.type === "text") {
            send({ t: "start" });
          } else if (ev.type === "content_block_delta") {
            const d = ev.delta;
            if (d.type === "text_delta") {
              send({ t: "text", v: d.text });
            } else if (d.type === "citations_delta" && d.citation?.type === "page_location") {
              send({ t: "cite", page: d.citation.start_page_number, text: d.citation.cited_text });
            }
          } else if (ev.type === "message_delta") {
            if (ev.delta?.stop_reason === "refusal") send({ t: "err", v: "이 질문에는 답변할 수 없습니다." });
            if (ev.usage) {
              const u = {
                input: ev.usage.input_tokens,
                cacheCreation: ev.usage.cache_creation_input_tokens,
                cacheRead: ev.usage.cache_read_input_tokens,
                output: ev.usage.output_tokens,
              };
              console.log("chat usage", model, uploaded !== undefined ? "upload" : "portfolio", JSON.stringify(u));
              send({ t: "usage", ...u });
            }
          }
        }
        send({ t: "done" });
      } catch (e) {
        const status = (e as { status?: number })?.status;
        console.error("chat error", status, (e as Error)?.message);
        send({
          t: "err",
          v: status === 429 ? "요청이 많아 잠시 후 다시 시도해 주세요." : "답변을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
        });
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.controller.abort();
    },
  });

  return new Response(out, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
