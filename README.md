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

## Case/Serial picker

Native Odoo reserves stock for a sale silently, against whatever case has the quantity —
the cashier never sees or chooses which one. That is invisible-but-correct for the ~97%
of the catalog that only has stock in one case at a time, but for the rest (the same
product on hand in more than one case) there is no way to say which physical piece was
actually sold, and no native screen shows the case at all.

There is no separate button: clicking a product card behaves exactly as before for the
common case (0 or 1 unit on hand - just gets added). Only when that specific product has
**more than one unit on hand today** does a panel open instead, scoped to that one
product, with two linked fields:

* **Serial Number** — typing or scanning a serial that is in stock jumps straight to the
  case it lives in (a serial only exists in one place, so once it is known there is
  nothing left to choose).
* **Case** — only lists cases that currently hold THIS product. Picking one lists what's
  physically there; items without a serial are sold straight from that case.

The override lives in `ProductScreen.addProductToOrder` (native:
`point_of_sale/app/screens/product_screen/product_screen.js`) — see
`PosStore.darakjianNeedsCasePicker` in `store.js` for the on/off decision.

For serial-tracked products this is mostly a shortcut over what native Odoo can already
do (`pack_lot_ids` already resolves the correct case from the lot). For non-tracked
products — most rings, for instance — this is the only way to pin a sale to a specific
case at all: `models/pos_order_line.py` adds `darakjian_source_location_id` for that,
and `models/stock_picking.py` overrides `_create_move_from_pos_order_lines` /
`_prepare_stock_move_vals` (native: `point_of_sale/models/stock_picking.py`) to route
that line's stock move to the chosen case instead of letting the default reservation
pick across the whole warehouse.

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
4. Case/Serial picker:
   - Click a product that only has one unit on hand — should add straight to the order,
     no popup, exactly like before this module existed.
   - Click a product with more than one unit on hand — the picker should open, scoped to
     that product's name.
   - Inside it, type a serial that's on hand — the Case field should lock to the right
     one automatically.
   - Pick a case with more than one item instead — only what's really there for that
     product should be listed, and picking a non-serial item should not ask for one.
   - After the sale, check the resulting delivery in the backend: for an item picked by
     case, the stock move should show that exact case as its source, not the default one
     Odoo would have picked.

Yagüven C.G.
