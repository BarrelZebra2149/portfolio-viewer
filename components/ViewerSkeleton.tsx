// 뷰어와 같은 배치의 로딩 화면. 실제 뷰어로 바뀔 때 위치가 튀지 않게 같은 격자를 쓴다.
export default function ViewerSkeleton() {
  return (
    <div className="viewer" aria-busy="true">
      <header className="topbar">
        <span className="brand">CODESEEKER</span>
      </header>
      <nav className="rail" aria-hidden />
      <main className="stage">
        <div className="loading" role="status">
          <span className="spin" aria-hidden />
          PDF를 불러오는 중입니다…
        </div>
      </main>
    </div>
  );
}
