import { useEffect, useRef } from 'react';
import { DOWNLOADS, type VarStyle } from '../config';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { HarmonyIcon, AndroidIcon } from './DownloadIcons';

/** Hero:左侧文案 + 双下载按钮,右侧米露舞台(眨眼、漂浮思绪碎片、滚动退场)。 */
export default function Hero() {
  const reduced = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const miroRef = useRef<HTMLDivElement>(null);

  // 米露随机眨眼:idle / blink 两帧交叉淡入
  useEffect(() => {
    if (reduced) return;
    let timer = 0;
    const blink = () => {
      timer = window.setTimeout(() => {
        miroRef.current?.classList.add('is-blink');
        window.setTimeout(() => miroRef.current?.classList.remove('is-blink'), 140);
        blink();
      }, 2600 + Math.random() * 3000);
    };
    blink();
    return () => window.clearTimeout(timer);
  }, [reduced]);

  // 滚动退场:米露缩小右移、文案上飘、碎片淡出 —— 「进入米露的世界」
  useEffect(() => {
    if (reduced) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const p = Math.min(Math.max(window.scrollY / (window.innerHeight * 0.95), 0), 1);
        const stage = stageRef.current, copy = copyRef.current;
        if (stage) {
          stage.style.transform = `translate(${p * 9}vw, ${p * 14}vh) scale(${1 - p * 0.38})`;
          stage.style.opacity = String(1 - p * 0.92);
        }
        if (copy) {
          copy.style.transform = `translateY(${p * -7}vh)`;
          copy.style.opacity = String(1 - p * 1.05);
        }
        stage?.parentElement
          ?.querySelectorAll<HTMLElement>('.frag, .spark')
          .forEach((el) => { el.style.opacity = String(1 - p * 1.6); });
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [reduced]);

  return (
    <section id="hero">
      <div className="wrap hero-grid">
        <div className="hero-copy" ref={copyRef}>
          <p className="eyebrow">你的数字世界,也应该有人陪你。</p>
          <h1>有些事情,<br />不必<span className="glow-word">一个人</span>想完。</h1>
          <p className="lede">
            把脑海里的事情交给喵灵。{'\n'}她会听你说、帮你记住,也会在下一次见面时继续陪你。
          </p>
          <div className="dl-row">
            <a className="dl-btn" href={DOWNLOADS.harmony.url}>
              <HarmonyIcon />
              <span>
                <span className="t1">鸿蒙版下载</span>
                <span className="t2">{DOWNLOADS.harmony.sub}</span>
              </span>
            </a>
            <a className="dl-btn" href={DOWNLOADS.android.url}>
              <AndroidIcon />
              <span>
                <span className="t1">Android 版下载</span>
                <span className="t2">{DOWNLOADS.android.sub}</span>
              </span>
            </a>
          </div>
          <p className="dl-note"><i>Windows / macOS</i> 正在准备中</p>
        </div>

        <div className="hero-stage" ref={stageRef}>
          <div className="miro" ref={miroRef}>
            <img src="/assets/miro-idle.webp?v=20260925" alt="米露 — 一只安静的黑色小猫，怀里抱着一颗星星" />
            <img className="blink" src="/assets/miro-blink.webp?v=20260925" alt="" aria-hidden="true" />
            <div className="miro-halo" />
          </div>
          <div className="frag" style={{ left: '-4%', top: '12%', '--dur': '8s', '--dx': '10px', '--dy': '-18px', '--rot': '-4deg' } as VarStyle}>明天要交的东西…</div>
          <div className="frag" style={{ right: 0, top: '6%', '--dur': '10s', '--delay': '-3s', '--dx': '-12px', '--dy': '-10px', '--rot': '3deg' } as VarStyle}>那句话,是不是说错了</div>
          <div className="frag" style={{ left: '2%', bottom: '16%', '--dur': '9s', '--delay': '-5s', '--dx': '14px', '--dy': '12px', '--rot': '2deg' } as VarStyle}>先记下来,晚点再想</div>
          <div className="frag" style={{ right: 0, bottom: '6%', '--dur': '11s', '--delay': '-2s', '--dx': '-10px', '--dy': '14px', '--rot': '-3deg' } as VarStyle}>想吃火锅</div>
          <i className="spark" style={{ left: '8%', top: '34%', '--s': '12px', '--dur': '3.6s' } as VarStyle} />
          <i className="spark pink" style={{ right: '10%', top: '38%', '--s': '10px', '--dur': '4.4s', '--delay': '-1s' } as VarStyle} />
          <i className="spark lav" style={{ left: '20%', bottom: '6%', '--s': '9px', '--dur': '5s', '--delay': '-2s' } as VarStyle} />
          <i className="spark" style={{ right: '20%', bottom: '10%', '--s': '14px', '--dur': '3.2s', '--delay': '-0.6s' } as VarStyle} />
        </div>
      </div>
      <div className="scroll-hint">往下,进来看看</div>
    </section>
  );
}
