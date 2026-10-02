"use client";

import "@/lib/polyfills";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// workerSrc는 react-pdf 컴포넌트를 쓰는 이 파일에서 직접 지정해야 한다.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export default function StageDocument({
  file,
  numPages,
  layers,
  visibleN,
  pageWidth,
  textRenderer,
  renderHandler,
  onLoadSuccess,
  onLoadError,
}: {
  file: string | File;
  numPages: number;
  layers: number[];
  visibleN: number;
  pageWidth: number;
  textRenderer: (item: { str: string }) => string;
  renderHandler: (n: number) => () => void;
  onLoadSuccess: (pdf: PDFDocumentProxy) => void;
  onLoadError: () => void;
}) {
  return (
    <Document
      file={file}
      onLoadSuccess={onLoadSuccess}
      onLoadError={onLoadError}
      suspense={false}
      loading={null}
      error={null}
      externalLinkTarget="_blank"
      externalLinkRel="noopener noreferrer"
    >
      {numPages > 0 && (
        <div className="sheetstack">
          {layers.map((n) => (
            <div key={n} className={`sheet${n === visibleN ? "" : " pending"}`} aria-hidden={n === visibleN ? undefined : true}>
              <Page
                pageNumber={n}
                width={pageWidth}
                customTextRenderer={textRenderer}
                loading={null}
                onRenderSuccess={renderHandler(n)}
              />
            </div>
          ))}
        </div>
      )}
    </Document>
  );
}
