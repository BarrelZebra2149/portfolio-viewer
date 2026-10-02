"use client";

import "@/lib/polyfills";
import { useEffect, useRef, useState } from "react";
import { Document, Thumbnail, pdfjs } from "react-pdf";

// workerSrc는 react-pdf 컴포넌트를 쓰는 이 파일에서 직접 지정해야 한다.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

function LazyThumb({ n, active, onClick }: { n: number; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <button
      ref={ref}
      className={`thumb${active ? " on" : ""}`}
      onClick={onClick}
      aria-label={`${n}쪽으로 이동`}
      aria-current={active ? "page" : undefined}
    >
      {seen && <Thumbnail pageNumber={n} width={196} onItemClick={() => onClick()} />}
      <span className="num">{n}</span>
    </button>
  );
}

export default function ThumbRail({
  file,
  page,
  onGo,
  range,
}: {
  file: string | File;
  page: number;
  onGo: (n: number) => void;
  // 긴 문서에서는 지금 보는 구간의 썸네일만 그린다.
  range?: [number, number];
}) {
  const [numPages, setNumPages] = useState(0);
  return (
    <Document
      file={file}
      loading={null}
      error={null}
      noData={null}
      onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}
    >
      <div className="thumbs">
        {Array.from({ length: numPages }, (_, i) => i + 1)
          .filter((n) => !range || (n >= range[0] && n <= range[1]))
          .map((n) => (
            <LazyThumb key={n} n={n} active={n === page} onClick={() => onGo(n)} />
          ))}
      </div>
    </Document>
  );
}
