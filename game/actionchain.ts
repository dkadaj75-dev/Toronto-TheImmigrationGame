// actionchain.ts — pure authored prerequisite and completion-product resolution.

import type { ActionDef, AssetDef } from './data';

export interface RequiredAssetRule {
  assetId: string;
  /** Equivalent asset variants that can satisfy the same requirement (for example, old/new fridges). */
  alternativeAssetIds?: string[];
  radiusMeters: number;
  visitBefore?: boolean;
  visitAfter?: boolean;
}

export interface SpawnedAssetRule {
  assetId: string;
  actionId?: string;
  /** Preserve the existing cooked-meal quality curve without inferring semantics from action ids. */
  applyCookingSkill?: boolean;
}

export interface SpawnedProductFollowUp {
  carriedAsset?: { assetId: string };
}

export interface AssetCandidate<T = unknown> {
  assetId: string;
  pos: [number, number];
  value: T;
}

export interface RequiredAssetMatch<T = unknown> extends AssetCandidate<T> { distance: number }

/** Nearest matching live asset inside the target-centred authored radius. Ties keep world order. */
export function nearestRequiredAsset<T>(
  sourcePos: readonly [number, number],
  rule: RequiredAssetRule | undefined,
  candidates: readonly AssetCandidate<T>[],
): RequiredAssetMatch<T> | null {
  if (!rule?.assetId) return null;
  const acceptedIds = new Set([rule.assetId, ...(rule.alternativeAssetIds ?? [])]);
  const radius = Number.isFinite(rule.radiusMeters) ? Math.max(0, rule.radiusMeters) : 0;
  let best: RequiredAssetMatch<T> | null = null;
  for (const candidate of candidates) {
    if (!acceptedIds.has(candidate.assetId)) continue;
    const distance = Math.hypot(candidate.pos[0] - sourcePos[0], candidate.pos[1] - sourcePos[1]);
    if (distance > radius + 1e-9) continue;
    if (!best || distance < best.distance - 1e-9) best = { ...candidate, distance };
  }
  return best;
}

/** A requirement with neither visit flag is still a presence gate. */
export function requiresAssetPresence(rule: RequiredAssetRule | undefined): boolean {
  return !!rule?.assetId;
}

/** Runtime/tool validation for an authored automatic follow-up. */
export function resolvedFollowUpActionId(
  rule: SpawnedAssetRule | undefined,
  knownActionIds: ReadonlySet<string>,
): string | null {
  const id = rule?.actionId?.trim();
  return id && knownActionIds.has(id) ? id : null;
}

/** True when the follow-up's visible carry prop is the completion product itself. The runtime
 * must reuse that exact transient rather than spawning a duplicate generic prop. */
export function carriesSpawnedProduct(
  action: SpawnedProductFollowUp | undefined,
  spawnedAssetId: string,
): boolean {
  return !!spawnedAssetId && action?.carriedAsset?.assetId === spawnedAssetId;
}

export interface ActionConnectionIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ActionGraphIssue extends ActionConnectionIssue {
  actionId?: string;
  assetId?: string;
}

/** Cross-file integrity for the action/asset graph. Kept pure so runtime, tools, and tests can all
 * use one definition of a valid connection. Unknown ids are reported, never mutated away. */
export function actionConnectionIssues(
  action: ActionDef,
  actions: readonly ActionDef[],
  assets: readonly AssetDef[],
): ActionConnectionIssue[] {
  const issues: ActionConnectionIssue[] = [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const actionById = new Map(actions.map((entry) => [entry.id, entry]));
  const add = (level: ActionConnectionIssue['level'], code: string, message: string) => issues.push({ level, code, message });

  if (action.fetchBeforeSeat && !action.seatAware) {
    add('warning', 'fetch_without_seat', 'Fetch source before seating has no effect unless Seat aware is enabled.');
  }
  if (action.seatSearch && !action.seatAware) {
    add('warning', 'seat_search_without_seat', 'Seat selection has no effect unless Seat aware is enabled.');
  }
  if (action.consumesFood && action.discardsFood) {
    add('error', 'consume_and_discard', 'An action cannot both consume and discard its targeted food.');
  }
  if (action.requiredAsset) {
    if (!assetById.has(action.requiredAsset.assetId)) add('error', 'missing_required_asset', `Required asset "${action.requiredAsset.assetId}" does not exist.`);
    if (!Number.isFinite(action.requiredAsset.radiusMeters) || action.requiredAsset.radiusMeters < 0) {
      add('error', 'invalid_required_radius', 'Required-asset radius must be a finite non-negative number.');
    }
    const seen = new Set<string>();
    for (const id of action.requiredAsset.alternativeAssetIds ?? []) {
      if (id === action.requiredAsset.assetId || seen.has(id)) add('warning', 'duplicate_required_variant', `Required-asset variant "${id}" is duplicated.`);
      if (!assetById.has(id)) add('error', 'missing_required_variant', `Required-asset variant "${id}" does not exist.`);
      seen.add(id);
    }
  }
  if (action.carriedAsset) {
    const carried = assetById.get(action.carriedAsset.assetId);
    if (!carried) add('error', 'missing_carried_asset', `Carried asset "${action.carriedAsset.assetId}" does not exist.`);
    else if (carried.category !== 'transient') add('error', 'carried_asset_not_transient', `Carried asset "${carried.name}" must be transient.`);
    if (!action.carriedAsset.bone?.trim()) add('error', 'missing_carry_bone', 'Carried asset needs a character bone.');
  }
  if (action.spawnsAsset) {
    const product = assetById.get(action.spawnsAsset.assetId);
    if (!product) add('error', 'missing_spawned_asset', `Completion product "${action.spawnsAsset.assetId}" does not exist.`);
    else if (product.category !== 'transient') add('error', 'spawned_asset_not_transient', `Completion product "${product.name}" must be transient.`);
    const followUpId = action.spawnsAsset.actionId?.trim();
    if (followUpId) {
      const followUp = actionById.get(followUpId);
      if (!followUp) add('error', 'missing_follow_up', `Automatic action "${followUpId}" does not exist.`);
      if (product && !product.interactions.includes(followUpId)) {
        add('error', 'follow_up_not_offered', `"${product.name}" does not offer automatic action "${followUpId}".`);
      }
      if (followUp?.consumesFood && product && !product.food) {
        add('error', 'food_follow_up_on_non_food', `Automatic action "${followUp.name}" consumes food, but "${product.name}" has no Food settings.`);
      }
      if (followUp?.carriedAsset && product && followUp.carriedAsset.assetId !== product.id) {
        add('warning', 'follow_up_carries_other_asset', `Automatic action "${followUp.name}" carries a different asset; the spawned ${product.name} will remain in the world.`);
      }
    }
    if (action.spawnsAsset.applyCookingSkill && product && !product.food) {
      add('warning', 'cooking_scale_on_non_food', 'Cooking-skill quality scaling has no effect on a non-food completion product.');
    }
  }
  if (action.containerTransfer?.mode === 'deposit') {
    const container = assetById.get(action.containerTransfer.containerAssetId);
    if (!container) add('error', 'missing_deposit_container', `Deposit container "${action.containerTransfer.containerAssetId}" does not exist.`);
    else if (container.category === 'transient') add('error', 'deposit_container_is_transient', `Deposit container "${container.name}" cannot be transient.`);
    else if (!(Number.isFinite(container.container?.capacity) && (container.container?.capacity ?? 0) > 0)
      && !(Number.isFinite(container.garbage?.capacity) && (container.garbage?.capacity ?? 0) > 0)) {
      add('error', 'deposit_target_not_container', `"${container.name}" needs a positive Container capacity.`);
    }
  } else if (action.containerTransfer?.mode === 'empty') {
    const destination = assetById.get(action.containerTransfer.destinationAssetId);
    if (!destination) add('error', 'missing_empty_destination', `Emptying destination "${action.containerTransfer.destinationAssetId}" does not exist.`);
    else if (destination.category === 'transient') add('error', 'empty_destination_is_transient', `Emptying destination "${destination.name}" cannot be transient.`);
  }
  return issues;
}

/** Whole-graph audit used at load/hot reload. Asset-owned links are checked here; every linked
 * action is then checked by actionConnectionIssues so tools and runtime report identical faults. */
export function actionGraphIssues(
  actions: readonly ActionDef[],
  assets: readonly AssetDef[],
): ActionGraphIssue[] {
  const issues: ActionGraphIssue[] = [];
  const actionIds = new Set(actions.map((action) => action.id));
  for (const asset of assets) {
    if (asset.container) {
      if (asset.category === 'transient') issues.push({ level: 'error', code: 'transient_is_container', assetId: asset.id, message: `Transient "${asset.name}" cannot be a container.` });
      if (!Number.isFinite(asset.container.capacity) || asset.container.capacity <= 0) issues.push({ level: 'error', code: 'invalid_container_capacity', assetId: asset.id, message: `Container "${asset.name}" needs a finite capacity greater than zero.` });
    }
    if (asset.containerSpace !== undefined) {
      if (asset.category !== 'transient') issues.push({ level: 'error', code: 'space_on_non_transient', assetId: asset.id, message: `Only transient assets can occupy container space; "${asset.name}" is not transient.` });
      if (!Number.isFinite(asset.containerSpace) || asset.containerSpace <= 0) issues.push({ level: 'error', code: 'invalid_container_space', assetId: asset.id, message: `"${asset.name}" needs finite container space greater than zero.` });
    }
    const seen = new Set<string>();
    for (const actionId of asset.interactions ?? []) {
      if (seen.has(actionId)) issues.push({ level: 'warning', code: 'duplicate_asset_action', assetId: asset.id, actionId, message: `Asset "${asset.name}" links action "${actionId}" more than once.` });
      else if (!actionIds.has(actionId)) issues.push({ level: 'error', code: 'missing_asset_action', assetId: asset.id, actionId, message: `Asset "${asset.name}" links missing action "${actionId}".` });
      const linkedAction = actions.find((entry) => entry.id === actionId);
      if (linkedAction?.containerTransfer?.mode === 'deposit') {
        // Reusable actions may remain linked to an inapplicable ordinary asset in designer data;
        // runtime availability hides that action there. Only an actual transient target needs
        // authored space, so unrelated legacy links do not turn an otherwise valid graph noisy.
        if (asset.category === 'transient' && (!Number.isFinite(asset.containerSpace) || (asset.containerSpace ?? 0) <= 0)) {
          issues.push({ level: 'error', code: 'deposit_target_missing_space', assetId: asset.id, actionId, message: `Transient "${asset.name}" needs positive Container space for deposit action "${linkedAction.name}".` });
        }
      } else if (linkedAction?.containerTransfer?.mode === 'empty') {
        const capacity = asset.container?.capacity ?? asset.garbage?.capacity;
        if (asset.category === 'transient' || !Number.isFinite(capacity) || (capacity ?? 0) <= 0) issues.push({ level: 'error', code: 'empty_on_non_container', assetId: asset.id, actionId, message: `Empty action "${linkedAction.name}" must be offered by a container asset.` });
      }
      seen.add(actionId);
    }
  }
  for (const action of actions) {
    for (const issue of actionConnectionIssues(action, actions, assets)) issues.push({ ...issue, actionId: action.id });
  }
  return issues;
}

/** Plain-language sequence used by the editor to make ownership and ordering obvious. */
export function describeActionFlow(
  action: ActionDef,
  actions: readonly ActionDef[],
  assets: readonly AssetDef[],
): string[] {
  const assetName = (id: string) => assets.find((asset) => asset.id === id)?.name ?? id;
  const steps: string[] = [];
  const requirement = action.requiredAsset;
  if (requirement?.visitBefore) steps.push(`Visit ${assetName(requirement.assetId)}`);
  else if (requirement) steps.push(`Check for ${assetName(requirement.assetId)} nearby`);
  if (action.seatAware) steps.push(action.seatSearch === 'nearest' ? 'Find nearest seat' : 'Find a target-facing seat');
  steps.push(`Perform ${action.name}`);
  if (requirement?.visitAfter) steps.push(`Visit ${assetName(requirement.assetId)}`);
  if (action.spawnsAsset) {
    const productName = assetName(action.spawnsAsset.assetId);
    steps.push(`Create ${productName}`);
    const followUp = actions.find((entry) => entry.id === action.spawnsAsset?.actionId);
    if (followUp) {
      steps.push(carriesSpawnedProduct(followUp, action.spawnsAsset.assetId)
        ? `Automatically ${followUp.name} using that same ${productName}`
        : `Automatically ${followUp.name}`);
    } else if (!action.spawnsAsset.actionId) steps.push(`Leave ${productName} in the world`);
  }
  if (action.containerTransfer?.mode === 'deposit') {
    const containerName = assetName(action.containerTransfer.containerAssetId);
    steps.push(`Carry the targeted transient to ${containerName}`);
    steps.push(`Deposit it into ${containerName}`);
  } else if (action.containerTransfer?.mode === 'empty') {
    const destinationName = assetName(action.containerTransfer.destinationAssetId);
    steps.push('Collect the targeted container contents');
    steps.push(`Carry them to ${destinationName}`);
    steps.push('Empty that container there');
  }
  return steps;
}
