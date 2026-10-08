import { GITHUB_URL } from '../config';

/** 极简页脚。 */
export default function Footer() {
  return (
    <footer>
      <div className="foot">
        <a className="brand" href="#hero">
          <img src={`${import.meta.env.BASE_URL}assets/favicon.png`} alt="喵灵 logo" />
          <b>喵灵</b>
          <span>Morning</span>
        </a>
        <div className="foot-links">
          <a href="#hero">Product</a>
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
          <a href={GITHUB_URL}>GitHub</a>
        </div>
        <p className="foot-slogan">Made for the thoughts you don't want to carry alone.</p>
      </div>
    </footer>
  );
}
