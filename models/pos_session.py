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

        BOTH models have to be present in the frontend's pos.models even when no facets
        are configured: the DarakjianFacetBar component reads
        this.pos.models["product.attribute.value"] y ["darakjian.pos.facet"]
        in its `facets` getter. If either is missing, getAll() on undefined crashes the
        OWL lifecycle and takes the whole POS down. Volume is controlled through the
        domain (_load_pos_data_domain), never by dropping the model.
        """
        models_list = super()._load_pos_data_models(config_id)
        for model in ("darakjian.pos.facet", "product.attribute.value"):
            if model not in models_list:
                models_list += [model]
        return models_list

    # On-demand loading of products by category is NOT solved with a custom method: the
    # JS background loader calls the native Odoo 19 method directly,
    # product.template.load_product_from_pos(config_id, domain), que devuelve
    # which returns templates + variants + taxes + attributes in the same shape as
    # payload inicial (image_128 como bool → URL lazy) y se mergea con el
    # the native connectNewData expects. That way we reimplement neither the format nor
    # the merge: when an Odoo 19 upgrade changes the payload shape, the native method
    # changes with it.


class PosCategory(models.Model):
    """Load the COMPLETE category hierarchy into the POS.

    Nativo O19: con limit_categories=True, pos.category._load_pos_data_domain
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
    """Variantes en el POS: solo prioritarias al arranque; resto en background."""

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
