import assert from 'node:assert/strict';
import { layoutContextMenu, minRadialRadius, type ContextMenuLayout, type ScreenInsets } from '../game/ui';

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

// --- New.txt (2026-07-20): adaptive-width buttons must never overlap each other.
function overlappingPairs(layout: ContextMenuLayout): string[] {
  const hits: string[] = [];
  for (let i = 0; i < layout.items.length; i++) {
    for (let j = i + 1; j < layout.items.length; j++) {
      const a = layout.items[i], b = layout.items[j];
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      // Rects overlap only when they fail to clear on BOTH axes.
      if (dx < (a.width + b.width) / 2 - 1e-6 && dy < (a.height + b.height) / 2 - 1e-6) hits.push(`${i}-${j}`);
    }
  }
  return hits;
}

check(minRadialRadius(0, 116, 48) === 0 && minRadialRadius(1, 116, 48) === 0, 'a lone bubble needs no separation radius');
check(minRadialRadius(5, 240, 48) > minRadialRadius(5, 116, 48), 'wider buttons demand a wider ring');
check(minRadialRadius(4, 116, 48) > 0, 'four bubbles need a positive separation radius');

// The real reported case: a long action name widens every bubble on a phone.
for (const count of [2, 3, 4, 5]) {
  for (const width of [116, 160, 200, 260]) {
    const layout = layoutContextMenu({ x: 187.5, y: 406 }, count, { width: 375, height: 812 }, {}, { buttonWidthPx: width });
    check(overlappingPairs(layout).length === 0, `${count} bubbles at ${width}px never overlap (${layout.mode})`);
    assertInside(layout, 375, 812, noSafe);
  }
}

// Desktop has room, so wide bubbles stay radial there rather than falling back to a list.
const wideDesktop = layoutContextMenu({ x: 512, y: 384 }, 4, { width: 1024, height: 768 }, {}, { buttonWidthPx: 200 });
check(wideDesktop.mode === 'radial', 'a wide ring still fits on desktop');
check(overlappingPairs(wideDesktop).length === 0, 'desktop wide bubbles do not overlap');
check(wideDesktop.items.every((i) => i.width === 200), 'the authored button width is honoured');

// Same buttons on a narrow phone cannot ring without overlapping, so the layout stacks instead.
const wideMobile = layoutContextMenu({ x: 187.5, y: 406 }, 4, { width: 375, height: 812 }, {}, { buttonWidthPx: 260 });
check(wideMobile.mode === 'list', 'bubbles too wide to ring fall back to the list layout');
check(overlappingPairs(wideMobile).length === 0, 'the list fallback does not overlap either');
check(wideMobile.items.every((i) => i.width === 260), 'the list fallback keeps the adaptive width so long names still fit');
const narrowList = layoutContextMenu({ x: 512, y: 384 }, 7, { width: 1024, height: 768 }, {}, { buttonWidthPx: 116 });
check(narrowList.mode === 'list' && narrowList.items.every((i) => i.width === 160), 'an ordinary list keeps its tidy 160px width');

// A small authored radius is still grown to whatever the buttons actually need.
const tightRadius = layoutContextMenu({ x: 512, y: 384 }, 5, { width: 1024, height: 768 }, {}, { buttonWidthPx: 150, centerRadiusPx: 10 });
check(tightRadius.mode === 'radial' && overlappingPairs(tightRadius).length === 0, 'an under-sized authored radius grows to clear the buttons');

console.log(`context menu layout: ${assertions} assertions passed`);
