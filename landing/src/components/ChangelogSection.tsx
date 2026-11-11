import { CHANGELOG, type Release } from '../changelog';

/** 默认展开的最近几版；更早的收进「更早的版本」。 */
const SHOWN = 3;

/** 「2026-11-03」→「2026 年 11 月 3 日」；格式不对就原样返回。 */
function niceDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[1]} 年 ${Number(m[2])} 月 ${Number(m[3])} 日` : iso;
}

function Entry({ r, latest }: { r: Release; latest?: boolean }) {
  return (
    <li className="cl-entry reveal">
      <div className="cl-rail">
        <span className="cl-ver">v{r.version}</span>
        <time dateTime={r.date}>{niceDate(r.date)}</time>
        {latest && <span className="cl-badge">最新</span>}
      </div>
      <article className="cl-card sticker">
        <h3>{r.title}</h3>
        <ul>
          {r.items.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </article>
    </li>
  );
}

/** 更新日志：Android 版每一版改了什么，用用户看得懂的话写（内容在 src/changelog.ts）。 */
export default function ChangelogSection() {
  const recent = CHANGELOG.slice(0, SHOWN);
  const older = CHANGELOG.slice(SHOWN);
  return (
    <section id="changelog">
      <div className="wrap">
        <div className="head reveal">
          <p className="eyebrow">更新日志</p>
          <h2>喵灵，<span className="scribble">一点一点</span>变好。</h2>
          <p className="lede">Android 版每一次更新，都记在这里。</p>
        </div>
        <ol className="cl-list">
          {recent.map((r, i) => <Entry key={r.version} r={r} latest={i === 0} />)}
        </ol>
        {older.length > 0 && (
          <details className="cl-more">
            <summary>更早的版本（{older.length}）</summary>
            <ol className="cl-list">
              {older.map((r) => <Entry key={r.version} r={r} />)}
            </ol>
          </details>
        )}
      </div>
    </section>
  );
}
