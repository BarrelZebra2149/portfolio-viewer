"use client";

import { useEffect, useState } from "react";
import data from "@/lib/highlights.json";

export type Card = { id: string; title: string; summary: string; page: number; cited: string };
export type Group = { id: string; title: string; cards: Card[] };

const DEFAULT_GROUPS = data.groups as Group[];

// 올린 문서는 브라우저 저장소를 쓰지 않고, 파일을 열어 둔 동안만 메모리에 읽음 표시를 기억한다.
const MEMORY = new Map<string, { read: string[]; last: string | null }>();
const READ_KEY = "cs-read-cards";
const LAST_KEY = "cs-last-group";

function loadRead(): string[] {
  try {
    const raw = localStorage.getItem(READ_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function loadLast(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export default function HighlightPanel({
  onPick,
  onClose,
  groups,
  note,
  memoryKey,
}: {
  onPick: (card: Card) => void;
  onClose: () => void;
  // 직접 올린 문서에서 AI가 만든 핵심을 보여 줄 때만 넘긴다. 이 경우 읽음 기록은 저장하지 않는다.
  groups?: Group[];
  note?: string;
  memoryKey?: string;
}) {
  const GROUPS = groups ?? DEFAULT_GROUPS;
  const persist = !groups;
  const [read, setRead] = useState<string[]>([]);
  const [last, setLast] = useState<string | null>(null);
  const [active, setActive] = useState(GROUPS[0].id);

  useEffect(() => {
    if (!persist) {
      const m = memoryKey ? MEMORY.get(memoryKey) : undefined;
      if (m) {
        setRead(m.read);
        setLast(m.last);
        if (m.last && GROUPS.some((g) => g.id === m.last)) setActive(m.last);
      }
      return;
    }
    const r = loadRead();
    const l = loadLast();
    setRead(r);
    setLast(l);
    if (l && GROUPS.some((g) => g.id === l)) setActive(l);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const group = GROUPS.find((g) => g.id === active) ?? GROUPS[0];
  const countRead = (g: Group) => g.cards.filter((c) => read.includes(c.id)).length;

  function pick(card: Card) {
    const next = read.includes(card.id) ? read : [...read, card.id];
    setRead(next);
    setLast(group.id);
    if (!persist) {
      if (memoryKey) MEMORY.set(memoryKey, { read: next, last: group.id });
      onPick(card);
      return;
    }
    try {
      localStorage.setItem(READ_KEY, JSON.stringify(next));
      localStorage.setItem(LAST_KEY, group.id);
    } catch {
      /* 저장소를 못 써도 동작한다 */
    }
    onPick(card);
  }

  return (
    <section className="hl" role="dialog" aria-label="핵심 보기">
      <header className="hl-head">
        <div>
          <h2>핵심 보기</h2>
          <p>{note ?? "프로젝트별 핵심을 고르면 해당 쪽으로 이동해 근거 문장을 표시합니다."}</p>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </header>

      <div className="hl-body">
        <ul className="hl-groups">
          {GROUPS.map((g) => {
            const n = countRead(g);
            const done = n === g.cards.length;
            return (
              <li key={g.id}>
                <button className={`hl-group${g.id === active ? " on" : ""}`} onClick={() => setActive(g.id)}>
                  <span className="hl-gtitle">{g.title}</span>
                  <span className="hl-gmeta">
                    {done ? <b className="badge done">확인 완료</b> : <>읽은 핵심 {n}/{g.cards.length}</>}
                    {g.id === last && !done && <b className="badge">마지막으로 본 곳</b>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="hl-cards">
          {group.cards.map((c) => {
            const isRead = read.includes(c.id);
            return (
              <button key={c.id} className={`hl-card${isRead ? " read" : ""}`} onClick={() => pick(c)}>
                <span className="hl-ctop">
                  <span className="hl-page">{c.page}쪽</span>
                  {isRead && <span className="hl-check" aria-label="읽음">✓ 읽음</span>}
                </span>
                <strong style={{ fontSize: c.title.length > 44 ? 14.5 : c.title.length > 28 ? 15.5 : 17 }}>{c.title}</strong>
                <span className="hl-sum">{c.summary}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
