# Graph Report - frontend  (2026-06-06)

## Corpus Check
- 78 files · ~45,745 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 675 nodes · 1412 edges · 28 communities (13 shown, 15 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3215db1f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]

## God Nodes (most connected - your core abstractions)
1. `Product` - 36 edges
2. `Pos` - 31 edges
3. `SupplierDetail` - 25 edges
4. `Location` - 24 edges
5. `UnitsRoster` - 23 edges
6. `AuditSession` - 22 edges
7. `CommissionSession` - 22 edges
8. `ProductForm` - 21 edges
9. `Products` - 20 edges
10. `StockMovements` - 19 edges

## Surprising Connections (you probably didn't know these)
- `Layout (App Shell Component)` --implements--> `Responsive App Shell (Rail + Drawer)`  [EXTRACTED]
  src/app/layout/layout.ts → src/app/layout/layout.html
- `Login Component` --implements--> `Keyboard-First Accessibility Pattern`  [EXTRACTED]
  src/app/modules/auth/login/login.ts → src/app/modules/auth/login/login.html
- `AssetWisePreset (PrimeNG Theme)` --conceptually_related_to--> `Keyboard-First Accessibility Pattern`  [INFERRED]
  src/app/theme/asset-wise-preset.ts → src/app/modules/auth/login/login.html
- `Layout (App Shell Component)` --implements--> `Signal-Based State Management`  [INFERRED]
  src/app/layout/layout.ts → src/app/modules/auth/services/auth.service.ts
- `authGuard (CanActivateFn)` --semantically_similar_to--> `guestGuard (CanActivateFn)`  [INFERRED] [semantically similar]
  src/app/modules/auth/guards/auth.guard.ts → src/app/modules/auth/guards/guest.guard.ts

## Hyperedges (group relationships)
- **Authentication Flow** — login_Login, authservice_AuthService, authmodel_AuthUser, authguard_authGuard, guestguard_guestGuard [EXTRACTED 0.95]
- **App Shell and Navigation** — layout_Layout, icon_LayoutIcon, categories_Categories, authservice_AuthService [EXTRACTED 0.85]
- **Bootstrap and Routing Configuration Chain** — main_bootstrap, appconfig_appConfig, approutes_routes, preset_AssetWisePreset [EXTRACTED 0.95]

## Communities (28 total, 15 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (15): App, appConfig, routes, authGuard(), guestGuard(), authInterceptor(), NavItem, NavSection (+7 more)

### Community 1 - "Community 1"
Cohesion: 0.16
Nodes (20): App (Root Component), appConfig (ApplicationConfig), Application Routes, authGuard (CanActivateFn), AuthUser / Login Models, AuthService, Categories Component, Shared Design Token Language (+12 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (30): DetailTab, NamedRecord, backendMessage(), httpErrorMessage(), LabelData, productToLabelData(), PrintLabelButton, FilterOption (+22 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (11): SupplierDetail, SuppliersService, Suppliers, platformMeta(), PlatformOption, Supplier, SUPPLIER_PLATFORMS, SupplierLink (+3 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (42): AuditDetail, AuditRow, OUTCOME_ORDER, STATUS_CHIPS, StatusChip, Tally, TALLY_TONE, InventoryAudit (+34 more)

### Community 7 - "Community 7"
Cohesion: 0.14
Nodes (4): Categories, CategoriesService, Category, CategoryRequest

### Community 9 - "Community 9"
Cohesion: 0.40
Nodes (4): Categories — Keyboard Shortcuts, Custom shortcut, Focus management (no keypress required), Quick reference

### Community 13 - "Community 13"
Cohesion: 0.07
Nodes (26): AssetWiseNiimbotBluetoothClient, bitmapToCanvas(), Channel, discoverChannel(), findChannel(), modelIdFromDeviceName(), NiimbotWebBluetoothPrinter, SERVICE_UUIDS (+18 more)

### Community 14 - "Community 14"
Cohesion: 0.08
Nodes (15): StockMovementDetail, NamedRecord, StockMovementRecord, StockMovementsService, StockMovements, MOVEMENT_TYPES, MovementDirection, movementTypeMeta() (+7 more)

### Community 20 - "Community 20"
Cohesion: 0.08
Nodes (28): environment, ApiResponse, PageMeta, PaginatedApiResponse, SalesPage, ProductUnitPage, ProductUnitsService, ProductPage (+20 more)

### Community 22 - "Community 22"
Cohesion: 0.15
Nodes (3): ProductUnitStatus, StatusFilterChip, UnitsRoster

### Community 23 - "Community 23"
Cohesion: 0.19
Nodes (13): SaleStatusBadge, TONE_CLASSES, SelectOption, CheckoutItem, paymentMethodMeta, ReceiptData, ReceiptItemData, SALE_STATUS_META (+5 more)

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (8): CartLine, TenderChip, PosService, CheckoutRequest, PAYMENT_METHODS, PosSearchItem, priceToCents(), SaleResult

## Knowledge Gaps
- **60 isolated node(s):** `NavItem`, `NavSection`, `NEW_SHORTCUTS`, `NamedRecord`, `StatusChip` (+55 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Product` connect `Community 3` to `Community 5`, `Community 6`, `Community 7`, `Community 11`, `Community 13`, `Community 14`, `Community 16`, `Community 20`?**
  _High betweenness centrality (0.144) - this node is a cross-community bridge._
- **Why does `httpErrorMessage()` connect `Community 3` to `Community 5`, `Community 6`, `Community 14`, `Community 23`, `Community 24`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **Why does `environment` connect `Community 20` to `Community 0`, `Community 3`, `Community 6`, `Community 7`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **What connects `NavItem`, `NavSection`, `NEW_SHORTCUTS` to the rest of the system?**
  _64 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.08534850640113797 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.07853107344632769 - nodes in this community are weakly interconnected._
- **Should `Community 5` be split into smaller, more focused modules?**
  _Cohesion score 0.06818181818181818 - nodes in this community are weakly interconnected._