Add `imageUrl` and `categoryName` as optional fields to the `PosSearchItem` interface in `pos/types/pos.types.ts`.

Add a `listSellableProducts` method to `pos/services/pos.service.ts` that fetches all sellable products by calling `searchItems` with an empty search string.

Create a new `product-grid` component in `pos/components/product-grid/` that groups products by category, renders compact cards with product image, name, and price in a responsive CSS grid, dims out-of-stock products, and emits an `itemClick` event.

In `pos/pos.ts`, add a `gridProducts` signal, load products on init, wire grid clicks to the existing `addItem()` method, and reload the grid after `newSale()`.

In `pos/pos.html`, insert the product grid component between the scan/search bar and the cart on the left pane.
