import { useEffect, useRef, useState } from 'react';

/** 页面分区锚点（与各 section 的 id 对应）。 */
const LINKS = [
  { id: 'meet', label: '伙伴' },
  { id: 'dump', label: '倾倒' },
  { id: 'memory', label: '记忆' },
  { id: 'desk', label: '桌宠' },
  { id: 'theater', label: '场景重演' },
] as const;

/** 与 styles.css 里折叠导航的断点一致。 */
const COMPACT = '(max-width: 860px)';

/**
 * 顶部导航：品牌 | 分区链接（视觉居中）| 下载。
 * - 当前读到哪一区，对应链接带金色短下划线（aria-current="location"）。
 * - 页面滚动后导航条底色更实、阴影略深，和内容分开。
 * - 窄屏收成「菜单」按钮，展开后在导航条里往下展开；Esc / 点外面 / 点链接都会收起。
 */
export default function Nav() {
  const [active, setActive] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // 当前分区：视口 38% 高度处落在哪个 section 里
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      setScrolled(window.scrollY > 8);
      const probe = window.innerHeight * 0.38;
      let current: string | null = null;
      for (const { id } of LINKS) {
        const r = document.getElementById(id)?.getBoundingClientRect();
        if (r && r.top <= probe && r.bottom > probe) { current = id; break; }
      }
      setActive(current);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  // 菜单展开时：Esc 收起并把焦点还给按钮；点导航条外面收起；窗口变宽到桌面布局时收起
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); menuBtnRef.current?.focus(); }
    };
    const onDown = (e: PointerEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const mq = window.matchMedia(COMPACT);
    const onMq = () => { if (!mq.matches) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    mq.addEventListener('change', onMq);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      mq.removeEventListener('change', onMq);
    };
  }, [open]);

  const cls = ['topbar', scrolled && 'is-scrolled', open && 'is-open'].filter(Boolean).join(' ');

  return (
    <header className={cls} ref={headerRef}>
      <div className="topbar-row">
        <a className="brand" href="#hero" aria-label="喵灵 Morning，回到页首">
          <img src={`${import.meta.env.BASE_URL}assets/favicon.png`} alt="" width={32} height={32} />
          <span className="brand-name" aria-hidden="true">
            <b>喵灵</b>
            <span>Morning</span>
          </span>
        </a>

        <nav className="topbar-nav" aria-label="页面分区">
          <ul>
            {LINKS.map(({ id, label }) => (
              <li key={id}>
                <a href={`#${id}`} aria-current={active === id ? 'location' : undefined}>{label}</a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="topbar-actions">
          <a className="nav-cta" href="#download">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></svg>
            下载
          </a>
          <button
            aria-controls="topbar-menu"
            aria-expanded={open}
            aria-label={open ? '收起导航' : '展开导航'}
            className="topbar-menu-btn"
            onClick={() => setOpen((v) => !v)}
            ref={menuBtnRef}
            type="button"
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
        </div>
      </div>

      <nav className="topbar-menu" id="topbar-menu" aria-label="页面分区">
        <div>
          <ul>
            {LINKS.map(({ id, label }) => (
              <li key={id}>
                <a
                  aria-current={active === id ? 'location' : undefined}
                  href={`#${id}`}
                  onClick={() => setOpen(false)}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </header>
  );
}
