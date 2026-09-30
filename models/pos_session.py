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
    def _load_pos_data_domain(self, data, config):
        """Initial POS load: only templates with pos_load_priority=True.

        The Odoo 19 POS grid lists by product.template, so filtering here is what
        actually shrinks the payload and the server-side computation at startup. The
        remaining templates arrive through the background loader, category by category,
        via the native load_product_from_pos.

        Fallback: when nothing is flagged as priority (the field has not been set yet),
        it falls back to the native domain so the POS is never left empty.
        """
        base_domain = super()._load_pos_data_domain(data, config)
        priority_count = self.search_count(
            [("pos_load_priority", "=", True), ("available_in_pos", "=", True)]
        )
        if priority_count == 0:
            return base_domain
        return base_domain + [("pos_load_priority", "=", True)]


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
        """Startup restriction: only variants with pos_load_priority=True.

        When none is flagged as priority (the field has not been set yet), it falls back
        to the native domain so the POS is never left empty.
        """
        base_domain = super()._load_pos_data_domain(data, config)
        priority_count = self.env["product.template"].search_count(
            [("pos_load_priority", "=", True), ("available_in_pos", "=", True)]
        )
        if priority_count == 0:
            return base_domain
        return base_domain + [("product_tmpl_id.pos_load_priority", "=", True)]

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
        return ["id", "product_id", "lot_id", "location_id", "quantity"]
