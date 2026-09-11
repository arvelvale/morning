import type { VarStyle } from '../config';

const VN_STARS: VarStyle[] = [
  { left: '12%', top: '8%', '--dur': '3.8s' },
  { left: '30%', top: '5%', '--dur': '4.5s', '--delay': '-1s' },
  { left: '58%', top: '11%', '--dur': '3.4s', '--delay': '-2s' },
  { left: '74%', top: '6%', '--dur': '5s', '--delay': '-0.5s' },
  { left: '86%', top: '16%', '--dur': '4.2s', '--delay': '-3s' },
  { left: '44%', top: '15%', '--dur': '3.6s', '--delay': '-1.8s' },
];

/** Feature 04 · 场景重演:Visual Novel 风夜晚街道(纯 CSS 场景,逆光剪影)。 */
export default function TheaterSection() {
  return (
    <section id="theater">
      <div className="wrap theater-grid">
        <div className="vn reveal">
          <div className="vn-stars">
            {VN_STARS.map((s, i) => <i key={i} style={s} />)}
          </div>
          <div className="vn-moon" />
          <div className="vn-cone" />
          <div className="vn-lamp" />
          <div className="vn-fig a" />
          <div className="vn-fig b" />
          <div className="vn-miro"><img src="/assets/miro-sit.webp?v=20260911" alt="米露陪在一旁" /></div>
          <div className="vn-ground" />
          <div className="vn-line"><b>米露</b>那天没说出口的话,要不要再想一次?这次我陪你。</div>
        </div>
        <div className="reveal">
          <p className="eyebrow">场景重演</p>
          <h2>有些事情,<br />可以<span className="glow-word">重新想一次</span>。</h2>
          <p className="lede" style={{ marginTop: 22 }}>
            通过场景重演,回顾过去发生的事情,或者提前预演明天可能发生的对话。它不是治疗,只是一种有人陪着的思考方式。
          </p>
        </div>
      </div>
    </section>
  );
}
