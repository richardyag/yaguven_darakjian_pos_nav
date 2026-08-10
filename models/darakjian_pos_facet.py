# -*- coding: utf-8 -*-
from odoo import api, fields, models


class DarakjianPosFacet(models.Model):
    """Which product attributes are exposed as facets in the POS.

    It lives entirely inside this module: a many2one to the native product.attribute,
    with no fields added to native models. Loaded into the POS through pos.load.mixin.
    """

    _name = "darakjian.pos.facet"
    _description = "Darakjian POS Facet"
    _inherit = ["pos.load.mixin"]
    _order = "sequence, id"

    attribute_id = fields.Many2one(
        "product.attribute",
        string="Attribute",
        required=True,
        ondelete="cascade",
        help="Native attribute offered as a filtering facet in the POS.",
    )
    label = fields.Char(
        string="Label",
        help="Label shown in the POS. Left empty, the attribute name is used.",
    )
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    display_type = fields.Selection(
        [("chips", "Chips"), ("list", "List")],
        string="Display",
        default="chips",
        required=True,
        help="How the facet values are shown: as chips or as a list.",
    )

    _sql_constraints = [
        ("attribute_uniq", "unique(attribute_id)",
         "That attribute is already configured as a facet."),
    ]

    @api.depends("attribute_id", "label")
    def _compute_display_name(self):
        for rec in self:
            rec.display_name = rec.label or (rec.attribute_id.name or "")

    # ---- loading into the POS (pos.load.mixin) ----
    # Odoo 19: the mixin signature is _load_pos_data_domain(self, data, config).
    @api.model
    def _load_pos_data_domain(self, data, config):
        return [("active", "=", True)]

    @api.model
    def _load_pos_data_fields(self, config):
        return ["id", "attribute_id", "label", "sequence", "display_type"]
