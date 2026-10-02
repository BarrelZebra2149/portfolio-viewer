"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DEFAULT_PDF, PROJECTS, projectOfPage } from "@/lib/portfolio";
import HighlightPanel, { type Card } from "./HighlightPanel";
import ChatPanel from "./ChatPanel";
import { LIMITS } from "@/lib/chatConfig";

// PDF.js를 쓰는 부분만 브라우저에서 따로 불러온다. 위쪽 도구 줄과 목록은 바로 보인다.
const StageDocument = dynamic(() => import("./pdf/StageDocument"), { ssr: false, loading: () => null });
const ThumbRail = dynamic(() => import("./pdf/ThumbRail"), { ssr: false, loading: () => null });

const MAX_RADIUS = 14;

type Source = string | File;
type OutlineEntry = { title: string; page: number | null };
type Section = { title: string; from: number; to: number };

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 근거 문장(cited)을 쪽의 글자 층에서 찾아 해당 글줄을 칠한다. 공백 차이는 무시한다.
function applyCite(root: Element, cited: string): boolean {
  root.querySelectorAll(".cite").forEach((el) => el.classList.remove("cite"));
  const spans = Array.from(root.querySelectorAll("span")).filter((s) => !s.querySelector("span"));
  // 글머리 기호처럼 글꼴 때문에 달라지는 문자를 빼고 비교한다.
  const clean = (s: string) => s.replace(/[\s•▪●➢➤→➔]/g, "");
  let full = "";
  const owner: number[] = [];
  spans.forEach((s, i) => {
    for (const ch of s.textContent ?? "") {
      const c = clean(ch);
      if (c) {
        full += c;
        owner.push(i);
      }
    }
  });
  const mark = (needle: string): boolean => {
    const at = needle ? full.indexOf(needle) : -1;
    if (at < 0) return false;
    for (let i = owner[at]; i <= owner[at + needle.length - 1]; i++) spans[i].classList.add("cite");
    return true;
  };
  // 먼저 통째로, 안 되면 줄 단위로 찾는다.
  if (mark(clean(cited))) return true;
  let any = false;
  for (const line of cited.split(/\r?\n/)) {
    const n = clean(line);
    if (n.length >= 6 && mark(n)) any = true;
  }
  return any;
}

async function fileToBase64(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(bin);
}

// 쪽마다 앞부분 글자만 뽑는다(목차 만들기용). 파일 전체가 아니라 글자 일부만 서버로 보낸다.
async function pageSnippets(pdf: PDFDocumentProxy, onProgress: (i: number, total: number) => void) {
  const out: { n: number; text: string }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    const text = content.items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    out.push({ n: i, text });
    if (i % 5 === 0 || i === pdf.numPages) onProgress(i, pdf.numPages);
  }
  return out;
}

// PDF 안 목차 항목을 "시작 쪽 ~ 다음 항목 전 쪽" 구간으로 바꾼다.
function outlineToSections(entries: OutlineEntry[], total: number): Section[] {
  const items = entries
    .filter((e): e is OutlineEntry & { page: number } => e.page !== null)
    .sort((a, b) => a.page - b.page)
    .filter((e, i, arr) => i === 0 || e.page !== arr[i - 1].page);
  return items.map((e, i) => ({ title: e.title, from: e.page, to: i + 1 < items.length ? items[i + 1].page - 1 : total }));
}

// 목차가 없는 긴 문서는 10쪽 단위로 묶어 보여 준다.
function chunkSections(total: number, size = 10): Section[] {
  const out: Section[] = [];
  for (let from = 1; from <= total; from += size) {
    const to = Math.min(total, from + size - 1);
    out.push({ title: `${from}–${to}쪽`, from, to });
  }
  return out;
}

// 글자가 있는 PDF인지(스캔본이 아닌지) 앞쪽 몇 쪽만 확인한다.
async function docHasText(pdf: PDFDocumentProxy): Promise<boolean> {
  let chars = 0;
  for (let i = 1; i <= Math.min(5, pdf.numPages); i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    chars += content.items.reduce((n, it) => n + ("str" in it ? it.str.length : 0), 0);
    if (chars >= 50) return true;
  }
  return false;
}

// 로딩 표시가 잠깐 켜졌다 꺼지며 깜빡이지 않게: 켜기 전에 잠시 기다리고, 한 번 켜면 최소 시간 유지한다.
function useHoldFlag(on: boolean, delay: number, hold: number): boolean {
  const [shown, setShown] = useState(on && delay === 0);
  const since = useRef(0);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    let id: number;
    if (on) {
      id = window.setTimeout(() => {
        since.current = Date.now();
        setShown(true);
      }, delay);
    } else if (shownRef.current) {
      const left = Math.max(0, hold - (Date.now() - since.current));
      id = window.setTimeout(() => setShown(false), left);
    }
    return () => window.clearTimeout(id);
  }, [on, delay, hold]);
  return on && delay === 0 ? true : shown;
}

function initialPage(): number {
  const p = Number(new URLSearchParams(window.location.search).get("p"));
  return Number.isInteger(p) && p > 0 ? p : 1;
}

export default function PdfViewer({ onShowIntro }: { onShowIntro: () => void }) {
  const [source, setSource] = useState<Source>(DEFAULT_PDF);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState<number>(() => initialPage());
  // 화면에 실제로 보이는 쪽. 새 쪽이 다 그려질 때까지 이전 쪽을 그대로 보여 준다.
  const [shown, setShown] = useState<number>(page);
  const [rendered, setRendered] = useState<ReadonlySet<number>>(() => new Set());
  // 백그라운드에서 미리 그려 둘 범위(현재 쪽 기준 앞뒤 쪽 수). 한가할 때 조금씩 넓힌다.
  const [radius, setRadius] = useState(1);
  const [aspect, setAspect] = useState(16 / 9);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [pageInput, setPageInput] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [hits, setHits] = useState<{ page: number; count: number }[]>([]);
  const [hitIdx, setHitIdx] = useState(0);
  const [searching, setSearching] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [hlOpen, setHlOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // 직접 올린 문서의 AI 기능: 동의한 뒤에만 파일 내용이 서버로 전송된다.
  const [aiPdf, setAiPdf] = useState<string | null>(null);
  const [aiCards, setAiCards] = useState<Card[] | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const [consent, setConsent] = useState<null | "hl" | "chat" | "outline">(null);
  const [consented, setConsented] = useState(false);
  const [sections, setSections] = useState<Section[] | null>(null);
  const [outlineBusy, setOutlineBusy] = useState("");
  const [cite, setCite] = useState<{ page: number; text: string } | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const isDefault = source === DEFAULT_PDF;

  // 쪽마다 고정된 콜백을 쓴다. 콜백이 매 렌더마다 바뀌면 react-pdf가 쪽을 다시 그린다.
  const handlers = useRef(new Map<number, () => void>());
  const renderHandler = (n: number) => {
    let h = handlers.current.get(n);
    if (!h) {
      h = () => setRendered((prev) => (prev.has(n) ? prev : new Set(prev).add(n)));
      handlers.current.set(n, h);
    }
    return h;
  };

  // 화면 크기에 맞춰 쪽 크기를 정한다 (가로·세로 모두 넘치지 않게).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStageSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const pageWidth = useMemo(() => {
    const padX = stageSize.w < 600 ? 16 : 40;
    const padY = stageSize.w < 600 ? 16 : 40;
    const maxW = Math.max(120, stageSize.w - padX);
    const maxH = Math.max(120, stageSize.h - padY);
    return Math.floor(Math.min(maxW, maxH * aspect));
  }, [stageSize, aspect]);

  // 보이는 쪽: 이미 그려진 쪽이면 바로 보여 주고, 아니면 이전 쪽을 그대로 둔다.
  const visibleN = rendered.has(page) ? page : shown;
  useEffect(() => {
    if (rendered.has(page)) setShown(page);
  }, [page, rendered]);
  const loadingNow = !loadError && (visibleN !== page || rendered.size === 0);
  const showLoading = useHoldFlag(loadingNow, rendered.size === 0 ? 0 : 150, 450);
  // 앞뒤 쪽을 화면 뒤에서 미리 그려 두면 넘길 때 기다리지 않는다.
  const layers = useMemo(() => {
    const s = new Set<number>([shown, page]);
    if (numPages) {
      for (let d = 1; d <= radius; d++) {
        if (page - d >= 1) s.add(page - d);
        if (page + d <= numPages) s.add(page + d);
      }
    }
    return [...s].filter((n) => n >= 1 && (!numPages || n <= numPages)).sort((x, y) => x - y);
  }, [shown, page, numPages, radius]);

  // 지금 범위의 쪽이 모두 그려지면 잠시 뒤 범위를 한 칸 넓힌다(최대 약 29쪽, 메모리 보호).
  useEffect(() => {
    if (!numPages || radius >= MAX_RADIUS) return;
    if (!layers.every((n) => rendered.has(n))) return;
    const id = window.setTimeout(() => setRadius((r) => Math.min(r + 1, MAX_RADIUS)), 200);
    return () => window.clearTimeout(id);
  }, [layers, rendered, radius, numPages]);

  // 핵심 카드를 눌러 이동하면 해당 쪽이 그려진 뒤 근거 문장을 칠한다.
  useEffect(() => {
    if (!cite) return;
    if (visibleN !== cite.page) return;
    let tries = 0;
    let id = 0;
    const attempt = () => {
      const root = document.querySelector(".sheetstack .sheet:not(.pending) .react-pdf__Page__textContent");
      if (root && root.querySelector("span") && applyCite(root, cite.text)) return;
      if (++tries < 30) id = window.setTimeout(attempt, 100);
    };
    attempt();
    return () => window.clearTimeout(id);
  }, [cite, visibleN, rendered]);
  useEffect(() => {
    if (cite && page !== cite.page) setCite(null);
  }, [page, cite]);

  const go = useCallback(
    (n: number) => {
      if (!numPages) return;
      setPage(Math.min(Math.max(1, Math.round(n)), numPages));
      setRailOpen(false);
    },
    [numPages],
  );

  // 쪽 번호를 주소(?p=)에 반영한다. 기본 포트폴리오에서만.
  useEffect(() => {
    if (!isDefault || !numPages) return;
    const url = new URL(window.location.href);
    url.searchParams.set("p", String(page));
    window.history.replaceState(null, "", url);
  }, [page, isDefault, numPages]);

  useEffect(() => setPageInput(String(page)), [page]);

  // 키보드와 좌우 밀기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(page + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(page - 1);
      else if (e.key === "Home") go(1);
      else if (e.key === "End") go(numPages);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, page, numPages]);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(page + (dx < 0 ? 1 : -1));
  }

  // 콜백이 매 렌더마다 바뀌면 react-pdf가 문서를 다시 불러온 것으로 처리하므로 고정해 둔다.
  const onDocLoaded = useCallback(async (pdf: PDFDocumentProxy) => {
    setDoc(pdf);
    setNumPages(pdf.numPages);
    setLoadError("");
    setPage((p) => Math.min(Math.max(1, p), pdf.numPages));
    setShown((p) => Math.min(Math.max(1, p), pdf.numPages));
    try {
      const first = await pdf.getPage(1);
      const v = first.getViewport({ scale: 1 });
      setAspect(v.width / v.height);
    } catch {
      /* 기본 비율 유지 */
    }
    // PDF 안 목차(outline)가 있으면 최상위 항목만 읽어 온다.
    try {
      const raw = await pdf.getOutline();
      const out: OutlineEntry[] = [];
      for (const item of raw ?? []) {
        let pg: number | null = null;
        try {
          const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
          if (Array.isArray(dest) && dest[0] && typeof dest[0] === "object") {
            pg = (await pdf.getPageIndex(dest[0])) + 1;
          }
        } catch {
          pg = null;
        }
        out.push({ title: item.title, page: pg });
      }
      setOutline(out);
    } catch {
      setOutline([]);
    }
  }, []);
  const onDocError = useCallback(
    () => setLoadError("PDF를 열 수 없습니다. 파일이 손상되었거나 암호가 걸려 있을 수 있습니다."),
    [],
  );

  function resetSearch() {
    setQuery("");
    setActiveQuery("");
    setHits([]);
    setHitIdx(0);
  }

  // 검색: 전체 쪽의 글자를 읽어 일치하는 쪽을 찾는다.
  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!doc || !q) {
      setActiveQuery("");
      setHits([]);
      return;
    }
    setSearching(true);
    const re = new RegExp(escapeRegExp(q), "gi");
    const found: { page: number; count: number }[] = [];
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const pg = await doc.getPage(i);
        const content = await pg.getTextContent();
        const text = content.items.map((it) => ("str" in it ? it.str : "")).join(" ");
        const count = (text.match(re) ?? []).length;
        if (count) found.push({ page: i, count });
      }
    } finally {
      setSearching(false);
    }
    setActiveQuery(q);
    setHits(found);
    setHitIdx(0);
    if (found.length) setPage(found[0].page);
  }

  function stepHit(delta: number) {
    if (!hits.length) return;
    const next = (hitIdx + delta + hits.length) % hits.length;
    setHitIdx(next);
    setPage(hits[next].page);
  }

  const textRenderer = useCallback(
    ({ str }: { str: string }) => {
      const safe = escapeHtml(str);
      if (!activeQuery) return safe;
      const re = new RegExp(`(${escapeRegExp(escapeHtml(activeQuery))})`, "gi");
      return safe.replace(re, "<mark>$1</mark>");
    },
    [activeQuery],
  );

  function citeFromChat(p: number, text: string) {
    setCite({ page: p, text });
    go(p);
  }

  function pickCard(card: Card) {
    setHlOpen(false);
    setCite({ page: card.page, text: card.cited });
    go(card.page);
  }

  function resetAi() {
    setAiPdf(null);
    setAiCards(null);
    setAiMsg("");
    setConsent(null);
    setConsented(false);
    setSections(null);
    setOutlineBusy("");
    setHlOpen(false);
    setChatOpen(false);
  }

  async function runAi(action: "hl" | "chat", b64: string) {
    if (action === "chat") {
      setChatOpen(true);
      return;
    }
    if (aiCards) {
      setHlOpen(true);
      return;
    }
    setAiBusy(true);
    setAiMsg("");
    try {
      const res = await fetch("/api/highlights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pdf: b64 }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "핵심을 만들지 못했습니다.");
      setAiCards(j.cards as Card[]);
      setHlOpen(true);
    } catch (e) {
      setAiMsg((e as Error).message || "핵심을 만들지 못했습니다.");
    } finally {
      setAiBusy(false);
    }
  }

  // 주제별 목차: 각 쪽의 앞부분 글자만 서버로 보내 AI가 주제 단위 구간으로 나눈다.
  async function runOutline() {
    if (!doc) return;
    if (numPages < 4 || numPages > 400) {
      setAiMsg("4~400쪽 문서만 목차를 만들 수 있습니다.");
      return;
    }
    setAiMsg("");
    setOutlineBusy("글자 읽는 중…");
    try {
      const pages = await pageSnippets(doc, (i, total) => setOutlineBusy(`글자 읽는 중 ${i}/${total}`));
      if (pages.reduce((n, p) => n + p.text.length, 0) < 40) {
        setAiMsg("이 PDF는 글자를 읽을 수 없어(스캔본 등) 목차를 만들 수 없습니다.");
        return;
      }
      setOutlineBusy("주제를 나누는 중…");
      const res = await fetch("/api/outline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pages }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "목차를 만들지 못했습니다.");
      setSections(j.sections as Section[]);
    } catch (e) {
      setAiMsg((e as Error).message || "목차를 만들지 못했습니다.");
    } finally {
      setOutlineBusy("");
    }
  }

  // 위쪽 버튼: 기본 포트폴리오는 바로 열고, 올린 문서는 동의를 받은 뒤 준비한다.
  function startAi(action: "hl" | "chat" | "outline") {
    if (isDefault) {
      if (action === "hl") setHlOpen(true);
      else if (action === "chat") setChatOpen((v) => !v);
      return;
    }
    setAiMsg("");
    if (!consented) {
      setConsent(action);
      return;
    }
    void proceed(action);
  }

  // 동의한 뒤 실제 기능을 실행한다.
  async function proceed(action: "hl" | "chat" | "outline") {
    if (action === "outline") {
      await runOutline();
      return;
    }
    if (aiPdf) {
      if (action === "chat" && chatOpen) setChatOpen(false);
      else await runAi(action, aiPdf);
      return;
    }
    if (!(source instanceof File) || !doc) return;
    if (source.size > 3 * 1024 * 1024) {
      setAiMsg("3MB 이하 PDF만 이 AI 기능을 쓸 수 있습니다. (주제별 목차는 큰 문서도 가능합니다.)");
      return;
    }
    if (numPages > LIMITS.uploadMaxPages) {
      setAiMsg(`${LIMITS.uploadMaxPages}쪽 이하 PDF만 이 AI 기능을 쓸 수 있습니다. (주제별 목차는 더 긴 문서도 가능합니다.)`);
      return;
    }
    setAiBusy(true);
    try {
      if (!(await docHasText(doc))) {
        setAiMsg("이 PDF는 글자를 읽을 수 없어(스캔본 등) AI 기능을 쓸 수 없습니다.");
        return;
      }
      const b64 = await fileToBase64(source);
      setAiPdf(b64);
      setAiBusy(false);
      await runAi(action, b64);
    } catch {
      setAiMsg("파일을 준비하지 못했습니다.");
    } finally {
      setAiBusy(false);
    }
  }

  async function confirmConsent() {
    const action = consent;
    setConsent(null);
    if (!action) return;
    setConsented(true);
    await proceed(action);
  }

  function openFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      setLoadError("PDF 파일만 열 수 있습니다.");
      return;
    }
    setDoc(null);
    setNumPages(0);
    setOutline([]);
    resetSearch();
    resetAi();
    setPage(1);
    setShown(1);
    setRendered(new Set());
    setRadius(1);
    handlers.current.clear();
    setSource(f);
  }

  function backToDefault() {
    setDoc(null);
    setNumPages(0);
    setOutline([]);
    resetSearch();
    resetAi();
    setPage(1);
    setShown(1);
    setRendered(new Set());
    setRadius(1);
    handlers.current.clear();
    setSource(DEFAULT_PDF);
  }

  // 왼쪽 목차 구간: AI가 만든 주제별 구간 > PDF 안 목차 > (30쪽 넘으면) 10쪽 묶음.
  // 슬라이드 PDF는 쪽마다 목차 항목이 있는 경우가 많아, 쪽 수에 가까운 목차는 쓸모가 없어 건너뛴다.
  const railSections: Section[] | null = (() => {
    if (isDefault || !numPages) return null;
    if (sections) return sections;
    const usable = outline.filter((o) => o.page !== null).length;
    if (usable >= 2 && usable < numPages * 0.7) return outlineToSections(outline, numPages);
    return numPages > 30 ? chunkSections(numPages) : null;
  })();
  const activeSection = railSections?.find((s) => page >= s.from && page <= s.to);
  const thumbRange: [number, number] | undefined =
    railSections && numPages > 30 && activeSection ? [activeSection.from, activeSection.to] : undefined;

  const currentProject = isDefault ? projectOfPage(page) : undefined;
  const hasHits = hits.length > 0;

  return (
    <div className={`viewer${chatOpen && (isDefault || aiPdf) ? " chat-open" : ""}`}>
      <header className="topbar">
        <button className="iconbtn railtoggle" onClick={() => setRailOpen((v) => !v)} aria-label="목록 열기">
          ☰
        </button>
        <button className="brand iconbtn" style={{ border: 0, background: "none" }} onClick={onShowIntro} title="소개 다시 보기">
          CODESEEKER
        </button>
        <button className="iconbtn" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="이전 쪽">
          ‹
        </button>
        <label className="pageinput">
          <input
            inputMode="numeric"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") go(Number(pageInput) || page);
            }}
            onBlur={() => setPageInput(String(page))}
            aria-label="쪽 번호"
          />
          / {numPages || "–"}
        </label>
        <button className="iconbtn" onClick={() => go(page + 1)} disabled={!numPages || page >= numPages} aria-label="다음 쪽">
          ›
        </button>
        <div className="spacer" />
        <form className="search" onSubmit={runSearch} role="search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="검색"
            aria-label="문서 안 검색"
          />
          {activeQuery && (
            <>
              <button type="button" className="iconbtn" onClick={() => stepHit(-1)} disabled={!hasHits} aria-label="이전 결과">
                ↑
              </button>
              <button type="button" className="iconbtn" onClick={() => stepHit(1)} disabled={!hasHits} aria-label="다음 결과">
                ↓
              </button>
            </>
          )}
          <span className="count" aria-live="polite">
            {searching ? "찾는 중…" : activeQuery ? (hasHits ? `${hitIdx + 1}/${hits.length}쪽` : "결과 없음") : ""}
          </span>
        </form>
        <button className="iconbtn strong" onClick={() => startAi("hl")} disabled={aiBusy || (!isDefault && !doc)}>
          {aiBusy && !isDefault ? "준비 중…" : "핵심 보기"}
        </button>
        <button
          className="iconbtn strong"
          onClick={() => startAi("chat")}
          aria-pressed={chatOpen}
          disabled={aiBusy || (!isDefault && !doc)}
        >
          질문하기
        </button>
        <button className="iconbtn" onClick={() => fileInput.current?.click()}>
          PDF 열기
        </button>
        <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={openFile} />
        {isDefault ? (
          <a className="iconbtn" href={DEFAULT_PDF} download="portfolio.pdf" style={{ display: "inline-flex", alignItems: "center" }}>
            <span className="dl-label">다운로드</span>
            <span className="dl-icon" aria-label="다운로드">↓</span>
          </a>
        ) : (
          <button className="iconbtn" onClick={backToDefault}>
            포트폴리오로
          </button>
        )}
      </header>

      <div className={`scrim${railOpen ? " open" : ""}`} onClick={() => setRailOpen(false)} />
      <nav className={`rail${railOpen ? " open" : ""}`} aria-label="탐색">
        {isDefault ? (
          <>
            <h2>프로젝트</h2>
            <ul className="navlist">
              {PROJECTS.map((p) => (
                <li key={p.id}>
                  <button className={`navbtn${currentProject?.id === p.id ? " on" : ""}`} onClick={() => go(p.from)}>
                    <span>{p.title}</span>
                    <small>
                      {p.from === p.to ? p.from : `${p.from}–${p.to}`}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <h2>목차</h2>
            {!sections && doc && numPages >= 4 && (
              <button className="ai-outline-btn" onClick={() => startAi("outline")} disabled={!!outlineBusy || aiBusy}>
                {outlineBusy ? (
                  <>
                    <span className="spin" aria-hidden /> {outlineBusy}
                  </>
                ) : (
                  "✦ AI 목차 만들기 (주제별)"
                )}
              </button>
            )}
            {railSections && (
              <ul className="navlist">
                {railSections.map((s, i) => (
                  <li key={`${s.from}-${i}`}>
                    <button
                      className={`navbtn${activeSection === s ? " on" : ""}`}
                      onClick={() => go(s.from)}
                      title={`${s.from}–${s.to}쪽`}
                    >
                      <span>{s.title}</span>
                      {!/^\d+–\d+쪽$/.test(s.title) && <small>{s.from === s.to ? s.from : `${s.from}–${s.to}`}</small>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <h2>{thumbRange ? `쪽 (${thumbRange[0]}–${thumbRange[1]})` : "쪽"}</h2>
        <ThumbRail key={source instanceof File ? `${source.name}-${source.size}-${source.lastModified}` : source} file={source} page={page} onGo={go} range={thumbRange} />
      </nav>

      <main className="stage" ref={stageRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {loadError && <div className="status">{loadError}</div>}
        {showLoading && (
          <div className="loading" role="status" aria-live="polite">
            <span className="spin" aria-hidden />
            PDF를 불러오는 중입니다…
          </div>
        )}
        {aiMsg && (
          <div className="ai-msg" role="alert">
            <span>{aiMsg}</span>
            <button className="iconbtn" onClick={() => setAiMsg("")} aria-label="닫기">
              ✕
            </button>
          </div>
        )}
        {hlOpen && isDefault && <HighlightPanel onPick={pickCard} onClose={() => setHlOpen(false)} />}
        {hlOpen && !isDefault && aiCards && (
          <HighlightPanel
            groups={[{ id: "ai", title: "AI가 고른 핵심", cards: aiCards }]}
            memoryKey={source instanceof File ? `${source.name}-${source.size}-${source.lastModified}` : "u"}
            note="올린 문서에서 AI가 고른 핵심입니다. AI가 만든 내용이므로 근거 쪽에서 원문을 확인하세요."
            onPick={pickCard}
            onClose={() => setHlOpen(false)}
          />
        )}
        <StageDocument
          file={source}
          numPages={numPages}
          layers={layers}
          visibleN={visibleN}
          pageWidth={pageWidth}
          textRenderer={textRenderer}
          renderHandler={renderHandler}
          onLoadSuccess={onDocLoaded}
          onLoadError={onDocError}
        />
      </main>
      {chatOpen && isDefault && <ChatPanel onCite={citeFromChat} onClose={() => setChatOpen(false)} />}
      {chatOpen && !isDefault && aiPdf && (
        <ChatPanel
          key={source instanceof File ? `${source.name}-${source.size}` : "u"}
          pdf={aiPdf}
          onCite={citeFromChat}
          onClose={() => setChatOpen(false)}
        />
      )}
      {consent && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="AI 기능 동의">
          <div className="modal-card">
            <h2>AI 기능을 쓰시겠어요?</h2>
            <p>
              {consent === "outline" ? (
                <>
                  주제별 목차를 만들기 위해 <b>각 쪽의 앞부분 글자(쪽당 160자 이내)</b>가 <b>Anthropic API(Claude)</b>로
                  전송됩니다. 파일 자체는 전송되지 않고, 이 사이트의 서버에도 저장되지 않습니다.
                </>
              ) : (
                <>
                  이 기능을 쓰면 지금 연 PDF 파일의 내용이 <b>Anthropic API(Claude)</b>로 전송되어 핵심을 고르고 질문에
                  답합니다. 파일은 이 사이트의 서버에 저장되지 않습니다.
                </>
              )}
            </p>
            <p className="fine">
              {consent === "outline"
                ? "4~400쪽, 글자가 있는 PDF만 가능합니다. 민감한 문서는 동의하지 마세요."
                : "3MB 이하, 40쪽 이하, 글자가 있는 PDF만 가능합니다. 민감한 문서는 동의하지 마세요."}
            </p>
            <div className="intro-actions">
              <button className="btn ghost" onClick={() => setConsent(null)}>
                취소
              </button>
              <button className="btn primary" onClick={() => void confirmConsent()} autoFocus>
                동의하고 계속
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
