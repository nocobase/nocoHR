/**
 * 行业内容包 (industry content packs): the industry-specific content that the
 * 持证上岗 mechanism (V4-14: a valid certificate grants a permission set,
 * shifts require certificates, the transfer check) works on. The mechanism is
 * industry-neutral and lives in licensed/; a pack brings the pages a
 * certificate unlocks, the business operation behind each, and the
 * permission set that grants it. An administrator turns packs on and off on
 * 设置 / 持证上岗; a new installation has none on.
 *
 * Adding a pack (医疗: 执业医师证 → 处方开具, say) is a new definition in
 * registry.ts with its page route in client/routes.ts (no navigation), its
 * composite resource registered by the HR provider, its server locale keys
 * under `industryPacks.<key>`, and the business endpoints asking
 * `IndustryPackService.assertOperation(kind)` first. Nothing else lists pages.
 */
import type { CreatePermissionSetInput } from '@nocobase/authorization/permission-sets';

/** A business operation only a certificate holder may perform, and the page it is performed on. */
export interface CertifiedOperation {
  /** The kind of operation record it writes (`demoBatchSignoffs.kind` for the manufacturing pack). */
  readonly kind: string;
  /** The page resource id the permission set grants. */
  readonly page: string;
  /** The page's client route (declared in client/routes.ts, without navigation). */
  readonly path: string;
  /** The page's display name: a server locale key in the `hr` namespace. */
  readonly titleKey: string;
  /** The composite resource and the action that records the operation. */
  readonly resource: string;
  readonly action: string;
  /** The permission set holding the page and the operation, created when the pack is turned on and missing. */
  readonly permissionSet: string;
  /** The set's definition; never applied over an existing set. */
  readonly permissionSetDefinition: () => CreatePermissionSetInput;
}

export interface IndustryPackDefinition {
  /** Stable key, stored in the `industryPacks` personnelSettings row. */
  readonly key: string;
  /** Server locale keys (`hr` namespace) of the pack's name and one-line description. */
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly operations: readonly CertifiedOperation[];
}
