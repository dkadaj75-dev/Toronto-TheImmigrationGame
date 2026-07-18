import assert from 'node:assert/strict';
import { layoutContextMenu, type ContextMenuLayout, type ScreenInsets } from '../game/ui';

let assertions = 0;
const check = (value: unknown, message: string) => { assertions++; assert.ok(value, message); };

function assertInside(layout: ContextMenuLayout, width: number, height: number, safe: ScreenInsets) {
  for (const [index, item] of [layout.title, ...layout.items].entries()) {
    check(item.x - item.width / 2 >= safe.left + 8 - 1e-6, `item ${index} clears left safe edge`);
    check(item.x + item.width / 2 <= width - safe.right - 8 + 1e-6, `item ${index} clears right safe edge`);
    check(item.y - item.height / 2 >= safe.top + 8 - 1e-6, `item ${index} clears top safe edge`);
    check(item.y + item.height / 2 <= height - safe.bottom - 8 + 1e-6, `item ${index} clears bottom safe edge`);
  }
}

const noSafe = { top: 0, right: 0, bottom: 0, left: 0 };
const radial = layoutContextMenu({ x: 187.5, y: 406 }, 5, { width: 375, height: 812 });
check(radial.mode === 'radial', 'five bubbles use radial layout');
check(radial.items.length === 5, 'radial layout returns every bubble');
check(new Set(radial.items.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)).size === 5, 'radial bubble positions are distinct');
assertInside(radial, 375, 812, noSafe);

const styled = layoutContextMenu({ x: 300, y: 300 }, 4, { width: 600, height: 600 }, {}, {
  marginPx: 6, buttonWidthPx: 140, buttonHeightPx: 60, centerRadiusPx: 130,
});
check(styled.items.every((item) => item.width === 140 && item.height === 60), 'theme metrics set radial button width and height');
const styledDistance = Math.hypot(styled.items[0].x - styled.center.x, styled.items[0].y - styled.center.y);
check(Math.abs(styledDistance - 130) < 0.001, 'theme center radius controls button distance from menu center');

const safe = { top: 47, right: 9, bottom: 34, left: 7 };
for (const point of [{ x: 0, y: 0 }, { x: 375, y: 0 }, { x: 0, y: 812 }, { x: 375, y: 812 }]) {
  const edge = layoutContextMenu(point, 4, { width: 375, height: 812 }, safe);
  check(edge.mode === 'radial', 'edge menu keeps radial geometry');
  assertInside(edge, 375, 812, safe);
}

const manyRight = layoutContextMenu({ x: 30, y: 400 }, 8, { width: 375, height: 812 }, safe);
check(manyRight.mode === 'list', 'many bubbles use compact list arc');
check(manyRight.items.every((p) => p.x > manyRight.center.x), 'list arc opens toward available right side');
check(manyRight.items.every((p, i, all) => i === 0 || p.y >= all[i - 1].y), 'list arc is vertically ordered');
check(new Set(manyRight.items.map((p) => p.x.toFixed(2))).size > 1, 'list has a curved horizontal arc');
check(manyRight.items.every((p) => p.x - p.width / 2 >= manyRight.title.x + manyRight.title.width / 2), 'list clears the central title bubble');
assertInside(manyRight, 375, 812, safe);

const manyLeft = layoutContextMenu({ x: 350, y: 400 }, 8, { width: 375, height: 812 }, safe);
check(manyLeft.items.every((p) => p.x < manyLeft.center.x), 'list arc opens toward available left side');
assertInside(manyLeft, 375, 812, safe);

const legacyCenter = layoutContextMenu({ x: 512, y: 384 }, 2, { width: 1024, height: 768 });
check(legacyCenter.mode === 'radial', 'two-item legacy/default menu remains radial');
assertInside(legacyCenter, 1024, 768, noSafe);

console.log(`context menu layout: ${assertions} assertions passed`);
