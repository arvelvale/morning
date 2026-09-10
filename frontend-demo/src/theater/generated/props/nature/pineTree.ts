/** 松树（scenes/campsite 预置场景也引用 createPineTree）。 */
import { createPineTree } from "./createPineTree";
import { hexNum, numOf, type PropBuilder, type Params } from "../shared";

export { createPineTree };

export const buildPineTree: PropBuilder = (p: Params = {}) => {
  return createPineTree({ height: numOf(p.height, 3.5), color: hexNum(p.color, 0x14301e) });
};
