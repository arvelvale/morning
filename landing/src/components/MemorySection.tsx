import type { VarStyle } from '../config';

/** Feature 02 · 记忆星河:散落的记忆便签缓缓向米露汇聚。 */
export default function MemorySection() {
  return (
    <section id="memory">
      <div className="wrap">
        <div className="head reveal">
          <p className="eyebrow">持续陪伴</p>
          <h2>不是每一次见面,<br />都要从<span className="glow-word">「你好」</span>开始。</h2>
          <p className="lede" style={{ marginTop: 22 }}>
            喵灵会在得到允许的情况下,记住真正重要的事情。下一次对话延续上一次,而不是重新认识你。
          </p>
        </div>
        <div className="galaxy reveal">
          <div className="galaxy-core">
            <div className="ring" />
            <img src="/assets/miro-sit.webp?v=20260911" alt="米露安静地坐着" />
          </div>
          <div className="memo" style={{ left: '6%', top: '8%', '--tx': '30px', '--ty': '26px', '--rot': '-3deg', '--dur': '13s' } as VarStyle}>「最近在做 <em>Humanboard</em>」</div>
          <div className="memo" style={{ right: '5%', top: '14%', '--tx': '-34px', '--ty': '22px', '--rot': '2deg', '--dur': '15s', '--delay': '-4s' } as VarStyle}>「周五有一个<em>重要任务</em>」</div>
          <div className="memo" style={{ left: '12%', bottom: '12%', '--tx': '26px', '--ty': '-24px', '--rot': '3deg', '--dur': '14s', '--delay': '-7s' } as VarStyle}>「喜欢<em>晚上</em>写东西」</div>
          <div className="memo" style={{ right: '10%', bottom: '6%', '--tx': '-28px', '--ty': '-20px', '--rot': '-2deg', '--dur': '16s', '--delay': '-2s' } as VarStyle}>「昨天说最近<em>有点累</em>」</div>
          <i className="spark" style={{ left: '28%', top: '22%', '--s': '8px', '--dur': '4s' } as VarStyle} />
          <i className="spark lav" style={{ right: '26%', top: '34%', '--s': '10px', '--dur': '4.6s', '--delay': '-1.4s' } as VarStyle} />
          <i className="spark pink" style={{ left: '32%', bottom: '18%', '--s': '7px', '--dur': '5.2s', '--delay': '-2.6s' } as VarStyle} />
        </div>
      </div>
    </section>
  );
}
