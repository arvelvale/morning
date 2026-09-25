import type { VarStyle } from '../config';
import Pet from './Pet';

/** 持续陪伴：散落的记忆纸条缓缓向米露汇聚。 */
export default function MemorySection() {
  return (
    <section id="memory">
      <div className="wrap">
        <div className="head reveal">
          <p className="eyebrow">持续陪伴</p>
          <h2>不是每一次见面，<br />都要从<span className="scribble">「你好」</span>开始。</h2>
          <p className="lede">
            喵灵会在得到允许的情况下，记住真正重要的事情。下一次对话延续上一次，而不是重新认识你。
          </p>
        </div>
        <div className="galaxy reveal">
          <div className="galaxy-core">
            <Pet label="米露，点一下它" mood="happy" pet="miro" />
          </div>
          {[
            ['最近在做', 'Humanboard', '', { left: '4%', top: '10%', '--tx': '30px', '--ty': '26px', '--rot': '-4deg', '--dur': '13s' }],
            ['周五有一个', '重要任务', '', { right: '4%', top: '14%', '--tx': '-34px', '--ty': '22px', '--rot': '3deg', '--dur': '15s', '--delay': '-4s' }],
            ['喜欢', '晚上', '写东西', { left: '9%', bottom: '12%', '--tx': '26px', '--ty': '-24px', '--rot': '3deg', '--dur': '14s', '--delay': '-7s' }],
            ['昨天说最近', '有点累', '', { right: '8%', bottom: '8%', '--tx': '-28px', '--ty': '-20px', '--rot': '-2deg', '--dur': '16s', '--delay': '-2s' }],
          ].map(([a, em, b, style], i) => (
            <div className={`memo m${i + 1}`} key={em as string} style={style as VarStyle}>「{a as string}<em>{em as string}</em>{b as string}」</div>
          ))}
        </div>
      </div>
    </section>
  );
}
