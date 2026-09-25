import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { petRig, type PetController, type PetKind, type PetMood } from '../rig';

type PetProps = {
  pet: PetKind;
  mood?: PetMood;
  night?: boolean;
  className?: string;
  label: string;
};

/**
 * 页面里的活桌宠：与 App 同一份骨骼动画。滚出视口即暂停；点一下会有反应。
 * 运行时没加载到时退回同机位的静态图。
 */
export default function Pet({ pet, mood = 'idle', night = false, className, label }: PetProps) {
  const hostRef = useRef<HTMLButtonElement>(null);
  const rigRef = useRef<PetController | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const host = hostRef.current, rig = petRig();
    if (!host || !rig) return;
    const c = rig.mountPet(host, { pet, mood, night, reduceMotion: reduced });
    rigRef.current = c;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? c.resume() : c.pause()), { threshold: 0 });
    io.observe(host);
    return () => { io.disconnect(); c.destroy(); rigRef.current = null; };
    // 只在换角色时重建，其余变化走 set()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet]);

  useEffect(() => { rigRef.current?.set({ mood, night, reduceMotion: reduced }); }, [mood, night, reduced]);

  const still = `/assets/pets/${pet}-${mood === 'sleep' ? 'sleep' : 'idle'}.png`;
  return (
    <button
      aria-label={label}
      className={`pet ${className ?? ''}`}
      onClick={() => rigRef.current?.poke()}
      ref={hostRef}
      type="button"
    >
      {petRig() ? null : <img alt="" src={still} />}
    </button>
  );
}
