"use client";

import { useEffect, useState } from "react";
import Intro from "./Intro";
import PdfViewer from "./PdfViewer";
import { DEFAULT_PDF } from "@/lib/portfolio";

type Stage = "intro" | "viewer";
const SEEN_KEY = "cs-intro-seen";

export default function Experience() {
  const [stage, setStage] = useState<Stage | null>(null);

  useEffect(() => {
    // 쪽 링크(?p=7)로 들어왔거나 이미 인트로를 본 적이 있으면 바로 뷰어로 간다.
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      /* 저장소를 못 써도 동작해야 한다 */
    }
    const hasPageParam = new URLSearchParams(window.location.search).has("p");
    setStage(seen || hasPageParam ? "viewer" : "intro");
  }, []);

  // 인트로를 읽는 동안 뷰어 코드와 PDF 파일을 미리 받아 둔다.
  useEffect(() => {
    if (stage !== "intro") return;
    void import("./pdf/StageDocument");
    void import("./pdf/ThumbRail");
    fetch(DEFAULT_PDF).catch(() => {});
  }, [stage]);

  function enterViewer() {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* 무시 */
    }
    setStage("viewer");
  }

  if (stage === null) return null;
  if (stage === "intro") return <Intro onDone={enterViewer} />;
  return <PdfViewer onShowIntro={() => setStage("intro")} />;
}
