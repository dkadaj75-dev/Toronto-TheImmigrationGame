// condition-builder.js — shared quest-Condition-tree builder UI for the tools (ROADMAP_APT R1).
//
// Extracted VERBATIM from the Quest Editor's inline builder so the Map Editor's Rental "availability"
// card (and any future tool) reuses ONE builder instead of adding a fourth hand-rolled copy — the
// PROJECT_CONTEXT §5 "tools import game logic, never reimplement" rule applied to shared tool UI.
// The Condition tree shape/namespace it edits is the SAME one game/quests.ts evaluates (needs.<id>,
// skills.<id>, funds, time.hour/day, vars.<name>, quests.<id>.state — PROJECT_CONTEXT §3.2).
//
// Classic script (like tools/nav.js) exposing window.ConditionBuilder. jsdom note: jsdom does not
// fetch <script src> by default, so the tool jsdom suites inject this source manually before
// exercising a page (see test/quest-editor.test.mjs and test/map-editor.test.mjs) — the same
// pattern test/toolnav.test.mjs uses for nav.js.
(function () {
  'use strict';

  // ---------------------------------------------------------------- pure tree helpers (no state)
  // isLeafCond(c): a condition node is a leaf iff it has neither `all` nor `any` (Condition union).
  function isLeafCond(c) { return c != null && typeof c === 'object' && !('all' in c) && !('any' in c); }
  function getLeafOp(leaf) { for (const op of ['gte', 'lte', 'eq', 'neq']) if (op in leaf) return op; return null; }

  /** Recursively test whether any leaf in `cond` satisfies `predicate`. */
  function anyLeaf(cond, predicate) {
    if (!cond) return false;
    if (isLeafCond(cond)) return predicate(cond);
    const key = 'all' in cond ? 'all' : 'any';
    return (cond[key] || []).some((c) => anyLeaf(c, predicate));
  }

  /**
   * Recursively strip leaves matching `predicate` out of a condition tree, mutating combinator
   * arrays in place (keeps the same object identity for the group, even if it ends up empty —
   * an emptied `all` is vacuously TRUE, an emptied `any` is FALSE per game/quests.ts's evaluator).
   * Returns null only in the (pathological, hand-edited-JSON) case where the root itself is a
   * matching leaf — callers fall back to `{ all: [] }` in that case.
   */
  function stripCondition(node, predicate) {
    if (!node) return node;
    if (isLeafCond(node)) return predicate(node) ? null : node;
    const key = 'all' in node ? 'all' : 'any';
    node[key] = (node[key] || []).map((c) => stripCondition(c, predicate)).filter((c) => c !== null);
    return node;
  }

  /**
   * Create a builder instance bound to a data source + change callbacks.
   * @param {object} config
   *   config.data() -> { stats, simstate, quests } live getter (each field optional; missing
   *                     namespaces simply contribute no options). Read fresh on every render so
   *                     newly-added variables/quests appear without re-creating the builder.
   *   config.onStructuralChange() -> called after any edit that changes the tree SHAPE or a leaf's
   *                     var/operator (the host must re-render the whole card — the value input type
   *                     may need to change). Mirrors the Quest Editor's markDirty + renderQuestEditor.
   *   config.onValueChange() -> called after a leaf's VALUE changes (no re-render needed). Mirrors
   *                     the Quest Editor's markDirty + renderValidation. Falls back to
   *                     onStructuralChange when omitted.
   * @returns {{ render(node, path): HTMLElement }}
   */
  function create(config) {
    const d = () => config.data() || {};
    const structural = () => { config.onStructuralChange && config.onStructuralChange(); };
    const valueChanged = () => {
      if (config.onValueChange) config.onValueChange();
      else if (config.onStructuralChange) config.onStructuralChange();
    };
    const needs = () => (d().stats && d().stats.needs) || [];
    const skills = () => (d().stats && d().stats.skills) || [];
    const variables = () => (d().simstate && d().simstate.variables) || [];
    const quests = () => (d().quests && d().quests.quests) || [];

    // ------------------------------------------------------------ var-path namespace helpers
    function describeVarPath(path) {
      if (path === 'funds' || path === 'time.hour' || path === 'time.day') return { kind: 'number' };
      if (path.startsWith('needs.') || path.startsWith('skills.')) return { kind: 'number' };
      if (path.startsWith('vars.')) {
        const v = variables().find((x) => x.id === path.slice(5));
        return { kind: 'var', varType: v ? v.type : 'string' };
      }
      const m = /^quests\.(.+)\.state$/.exec(path);
      if (m) return { kind: 'queststate', questId: m[1] };
      return { kind: 'unknown' };
    }
    function defaultVarPath() {
      if (needs().length) return 'needs.' + needs()[0].id;
      return 'funds';
    }
    function defaultValueFor(path, op, oldVal) {
      const info = describeVarPath(path);
      if (op === 'gte' || op === 'lte') return typeof oldVal === 'number' ? oldVal : 0;
      // eq / neq — any type
      if (info.kind === 'queststate') return ['locked', 'active', 'done'].includes(oldVal) ? oldVal : 'locked';
      if (info.kind === 'var') {
        if (info.varType === 'boolean') return typeof oldVal === 'boolean' ? oldVal : false;
        if (info.varType === 'number') return typeof oldVal === 'number' ? oldVal : 0;
        return typeof oldVal === 'string' ? oldVal : '';
      }
      return typeof oldVal === 'number' ? oldVal : 0;
    }
    function resetLeafOperatorAndValue(leaf, op) {
      const oldOp = getLeafOp(leaf);
      const oldVal = oldOp ? leaf[oldOp] : undefined;
      delete leaf.gte; delete leaf.lte; delete leaf.eq; delete leaf.neq;
      leaf[op] = defaultValueFor(leaf.var, op, oldVal);
    }
    function appendVarOptions(sel, currentValue) {
      sel.innerHTML = '';
      const groups = [
        ['Needs', needs().map((n) => ({ value: 'needs.' + n.id, label: n.name }))],
        ['Skills', skills().map((s) => ({ value: 'skills.' + s.id, label: s.name }))],
        ['Economy', [{ value: 'funds', label: 'Funds' }]],
        ['Time', [{ value: 'time.hour', label: 'Hour of day' }, { value: 'time.day', label: 'Day' }]],
        ['Variables', variables().map((v) => ({ value: 'vars.' + v.id, label: v.name }))],
        ['Quests', quests().map((q) => ({ value: 'quests.' + q.id + '.state', label: q.name + ' (state)' }))],
      ];
      const known = new Set();
      for (const [label, opts] of groups) {
        if (!opts.length) continue;
        const og = document.createElement('optgroup'); og.label = label;
        for (const o of opts) {
          const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label;
          og.appendChild(opt); known.add(o.value);
        }
        sel.appendChild(og);
      }
      if (currentValue && !known.has(currentValue)) {
        const og = document.createElement('optgroup'); og.label = 'Unknown (stale id)';
        const opt = document.createElement('option'); opt.value = currentValue; opt.textContent = currentValue;
        og.appendChild(opt); sel.appendChild(og);
      }
      sel.value = currentValue;
    }
    function valueInputFor(path, value, onChange, condPath) {
      const info = describeVarPath(path);
      let input;
      if (info.kind === 'queststate') {
        input = document.createElement('select');
        for (const s of ['locked', 'active', 'done']) { const o = document.createElement('option'); o.value = s; o.textContent = s; input.appendChild(o); }
        input.value = ['locked', 'active', 'done'].includes(value) ? value : 'locked';
        input.addEventListener('change', () => onChange(input.value));
      } else if (info.kind === 'var' && info.varType === 'boolean') {
        input = document.createElement('select');
        for (const b of ['true', 'false']) { const o = document.createElement('option'); o.value = b; o.textContent = b; input.appendChild(o); }
        input.value = String(!!value);
        input.addEventListener('change', () => onChange(input.value === 'true'));
      } else if (info.kind === 'number' || (info.kind === 'var' && info.varType === 'number')) {
        input = document.createElement('input'); input.type = 'number'; input.step = 'any';
        input.value = value === undefined || value === null ? '' : value;
        input.addEventListener('input', () => onChange(input.value === '' ? 0 : Number(input.value)));
      } else {
        input = document.createElement('input'); input.type = 'text';
        input.value = value === undefined || value === null ? '' : value;
        input.addEventListener('input', () => onChange(input.value));
      }
      input.dataset.role = 'value';
      input.dataset.condPath = condPath;
      return input;
    }

    // ------------------------------------------------------------ condition builder
    function renderConditionNode(node, path) {
      return isLeafCond(node) ? renderLeafRow(node, path) : renderGroupBox(node, path);
    }
    function renderGroupBox(node, path) {
      const key = 'all' in node ? 'all' : 'any';
      const box = document.createElement('div');
      box.className = 'cond-group';
      box.dataset.condPath = path;

      const head = document.createElement('div');
      head.className = 'cond-group-head';
      const sel = document.createElement('select');
      sel.dataset.role = 'combinator'; sel.dataset.condPath = path;
      for (const opt of ['all', 'any']) { const o = document.createElement('option'); o.value = opt; o.textContent = opt.toUpperCase(); sel.appendChild(o); }
      sel.value = key;
      sel.addEventListener('change', () => {
        const arr = node[key];
        delete node.all; delete node.any;
        node[sel.value] = arr;
        structural();
      });
      head.appendChild(sel);
      const hint = document.createElement('span');
      hint.className = 'cond-hint';
      hint.textContent = key === 'all' ? '(every child must hold; empty = vacuously TRUE)' : '(any child must hold; empty = FALSE — nothing to satisfy)';
      head.appendChild(hint);
      box.appendChild(head);

      const children = document.createElement('div');
      children.className = 'cond-children';
      node[key].forEach((child, i) => {
        const childPath = path + '.' + i;
        const wrap = document.createElement('div');
        wrap.className = 'cond-child';
        wrap.appendChild(renderConditionNode(child, childPath));
        const rm = document.createElement('button');
        rm.className = 'cond-remove'; rm.textContent = '× remove';
        rm.dataset.action = 'remove-cond'; rm.dataset.condPath = childPath;
        rm.addEventListener('click', () => {
          node[key].splice(i, 1);
          structural();
        });
        wrap.appendChild(rm);
        children.appendChild(wrap);
      });
      box.appendChild(children);

      const addRow = document.createElement('div');
      addRow.className = 'cond-add-row';
      const addLeaf = document.createElement('button');
      addLeaf.textContent = '+ Condition'; addLeaf.dataset.action = 'add-leaf'; addLeaf.dataset.condPath = path;
      addLeaf.addEventListener('click', () => {
        node[key].push({ var: defaultVarPath(), gte: 0 });
        structural();
      });
      const addGroup = document.createElement('button');
      addGroup.textContent = '+ Group'; addGroup.dataset.action = 'add-group'; addGroup.dataset.condPath = path;
      addGroup.addEventListener('click', () => {
        node[key].push({ all: [] });
        structural();
      });
      addRow.append(addLeaf, addGroup);
      box.appendChild(addRow);
      return box;
    }
    function renderLeafRow(leaf, path) {
      const row = document.createElement('div');
      row.className = 'cond-leaf';
      row.dataset.condPath = path;

      const varSel = document.createElement('select');
      varSel.className = 'cond-var-select';
      varSel.dataset.role = 'var'; varSel.dataset.condPath = path;
      appendVarOptions(varSel, leaf.var);
      varSel.addEventListener('change', () => {
        const op = getLeafOp(leaf) || 'gte';
        leaf.var = varSel.value;
        resetLeafOperatorAndValue(leaf, op);
        structural();
      });
      row.appendChild(varSel);

      const opSel = document.createElement('select');
      opSel.dataset.role = 'op'; opSel.dataset.condPath = path;
      for (const op of ['gte', 'lte', 'eq', 'neq']) { const o = document.createElement('option'); o.value = op; o.textContent = op; opSel.appendChild(o); }
      const currentOp = getLeafOp(leaf) || 'gte';
      opSel.value = currentOp;
      opSel.addEventListener('change', () => {
        resetLeafOperatorAndValue(leaf, opSel.value);
        structural();
      });
      row.appendChild(opSel);

      const valueWrap = document.createElement('div');
      valueWrap.appendChild(valueInputFor(leaf.var, leaf[currentOp], (v) => { leaf[currentOp] = v; valueChanged(); }, path));
      row.appendChild(valueWrap);

      // The remove button for this leaf is rendered by the parent group (renderGroupBox), which
      // knows the leaf's index in the combinator array and can splice it out.
      return row;
    }

    return { render: renderConditionNode };
  }

  window.ConditionBuilder = { create, isLeafCond, getLeafOp, anyLeaf, stripCondition };
})();
