# yaguven_darakjian_pos_nav

Odoo 19 module — **category navigation in the Point of Sale** for Darakjian Jewelers.

## What it does

* A **facet bar** driven by product attributes (metal, stone, type, price…), configured
  from the back office through `darakjian.pos.facet`, without touching a native model.
* A **vertical category tree** in an overlay, opened on demand, showing the full hierarchy
  without giving up the width of the product grid.
* A **breadcrumb** so the cashier always knows where in the tree they are standing.

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

## What it depends on

Stock Odoo only: `point_of_sale`. Everything is inheritance and patches over the native
OWL Point of Sale, with **no fields added to native models** other than the priority flag
described above.

## Checking it works

1. Open the register: the first screen should fill in a couple of seconds, not minutes.
2. The facet bar shows the attributes configured under **Point of Sale → Configuration →
   Darakjian Facets**. Removing them all should leave the POS working, just without facets.
3. The category overlay should show the same tree as **Inventory → Configuration →
   Product Categories**.

Yagüven C.G.
