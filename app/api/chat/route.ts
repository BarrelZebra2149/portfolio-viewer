import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { LIMITS, SYSTEM_PROMPT, chatModel, supportsFallbackAndEffort } from "@/lib/chatConfig";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMsg = { role: "user" | "assistant"; content: string };

// 환경변수로 들어온 기본 주소(ANTHROPIC_BASE_URL)에 영향받지 않도록 공식 주소를 직접 지정한다.
function makeClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  // CHAT_API_BASE는 로컬에서 가짜 서버로 화면을 시험할 때만 쓴다(실제 배포에서는 설정하지 않는다).
  const baseURL = process.env.CHAT_API_BASE || "https://api.anthropic.com";
  return new Anthropic({ apiKey, baseURL });
}

let pdfBase64: string | null = null;
function portfolioPdf(): string {
  if (!pdfBase64) {
    pdfBase64 = fs.readFileSync(path.join(process.cwd(), "data", "portfolio.pdf")).toString("base64");
  }
  return pdfBase64;
}

// 서버리스 환경이라 완전하지 않은 최소한의 속도 제한(같은 인스턴스 안에서만 유지된다).
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 86_400_000);
  const lastMinute = list.filter((t) => now - t < 60_000).length;
  if (lastMinute >= LIMITS.perMinute || list.length >= LIMITS.perDay) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
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

const fail = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, "허용되지 않은 요청입니다.");
  const client = makeClient();
  if (!client) return fail(503, "챗봇이 아직 설정되지 않았습니다.");

  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (rateLimited(ip)) return fail(429, "질문이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "요청을 읽을 수 없습니다.");
  }
  const msgs = validate(body);
  if (typeof msgs === "string") return fail(400, msgs);

  // 첫 질문에 문서를 붙인다. 같은 접두부가 반복되므로 캐시를 걸어 비용을 줄인다.
  const messages: Anthropic.MessageParam[] = msgs.map((m, i) =>
    i === 0
      ? {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: portfolioPdf() },
              title: "이은총 포트폴리오",
              citations: { enabled: true },
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: m.content },
          ],
        }
      : { role: m.role, content: m.content },
  );

  const model = chatModel();
  const base = { model, max_tokens: LIMITS.maxOutputTokens, system: SYSTEM_PROMPT, messages };
  const stream = supportsFallbackAndEffort(model)
    ? client.beta.messages.stream({
        ...base,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      })
    : client.messages.stream(base);

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
              send({ t: "usage", cacheRead: ev.usage.cache_read_input_tokens, input: ev.usage.input_tokens });
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
