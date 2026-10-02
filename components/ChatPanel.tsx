"use client";

import { useEffect, useRef, useState } from "react";

type Cite = { page: number; text: string };
type Part = { text: string; cites: Cite[] };
type Msg = { role: "user"; text: string } | { role: "assistant"; parts: Part[]; error?: string; pending?: boolean };

const SUGGESTIONS = [
  "ARGUS에서 무엇을 맡았나요?",
  "가장 큰 성과는 무엇인가요?",
  "서버 관리에서 어떤 문제를 해결했나요?",
];
const COUNT_KEY = "cs-chat-count";
const MAX_QUESTIONS = 20;
const MAX_CHARS = 400;

function loadCount(): number {
  try {
    return Number(localStorage.getItem(COUNT_KEY)) || 0;
  } catch {
    return 0;
  }
}

export default function ChatPanel({
  onCite,
  onClose,
}: {
  onCite: (page: number, text: string) => void;
  onClose: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const [model, setModel] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setCount(loadCount());
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs]);
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const left = Math.max(0, MAX_QUESTIONS - count);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    if (left <= 0) return;
    setInput("");
    setBusy(true);
    const next = count + 1;
    setCount(next);
    try {
      localStorage.setItem(COUNT_KEY, String(next));
    } catch {
      /* 저장소를 못 써도 동작한다 */
    }

    // 서버로 보낼 대화: 지금까지의 질문과 답변 글자만 보낸다(근거 정보 제외).
    const history = msgs
      .filter((m) => m.role === "user" || !m.error)
      .map((m) => (m.role === "user" ? { role: "user" as const, content: m.text } : { role: "assistant" as const, content: m.parts.map((p) => p.text).join("") }))
      .filter((m) => m.content.trim());
    const payload = [...history, { role: "user" as const, content: q }].slice(-10);
    // 대화는 항상 질문으로 시작해야 한다.
    while (payload.length && payload[0].role !== "user") payload.shift();

    setMsgs((m) => [...m, { role: "user", text: q }, { role: "assistant", parts: [], pending: true }]);

    const patchLast = (fn: (a: Extract<Msg, { role: "assistant" }>) => Extract<Msg, { role: "assistant" }>) =>
      setMsgs((all) => {
        const copy = all.slice();
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") copy[copy.length - 1] = fn(last);
        return copy;
      });

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: payload }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        let message = "답변을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.";
        try {
          message = (await res.json()).error ?? message;
        } catch {
          /* 본문이 JSON이 아니면 기본 문구 */
        }
        patchLast((a) => ({ ...a, pending: false, error: message }));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: { t: string; v?: string; page?: number; text?: string };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.t === "model" && ev.v) setModel(ev.v);
          else if (ev.t === "start") patchLast((a) => ({ ...a, parts: [...a.parts, { text: "", cites: [] }] }));
          else if (ev.t === "text")
            patchLast((a) => {
              const parts = a.parts.length ? a.parts.slice() : [{ text: "", cites: [] }];
              const i = parts.length - 1;
              parts[i] = { ...parts[i], text: parts[i].text + (ev.v ?? "") };
              return { ...a, parts };
            });
          else if (ev.t === "cite" && ev.page)
            patchLast((a) => {
              const parts = a.parts.length ? a.parts.slice() : [{ text: "", cites: [] }];
              const i = parts.length - 1;
              const cite = { page: ev.page as number, text: ev.text ?? "" };
              const dup = parts[i].cites.some((c) => c.page === cite.page && c.text === cite.text);
              parts[i] = { ...parts[i], cites: dup ? parts[i].cites : [...parts[i].cites, cite] };
              return { ...a, parts };
            });
          else if (ev.t === "err") patchLast((a) => ({ ...a, error: ev.v }));
        }
      }
      patchLast((a) => ({ ...a, pending: false }));
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        patchLast((a) => ({ ...a, pending: false, error: "네트워크 오류로 답변을 가져오지 못했습니다." }));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="chat" aria-label="질문하기">
      <header className="chat-head">
        <div>
          <h2>질문하기</h2>
          <p>포트폴리오 내용에 대해 물어보면 근거 쪽과 함께 답합니다.</p>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </header>

      <div className="chat-body">
        {msgs.length === 0 && (
          <div className="chat-empty">
            <p>예를 들어 이렇게 물어볼 수 있습니다.</p>
            <div className="chat-sugs">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chat-sug" onClick={() => ask(s)} disabled={busy || left <= 0}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="msg user">
              {m.text}
            </div>
          ) : (
            <div key={i} className="msg bot">
              {m.parts.map((p, j) => (
                <div key={j} className="part">
                  <span>{p.text}</span>
                  {p.cites.length > 0 && (
                    <span className="cites">
                      {p.cites.map((c, k) => (
                        <button key={k} className="cite-chip" onClick={() => onCite(c.page, c.text)} title={c.text}>
                          근거 {c.page}쪽
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              ))}
              {m.pending && m.parts.length === 0 && (
                <span className="typing">
                  <span className="spin" aria-hidden /> 답변을 만드는 중…
                </span>
              )}
              {m.error && <div className="chat-err">{m.error}</div>}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
          placeholder={left > 0 ? "질문을 입력하세요" : "질문 횟수를 모두 사용했습니다"}
          aria-label="질문 입력"
          disabled={busy || left <= 0}
        />
        <button className="btn primary" type="submit" disabled={busy || !input.trim() || left <= 0}>
          보내기
        </button>
      </form>
      <p className="chat-note">
        답변은 AI가 이 포트폴리오 PDF만 근거로 만듭니다. 질문 내용은 Anthropic API로 전송됩니다. 남은 질문 {left}회{model ? ` · 모델 ${model}` : ""}
      </p>
    </aside>
  );
}
