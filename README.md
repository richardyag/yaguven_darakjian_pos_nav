# yaguven_darakjian_pos_nav

Odoo 19 module — **category navigation in the Point of Sale** for Darakjian Jewelers.

## What it does

* A **facet bar** driven by product attributes (metal, stone, type, price…), configured
  from the back office through `darakjian.pos.facet`, without touching a native model.
* A **vertical category tree** in an overlay, opened on demand, showing the full hierarchy
  without giving up the width of the product grid.
* A **breadcrumb** so the cashier always knows where in the tree they are standing.
* A **Case/Serial picker**, so a sale can be tied to the exact physical piece and case it
  came from — see "Case/Serial picker" below.

Responsive by design: enlarged touch targets on tablet (`pointer: coarse`) and a dense
view on desktop.

## Why the catalog had to be loaded differently

The store has around **17,700 templates and 25,500 variants**. Odoo's Point of Sale loads
its catalog into the browser when the session opens, and at that size the register takes
too long to become usable.

The module splits the load in two:

* **`pos_load_priority`** on `product.template` marks what goes in the initial payload —
  the top 20 by sales per POS category, taken from v16. Small payload, fast start.
* Everything else arrives **in the background, category by category**, through the native
  `product.template.load_product_from_pos`.

`pos_load_priority` is a **stored** field. Stored fields are normally avoided here because
they leave orphan columns behind on uninstall; this one is unavoidable, since the value has
to be filterable inside a domain. The trade-off is recorded in the code rather than hidden.

**The background loader calls the native method, not one of ours.** That way we reimplement
neither the payload format nor the merge, and an Odoo upgrade that changes the shape carries
the module with it.

## Two things that will crash the POS if changed carelessly

* **Both `darakjian.pos.facet` and `product.attribute.value` must reach the frontend**,
  even when no facet is configured. The facet bar reads them in its `facets` getter; if
  either is missing, `getAll()` on `undefined` breaks the OWL lifecycle and takes the whole
  register down. Volume is controlled through the domain, never by dropping the model.
* **`pos.category` loads the complete hierarchy** (empty domain, all 144 categories). With
  `limit_categories=True` the native domain returns only the configured categories without
  their ancestors, and the vertical tree is left flat. The fields loaded are minimal
  (`id/name/parent_id/sequence`), so the payload cost is negligible.

Both fall back to the native behavior when nothing is configured, so the POS is never left
empty.

## Case picker

Native Odoo reserves stock for a sale silently, against whatever case has the quantity —
the cashier never sees or chooses which one. That is invisible-but-correct for the ~97%
of the catalog that only has stock in one case at a time, but for the rest (the same
product on hand in more than one case) there is no way to say which physical piece was
actually sold, and no native screen shows the case at all.

There is no separate button: clicking a product card behaves exactly as before for the
common case (0 or 1 unit on hand - just gets added). Only when a **non-tracked**
product (`tracking="none"`) has **more than one unit on hand today** does a panel open
instead, scoped to that one product, listing only the cases that currently hold it
(name + real quantity). Picking one adds the product straight to the order from that
case - one click is the whole interaction.

**Serial/lot-tracked products never open this panel, on purpose.** An earlier version
also let the cashier pre-pick a serial here, which would lock the case the same way a
native lot selection does - but native Odoo asks for the lot/serial of its own accord
right after anyway, so that step only duplicated a prompt the cashier would see a
second time. Dropped rather than kept as a "shortcut": for tracked products, native
Odoo already resolves the case correctly from the lot via `pack_lot_ids`, with nothing
of ours involved at all.

The override lives in `ProductScreen.addProductToOrder` (native:
`point_of_sale/app/screens/product_screen/product_screen.js`) — see
`PosStore.darakjianNeedsCasePicker` in `store.js` for the on/off decision (non-tracked
AND more than one unit on hand).

For non-tracked products - most rings, for instance - this is the only way to pin a
sale to a specific case at all, since Odoo has nothing else to go on for them:
`models/pos_order_line.py` adds `darakjian_source_location_id` for that, and
`models/stock_picking.py` overrides `_create_move_from_pos_order_lines` /
`_prepare_stock_move_vals` (native: `point_of_sale/models/stock_picking.py`) to route
that line's stock move to the chosen case instead of letting the default reservation
pick across the whole warehouse.

## Stock gate: only sellable products show up

Native Odoo reserves silently against whatever case has quantity, but when a product
has **zero stock anywhere**, there is nothing to reserve — the sale still goes through
the product screen, and only fails at payment, with Odoo's own "you cannot take
products from or deliver products to a location of type 'view' (WWH)" error (WWH, the
warehouse root, is a `view` location; the fallback has nowhere real to pull from).

`ProductTemplate._darakjian_stock_ids()` answers "what actually has positive stock in
an internal location right now" with one indexed SQL query (not cached — stock changes
constantly, a stale answer here is worse than a slower query). It gates passive
discovery, never a deliberate lookup:

* The initial priority payload (`_load_pos_data_domain` on `product.template` and
  `product.product`) — always gated.
* The background per-category loader (`store.js` `darakjianLoadCateg`) — gated, via a
  `darakjian_apply_stock_gate` context key it sets on its own call.
* The native text search ("Search more") — **never gated**, even though it calls the
  exact same `load_product_from_pos` method. Browsing a category is passive discovery
  (nothing to show if there is nothing to sell); searching by name/SKU is a deliberate
  lookup that must still find a zero-stock product on purpose - e.g. to quote it or
  follow up on it (see the "sell without stock" proposal). The context key is what
  tells the two calls apart server-side, since the method itself cannot otherwise know
  which caller it came from.

Products with `is_storable=False` (services, combos, anything Odoo does not track
stock for at all) are always exempt from the gate — they never have a quant to check
in the first place, and must stay sellable regardless.

## Stock badge on the product card

A small badge on each card shows the total on hand across every case (the same
`stock.quant` data the Case/Serial picker already uses) - so typing a quantity higher
than what exists shows a number to check against, instead of only the native qty-turns-
red feedback with no indication of how many are actually available. Hidden entirely for
non-tracked products (`is_storable=False`) - there is nothing meaningful to count there.

Required a prop added to the *native* `ProductCard` component
(`overrides/product_card.js`), not just the template: OWL validates props strictly, so
passing `darakjianStockQty` from `product_screen.xml` without declaring it on
`ProductCard.props` throws "unknown prop" instead of silently working.

## What it depends on

Stock Odoo only: `point_of_sale` (which itself depends on `stock`). Everything is
inheritance and patches over the native OWL Point of Sale. Two things now touch native
models beyond the `pos_load_priority` flag: `darakjian_source_location_id` on
`pos.order.line` (see above), and `stock.quant`/`stock.location` gaining the
`pos.load.mixin` so the picker has data to work with — no other native field or
behavior is modified.

## Checking it works

1. Open the register: the first screen should fill in a couple of seconds, not minutes.
2. The facet bar shows the attributes configured under **Point of Sale → Configuration →
   Darakjian Facets**. Removing them all should leave the POS working, just without facets.
3. The category overlay should show the same tree as **Inventory → Configuration →
   Product Categories**.
4. Case picker:
   - Click a non-tracked product that only has one unit on hand — should add straight
     to the order, no popup, exactly like before this module existed.
   - Click a non-tracked product with more than one unit on hand — the picker should
     open, scoped to that product's name, listing each case with its real quantity.
   - Click a serial/lot-tracked product, even with several units on hand across
     different cases — the picker should NOT open at all; native Odoo's own
     lot/serial flow takes over.
   - After the sale, check the resulting delivery in the backend: for an item picked by
     case, the stock move should show that exact case as its source, not the default one
     Odoo would have picked.

Yagüven C.G.
