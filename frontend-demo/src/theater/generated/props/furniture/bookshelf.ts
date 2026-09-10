/**
 * 开放书架：0.9×1.8×0.35 四层，程序化彩色书本（两层满、一层斜插、一层留空）。
 * 确定性随机（同参数同摆放）。
 */
import * as THREE from "three";
import { mat, flatMat, markShadows, type PropBuilder } from "../shared";

export const buildBookshelf: PropBuilder = (p) => {
  const g = new THREE.Group();
  const W = 0.9, H = 1.8, D = 0.35;
  const wood = mat("wood", 0x8a6a4a);
  const dark = flatMat(0x5a4430, 0.76);

  // 外框：两侧板 + 顶底板 + 背板
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.03, H, D), wood);
    side.position.set(sx * (W / 2 - 0.015), H / 2, 0);
    g.add(side);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, H - 0.06, 0.02), dark);
  back.position.set(0, H / 2, -D / 2 + 0.01);
  g.add(back);
  const top = new THREE.Mesh(new THREE.BoxGeometry(W, 0.04, D), wood);
  top.position.y = H - 0.02;
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(W, 0.04, D), wood);
  bottom.position.y = 0.02;
  g.add(top, bottom);

  // 3 块隔板 → 4 层
  for (let i = 1; i <= 3; i++) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, 0.03, D - 0.02), wood);
    shelf.position.y = (H / 4) * i;
    g.add(shelf);
  }

  // 程序化书：层 0/1 放书（随机色、随机斜插一本），层 2 留空，层 3（顶）放书
  const tones = [0xa85a5a, 0x5a7aa8, 0xc4a04a, 0x6a8a5a, 0x9a6a8a, 0x8a7ab0];
  let seed = 7919;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const fillShelf = (layerIdx: number, count: number, lean: boolean) => {
    let x = -W / 2 + 0.09;
    for (let b = 0; b < count; b++) {
      const bw = 0.028 + rand() * 0.022;
      const bh = 0.2 + rand() * 0.06;
      const tone = tones[Math.floor(rand() * tones.length)];
      const bookMat = flatMat(tone, 0.76);
      const book = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, D - 0.1), bookMat);
      const yBase = (H / 4) * layerIdx + 0.015 + bh / 2;
      if (lean && b === Math.floor(count / 2)) {
        book.position.set(x + bw / 2, yBase - 0.01, 0);
        book.rotation.z = -0.22;
        x += bw * 0.7;
      } else {
        book.position.set(x + bw / 2, yBase, 0);
        x += bw + 0.006;
      }
      book.castShadow = true;
      g.add(book);
    }
  };
  fillShelf(0, 6, false);
  fillShelf(1, 5, true);
  // 层 2 留空（供相框/盆栽）
  fillShelf(3, 4, false);

  return markShadows(g);
};
