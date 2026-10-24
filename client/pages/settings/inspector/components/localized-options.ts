import type {
  AuthorizationOptions,
  AuthorizationOptionsResponse,
  LocalizedText,
  ResourceGroupOption,
  ResourceOption,
  SelectOption,
} from '../model.js';
import { AUTHORIZATION_NAMESPACE, type Translate } from '../i18n.js';

/** Translates a server title in its own namespace, this plugin's by default. */
export function localizedText(value: LocalizedText, t: Translate): string {
  if (typeof value === 'string') return value;
  return t(value.key, {
    ns: value.ns ?? AUTHORIZATION_NAMESPACE,
    defaultValue: value.defaultValue ?? value.key,
  });
}

/** Turns an `options` response into the workspace model. */
export function localizeOptions(
  raw: AuthorizationOptionsResponse,
  t: Translate,
): AuthorizationOptions {
  const text = (value: LocalizedText): string => localizedText(value, t);
  const recordAccess = new Map(
    raw.recordAccess.map((entry) => [entry.key, text(entry.title)]),
  );
  const action = (entry: {
    name: string;
    title: LocalizedText;
  }): SelectOption => ({ value: entry.name, label: text(entry.title) });
  const groups = resourceGroupTree(raw.resourceGroups ?? [], text);
  return {
    sections: [...raw.sections]
      .sort((left, right) => left.order - right.order)
      .map((section) => ({
        value: section.name,
        label: text(section.title),
        order: section.order,
        subsections: section.subsections.map((subsection) => {
          const resources: ResourceOption[] = subsection.resources.map(
            (item) => ({
              type: item.type,
              value: item.id,
              label: text(item.title),
              ...(item.description === undefined
                ? {}
                : { description: text(item.description) }),
              ...(item.group === undefined ? {} : { group: item.group }),
              actions: item.actions.map(action),
              ...(item.dataScopes
                ? {
                    dataScopes: Object.fromEntries(
                      Object.entries(item.dataScopes).map(([name, scopes]) => [
                        name,
                        scopes.map((scope) => ({
                          key: scope.key,
                          label: text(scope.title),
                          collection: scope.collection,
                          collectionFields: scope.fields,
                          defaultValue: scope.defaultValue ?? '',
                          options: [
                            {
                              value: '',
                              label: t(
                                'authorizationInspector.labels.defaultAndSharing',
                              ),
                            },
                            ...scope.recordAccess.map((key) => ({
                              value: key,
                              label: recordAccess.get(key) ?? key,
                            })),
                          ],
                        })),
                      ]),
                    ),
                  }
                : {}),
            }),
          );
          const used = pruneGroups(
            groups,
            new Set(resources.flatMap((item) => item.group ?? [])),
          );
          return {
            value: subsection.name,
            label: text(subsection.title),
            ...(subsection.recordType
              ? { recordType: subsection.recordType.type }
              : {}),
            actions: uniqueActions(
              subsection.recordType
                ? subsection.recordType.actions.map(action)
                : resources.flatMap((item) => item.actions ?? []),
            ),
            groups: used,
            resources: inGroupOrder(used, resources),
          };
        }),
      })),
    subjectTypes: raw.subjectTypes.map((type) => ({
      value: type.type,
      label: text(type.title),
      selection: type.selection,
    })),
    collections: raw.collections,
    recordAccess: raw.recordAccess.map((entry) => ({
      value: entry.key,
      label: text(entry.title),
      collections: entry.collections,
      ...(entry.description === undefined
        ? {}
        : { description: text(entry.description) }),
    })),
  };
}

function uniqueActions(
  actions: readonly SelectOption[],
): readonly SelectOption[] {
  return [...new Map(actions.map((item) => [item.value, item])).values()];
}

/** Nests groups under their parents; siblings by `order`, then registration. */
function resourceGroupTree(
  groups: readonly {
    name: string;
    title: LocalizedText;
    parent?: string;
    order?: number;
  }[],
  text: (value: LocalizedText) => string,
): readonly ResourceGroupOption[] {
  const children = (parent?: string): readonly ResourceGroupOption[] =>
    groups
      .map((group, index) => ({ group, index }))
      .filter(({ group }) => group.parent === parent)
      .sort(
        (left, right) =>
          (left.group.order ?? 0) - (right.group.order ?? 0) ||
          left.index - right.index,
      )
      .map(({ group }) => {
        const nested = children(group.name);
        return {
          value: group.name,
          label: text(group.title),
          ...(nested.length ? { children: nested } : {}),
        };
      });
  return children(undefined);
}

/** The groups holding one of `names`, directly or through a descendant. */
function pruneGroups(
  groups: readonly ResourceGroupOption[],
  names: ReadonlySet<string>,
): readonly ResourceGroupOption[] {
  return groups.flatMap((group) => {
    const children = pruneGroups(group.children ?? [], names);
    if (!names.has(group.value) && !children.length) return [];
    return [
      {
        value: group.value,
        label: group.label,
        ...(children.length ? { children } : {}),
      },
    ];
  });
}

/** Ungrouped resources first, then each group's in tree order; stable otherwise. */
function inGroupOrder(
  groups: readonly ResourceGroupOption[],
  resources: readonly ResourceOption[],
): readonly ResourceOption[] {
  const position = new Map<string, number>();
  const visit = (nodes: readonly ResourceGroupOption[]): void => {
    for (const node of nodes) {
      position.set(node.value, position.size);
      visit(node.children ?? []);
    }
  };
  visit(groups);
  const rank = (item: ResourceOption): number =>
    item.group === undefined ? -1 : (position.get(item.group) ?? -1);
  return resources
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        rank(left.item) - rank(right.item) || left.index - right.index,
    )
    .map(({ item }) => item);
}
