import Anthropic from "@anthropic-ai/sdk";
import { chatModel, supportsFallbackAndEffort, LIMITS } from "@/lib/chatConfig";

// 환경변수로 들어온 기본 주소(ANTHROPIC_BASE_URL)에 영향받지 않도록 공식 주소를 직접 지정한다.
export function makeClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  // CHAT_API_BASE는 로컬에서 가짜 서버로 화면을 시험할 때만 쓴다(실제 배포에서는 설정하지 않는다).
  const baseURL = process.env.CHAT_API_BASE || "https://api.anthropic.com";
  return new Anthropic({ apiKey, baseURL });
}

export const fail = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });

export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// 서버리스 환경이라 완전하지 않은 최소한의 속도 제한(같은 인스턴스 안에서만 유지된다).
const buckets = new Map<string, Map<string, number[]>>();
export function rateLimited(kind: "chat" | "upload", ip: string): boolean {
  const cfg = kind === "chat" ? { m: LIMITS.perMinute, d: LIMITS.perDay } : { m: LIMITS.uploadPerMinute, d: LIMITS.uploadPerDay };
  let hits = buckets.get(kind);
  if (!hits) buckets.set(kind, (hits = new Map()));
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 86_400_000);
  const lastMinute = list.filter((t) => now - t < 60_000).length;
  if (lastMinute >= cfg.m || list.length >= cfg.d) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
}

// 사용자가 올린 PDF(base64)가 올바른지 확인한다. 문제가 있으면 오류 문구를 돌려준다.
export function checkUploadedPdf(b64: unknown): string | null {
  if (typeof b64 !== "string" || !b64) return "PDF 데이터가 없습니다.";
  if (b64.length > LIMITS.uploadMaxBase64) return "PDF가 너무 큽니다. 3MB 이하 파일만 AI 기능을 쓸 수 있습니다.";
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return "PDF 데이터가 올바르지 않습니다.";
  const head = Buffer.from(b64.slice(0, 16), "base64").toString("latin1");
  if (!head.startsWith("%PDF")) return "PDF 파일이 아닙니다.";
  return null;
}

type Params = { system: string; messages: Anthropic.MessageParam[]; maxTokens: number };

// 모델에 맞는 옵션으로 스트리밍 요청을 만든다. Opus 5.5 / Sonnet 5.5는 서버 쪽 대체 모델(fallbacks)과 effort를 함께 보낸다.
export function openStream(client: Anthropic, { system, messages, maxTokens }: Params) {
  const model = chatModel();
  const base = { model, max_tokens: maxTokens, system, messages };
  const stream = supportsFallbackAndEffort(model)
    ? client.beta.messages.stream({
        ...base,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      })
    : client.messages.stream(base);
  return { model, stream };
}

// PDF에서 뽑은 글자에는 제어 문자, 짝 없는 서로게이트, 기호 글꼴의 사설 영역 문자가 섞일 수 있다.
// 이런 글자가 있으면 API가 요청 본문을 JSON으로 읽지 못해 거절하므로 보내기 전에 걸러 낸다.
export function cleanText(s: string): string {
  return s
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F-￾￿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function pdfDocumentBlock(data: string, title: string): Anthropic.DocumentBlockParam {
  return {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data },
    title,
    citations: { enabled: true },
    // 같은 문서를 반복해서 보내므로 캐시를 걸어 비용을 줄인다.
    cache_control: { type: "ephemeral" },
  };
}
