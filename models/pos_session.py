# -*- coding: utf-8 -*-
from odoo import api, fields, models


class ProductTemplate(models.Model):
    """Priority flag for the initial POS load.

    Templates with pos_load_priority=True are pushed to the browser when the session
    opens - a small payload, so the POS starts fast. The rest is loaded in the
    background, category by category, once the POS is already usable.

    The flag is set by pos_set_priority.py: the top 20 by sales (from v16) per
    pos.category. This is a stored field, which we normally avoid because it leaves
    orphans behind on uninstall; here it is unavoidable, since the value has to be
    filterable in a domain. The trade-off is recorded rather than hidden.
    """

    _inherit = "product.template"

    pos_load_priority = fields.Boolean(
        string="POS Priority Load",
        store=True,
        default=False,
        help="When set, the product is part of the initial POS load. The rest are "
             "loaded in the background, category by category.",
    )

    @api.model
    def _darakjian_stock_ids(self):
        """Templates and variants that currently have positive stock in some internal
        location - the set of things it is actually possible to sell and deliver today.

        Raw SQL on purpose: this runs on every category load/search, so it has to stay
        a single indexed query, not an ORM read_group plus Python aggregation. Not
        ormcache'd - stock changes constantly and a stale "has stock" answer is worse
        than a slightly slower query (see the Case/Serial picker's quant usage for the
        same freshness tradeoff).
        """
        self.env.cr.execute("""
            SELECT DISTINCT pp.id, pp.product_tmpl_id
            FROM stock_quant sq
            JOIN product_product pp ON pp.id = sq.product_id
            JOIN stock_location sl ON sl.id = sq.location_id
            WHERE sl.usage = 'internal' AND sq.quantity > 0
        """)
        rows = self.env.cr.fetchall()
        variant_ids = [r[0] for r in rows]
        tmpl_ids = list({r[1] for r in rows})
        return tmpl_ids, variant_ids

    @api.model
    def _load_pos_data_domain(self, data, config):
        """Initial POS load: only templates with pos_load_priority=True, and only
        products that can actually be sold - in stock, or not stock-tracked at all
        (services, combos: is_storable=False never has a quant and must stay visible).

        The Odoo 19 POS grid lists by product.template, so filtering here is what
        actually shrinks the payload and the server-side computation at startup. The
        remaining templates arrive through the background loader, category by category,
        via the native load_product_from_pos (filtered the same way below).

        Fallback: when nothing is flagged as priority (the field has not been set yet),
        it falls back to the native domain so the POS is never left empty.
        """
        base_domain = super()._load_pos_data_domain(data, config)
        priority_count = self.search_count(
            [("pos_load_priority", "=", True), ("available_in_pos", "=", True)]
        )
        if priority_count > 0:
            base_domain = base_domain + [("pos_load_priority", "=", True)]
        tmpl_ids, _ = self._darakjian_stock_ids()
        return base_domain + ["|", ("is_storable", "=", False), ("id", "in", tmpl_ids)]

    @api.model
    def _load_pos_data_fields(self, config):
        """is_storable has to reach the frontend: the stock badge on the product card
        (store.js darakjianStockQty) uses it to tell "0 in stock" apart from "never
        tracked" (services), and to skip the count entirely for the latter. tracking
        is what darakjianNeedsCasePicker uses to stay out of the way of serial/lot
        tracked products, which native Odoo already handles on its own."""
        fields_ = super()._load_pos_data_fields(config)
        for field in ("is_storable", "tracking"):
            if field not in fields_:
                fields_ = list(fields_) + [field]
        return fields_

    @api.model
    def load_product_from_pos(self, config_id, domain, offset=0, limit=0):
        """Background per-category loader AND native text search ("Search more") call
        this exact method (see store.js darakjianLoadCateg and the native
        product_screen.js loadProductFromDB) - but only the former should ever hide a
        zero-stock product. Browsing a category is passive discovery (nothing to show
        if there is nothing to sell, and it is also what stops a product failing at
        payment with Odoo's own "cannot take products from a location of type 'view'"
        error - WWH has no stock to reserve from). Searching by name/SKU is a
        deliberate lookup - e.g. to quote or follow up on something not on hand today
        - and must keep finding it.

        darakjianLoadCateg is the only caller that sets this context key; native
        search never does, so it is never gated.
        """
        if self.env.context.get("darakjian_apply_stock_gate"):
            tmpl_ids, _ = self.env["product.template"]._darakjian_stock_ids()
            domain = list(domain) + ["|", ("is_storable", "=", False), ("id", "in", tmpl_ids)]
        return super().load_product_from_pos(config_id, domain, offset, limit)


class PosSession(models.Model):
    _inherit = "pos.session"

    def _load_pos_data_models(self, config_id):
        """Add our own models to the session payload.

        ALL of these have to be present in the frontend's pos.models even when unused
        (no facets configured, no case picked yet): the components read
        this.pos.models["product.attribute.value"], ["darakjian.pos.facet"],
        ["stock.quant"] and ["stock.location"] directly. If any is missing, getAll() on
        undefined crashes the OWL lifecycle and takes the whole POS down. Volume is
        controlled through each model's own _load_pos_data_domain, never by dropping it.
        """
        models_list = super()._load_pos_data_models(config_id)
        for model in (
            "darakjian.pos.facet",
            "product.attribute.value",
            "stock.quant",
            "stock.location",
            "stock.lot",
        ):
            if model not in models_list:
                models_list += [model]
        return models_list

    # On-demand loading of products by category is NOT solved with a custom method: the
    # JS background loader calls the native Odoo 19 method directly,
    # product.template.load_product_from_pos(config_id, domain), which returns
    # templates + variants + taxes + attributes in the same shape as the initial payload
    # (image_128 as a bool -> lazy URL) and is merged through the native connectNewData.
    # That way we reimplement neither the format nor the merge: when an Odoo 19 upgrade
    # changes the payload shape, the native method changes with it.


class PosCategory(models.Model):
    """Load the COMPLETE category hierarchy into the POS.

    Native O19: with limit_categories=True, pos.category._load_pos_data_domain
    returns only iface_available_categ_ids (the 16 configured ones), without their
    ancestors or descendants. The custom vertical tree is then left with no hierarchy
    and looks flat next to the inventory view (product.category).

    Override: return an empty domain, loading all 144 categories with their full tree,
    mirroring inventory. With minimal fields (id/name/parent_id/sequence) the payload is
    negligible. The native selector was replaced by the tree, so limit_categories no
    longer serves any UI filtering purpose here.
    """

    _inherit = "pos.category"

    @api.model
    def _load_pos_data_domain(self, data, config):
        return []


class ProductAttributeValue(models.Model):
    """Only the values of the attributes configured as facets."""

    _name = "product.attribute.value"
    _inherit = ["product.attribute.value", "pos.load.mixin"]

    @api.model
    def _load_pos_data_domain(self, data, config):
        facet_attr_ids = (
            self.env["darakjian.pos.facet"].search([]).attribute_id.ids
        )
        if facet_attr_ids:
            return [("attribute_id", "in", facet_attr_ids)]
        # No facets configured: let the native Odoo 19 domain through so the POS can
        # still render variants with their attributes as usual.
        return super()._load_pos_data_domain(data, config)

    @api.model
    def _load_pos_data_fields(self, config):
        return ["id", "name", "attribute_id", "sequence", "html_color"]


class ProductProduct(models.Model):
    """POS variants: priority ones at startup, the rest in the background."""

    _inherit = "product.product"

    darakjian_facet_values = fields.Json(
        string="Darakjian POS facet values",
        compute="_compute_darakjian_facet_values",
        store=False,
    )

    def _compute_darakjian_facet_values(self):
        facet_attr_ids = (
            self.env["darakjian.pos.facet"].search([]).attribute_id.ids
        )
        if not facet_attr_ids:
            for p in self:
                p.darakjian_facet_values = {}
            return
        tmpl_ids = self.product_tmpl_id.ids
        lines = self.env["product.template.attribute.line"].search(
            [
                ("product_tmpl_id", "in", tmpl_ids),
                ("attribute_id", "in", facet_attr_ids),
            ]
        )
        by_tmpl = {}
        for line in lines:
            slot = by_tmpl.setdefault(line.product_tmpl_id.id, {})
            slot[str(line.attribute_id.id)] = line.value_ids.ids
        for p in self:
            p.darakjian_facet_values = by_tmpl.get(p.product_tmpl_id.id, {})

    @api.model
    def _load_pos_data_domain(self, data, config):
        """Startup restriction: only variants with pos_load_priority=True, and only
        variants that are in stock or not stock-tracked - same gate as
        ProductTemplate._load_pos_data_domain, kept in sync with it on purpose.

        When none is flagged as priority (the field has not been set yet), it falls back
        to the native domain so the POS is never left empty.
        """
        base_domain = super()._load_pos_data_domain(data, config)
        priority_count = self.env["product.template"].search_count(
            [("pos_load_priority", "=", True), ("available_in_pos", "=", True)]
        )
        if priority_count > 0:
            base_domain = base_domain + [("product_tmpl_id.pos_load_priority", "=", True)]
        _, variant_ids = self.env["product.template"]._darakjian_stock_ids()
        return base_domain + [
            "|", ("product_tmpl_id.is_storable", "=", False), ("id", "in", variant_ids)
        ]

    @api.model
    def _load_pos_data_fields(self, config):
        flds = super()._load_pos_data_fields(config)
        if "darakjian_facet_values" not in flds:
            flds = list(flds) + ["darakjian_facet_values"]
        return flds


class StockLocation(models.Model):
    """The list of cases, for the Case/Serial picker's Case dropdown.

    Domain kept broad (any internal location) on purpose: which ones actually have
    stock today is a client-side cross-reference against the stock.quant payload
    below, not a second server round-trip every time stock moves.
    """

    _name = "stock.location"
    _inherit = ["stock.location", "pos.load.mixin"]

    @api.model
    def _load_pos_data_domain(self, data, config):
        return [("usage", "=", "internal")]

    @api.model
    def _load_pos_data_fields(self, config):
        return ["id", "name", "complete_name"]


class StockLot(models.Model):
    """Serial/lot names, for the Case/Serial picker's serial rows and search.

    Without this, item.lot_id on the frontend stays an unresolved id with no .name -
    the picker's rows showed "SN" with nothing after it, because stock.lot was never
    registered as a pos.load.mixin model even though stock.quant.lot_id points to it.
    Scoped to lots that are actually in an on-hand quant right now - same restriction
    as StockQuant's own domain below, so the payload stays proportional to what the
    picker can actually show, not the whole lot history of the warehouse.
    """

    _name = "stock.lot"
    _inherit = ["stock.lot", "pos.load.mixin"]

    @api.model
    def _load_pos_data_domain(self, data, config):
        self.env.cr.execute("""
            SELECT DISTINCT sq.lot_id
            FROM stock_quant sq
            JOIN stock_location sl ON sl.id = sq.location_id
            WHERE sl.usage = 'internal' AND sq.quantity > 0 AND sq.lot_id IS NOT NULL
        """)
        lot_ids = [row[0] for row in self.env.cr.fetchall()]
        return [("id", "in", lot_ids)]

    @api.model
    def _load_pos_data_fields(self, config):
        return ["id", "name"]


class StockQuant(models.Model):
    """On-hand quantities per case, for the Case/Serial picker.

    This is what lets the picker (a) list only cases that actually have something
    today, and (b) resolve a scanned/typed serial to its case without a server
    round-trip. Restricted to positive quantities in internal locations - no point
    shipping the empty rows or the virtual-location noise (Vendors, Customers,
    Inventory adjustment) to every POS session.
    """

    _name = "stock.quant"
    _inherit = ["stock.quant", "pos.load.mixin"]

    @api.model
    def _load_pos_data_domain(self, data, config):
        return [
            ("location_id.usage", "=", "internal"),
            ("quantity", ">", 0),
        ]

    @api.model
    def _load_pos_data_fields(self, config):
        # reserved_quantity has to reach the frontend: the stock badge and the Case
        # picker both need "available" (quantity - reserved_quantity), not raw
        # on-hand - a case can show 1 unit on hand while another order (even an
        # unrelated, stuck one) already has it reserved, and offering it as sellable
        # leads straight to the same "cannot take products from a location of type
        # view" error once reservation finds nothing actually free.
        return ["id", "product_id", "lot_id", "location_id", "quantity", "reserved_quantity"]
