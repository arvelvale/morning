import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { petRig, type FilmController } from '../rig';

/**
 * 首屏短片：40 秒程序化动画（米露与波比的一天），与 App 角色同源。
 * 自动播放、滚出视口暂停；超过 5 秒的自动动画必须能停，所以右下角有暂停键。
 */
export default function Film() {
  const hostRef = useRef<HTMLDivElement>(null);
  const filmRef = useRef<FilmController | null>(null);
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(!reduced);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current, rig = petRig();
    if (!host || !rig) return;
    const film = rig.mountFilm(host, { fit: 'cover', loop: true, autoplay: !reduced, reduceMotion: reduced, posterTime: 19.2 });
    filmRef.current = film;
    film.ready.then(() => setReady(true));
    return () => { film.destroy(); filmRef.current = null; };
  }, [reduced]);

  const toggle = () => {
    const film = filmRef.current;
    if (!film) return;
    if (film.playing) film.pause(); else film.play();
    setPlaying(film.playing);
  };

  return (
    <figure className="film sticker">
      <div
        aria-label="动画短片：黎明时米露在打盹，波比送来一杯水；念头碎片飘过，米露把最重的那一片收进星星；入夜后它守着睡着的波比。"
        className={`film-canvas${ready ? ' is-ready' : ''}`}
        ref={hostRef}
        role="img"
      />
      {reduced ? null : (
        <button aria-label={playing ? '暂停短片' : '播放短片'} className="film-toggle" onClick={toggle} type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {playing ? <path d="M9 6v12M15 6v12" /> : <path d="M8 5l11 7-11 7z" />}
          </svg>
        </button>
      )}
      <i className="tape tape-l" aria-hidden="true" />
      <i className="tape tape-r" aria-hidden="true" />
    </figure>
  );
}
