"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DEFAULT_PDF, PROJECTS, projectOfPage } from "@/lib/portfolio";
import HighlightPanel, { type Card } from "./HighlightPanel";

// PDF.js를 쓰는 부분만 브라우저에서 따로 불러온다. 위쪽 도구 줄과 목록은 바로 보인다.
const StageDocument = dynamic(() => import("./pdf/StageDocument"), { ssr: false, loading: () => null });
const ThumbRail = dynamic(() => import("./pdf/ThumbRail"), { ssr: false, loading: () => null });

const MAX_RADIUS = 14;

type Source = string | File;
type OutlineEntry = { title: string; page: number | null };

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 근거 문장(cited)을 쪽의 글자 층에서 찾아 해당 글줄을 칠한다. 공백 차이는 무시한다.
function applyCite(root: Element, cited: string): boolean {
  root.querySelectorAll(".cite").forEach((el) => el.classList.remove("cite"));
  const spans = Array.from(root.querySelectorAll("span")).filter((s) => !s.querySelector("span"));
  let full = "";
  const owner: number[] = [];
  spans.forEach((s, i) => {
    for (const ch of s.textContent ?? "") {
      if (!/\s/.test(ch)) {
        full += ch;
        owner.push(i);
      }
    }
  });
  const needle = cited.replace(/\s+/g, "");
  const at = needle ? full.indexOf(needle) : -1;
  if (at < 0) return false;
  for (let i = owner[at]; i <= owner[at + needle.length - 1]; i++) spans[i].classList.add("cite");
  return true;
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

  function pickCard(card: Card) {
    setHlOpen(false);
    setCite({ page: card.page, text: card.cited });
    go(card.page);
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
    setPage(1);
    setShown(1);
    setRendered(new Set());
    setRadius(1);
    handlers.current.clear();
    setSource(DEFAULT_PDF);
  }

  const currentProject = isDefault ? projectOfPage(page) : undefined;
  const hasHits = hits.length > 0;

  return (
    <div className="viewer">
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
        {isDefault && (
          <button className="iconbtn strong" onClick={() => setHlOpen(true)}>
            핵심 보기
          </button>
        )}
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
          outline.length > 0 && (
            <>
              <h2>목차</h2>
              <ul className="navlist">
                {outline.map((o, i) => (
                  <li key={i}>
                    <button className="navbtn" disabled={o.page === null} onClick={() => o.page && go(o.page)}>
                      <span>{o.title}</span>
                      {o.page && <small>{o.page}</small>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )
        )}
        <h2>쪽</h2>
        <ThumbRail file={source} page={page} onGo={go} />
      </nav>

      <main className="stage" ref={stageRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {loadError && <div className="status">{loadError}</div>}
        {!loadError && (visibleN !== page || rendered.size === 0) ? (
          <div className={`loading${rendered.size ? " corner" : ""}`} role="status" aria-live="polite">
            <span className="spin" aria-hidden />
            {rendered.size ? "" : "PDF를 불러오는 중입니다…"}
          </div>
        ) : null}
        {hlOpen && isDefault && <HighlightPanel onPick={pickCard} onClose={() => setHlOpen(false)} />}
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
    </div>
  );
}
