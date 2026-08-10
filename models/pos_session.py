# -*- coding: utf-8 -*-
from odoo import api, fields, models


class ProductTemplate(models.Model):
    """Marca de prioridad para carga inicial del POS.

    Los templates con pos_load_priority=True se descargan al browser al abrir
    sesión (payload chico, POS arranca rápido).  El resto se carga en background
    por categoría una vez que el POS ya está operativo.

    El flag lo setea el script pos_set_priority.py: top-20 por ventas (v16)
    por pos.category.  Sin campo almacenado → sin huérfanos al desinstalar (C.2)
    no aplica acá porque necesitamos filtrar en dominio; se documenta el impacto.
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
        """Carga inicial del POS: solo templates con pos_load_priority=True.

        La grilla del POS de O19 lista por product.template, así que filtrar
        acá es lo que efectivamente reduce el payload y el tiempo de cómputo
        server-side del arranque.  El resto de templates los trae el background
        loader por categoría vía el método nativo load_product_from_pos.

        Fallback: si no hay ningún prioritario marcado (campo aún sin setear),
        cae al dominio nativo para no dejar el POS vacío.
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
        """Añadir nuestros modelos al payload de sesión.

        AMBOS modelos deben estar presentes en pos.models del frontend aunque
        no haya facetas configuradas: el componente DarakjianFacetBar lee
        this.pos.models["product.attribute.value"] y ["darakjian.pos.facet"]
        en su getter `facets`.  Si falta cualquiera, getAll() sobre undefined
        crashea el lifecycle de OWL y tumba el POS entero.  El volumen se
        controla por dominio (_load_pos_data_domain), no quitando el modelo.
        """
        models_list = super()._load_pos_data_models(config_id)
        for model in ("darakjian.pos.facet", "product.attribute.value"):
            if model not in models_list:
                models_list += [model]
        return models_list

    # La carga on-demand de productos por categoría NO se resuelve con un método
    # custom: el background loader JS llama directamente al método nativo de O19
    # product.template.load_product_from_pos(config_id, domain), que devuelve
    # templates + variantes + taxes + atributos en el mismo formato que el
    # payload inicial (image_128 como bool → URL lazy) y se mergea con el
    # connectNewData nativo.  Así no reimplementamos formato ni merge: si un
    # upgrade de O19 cambia el shape del payload, el método nativo cambia con él.


class PosCategory(models.Model):
    """Cargar la jerarquía COMPLETA de categorías al POS.

    Nativo O19: con limit_categories=True, pos.category._load_pos_data_domain
    devuelve solo iface_available_categ_ids (las 16 configuradas) — sin sus
    ancestros ni descendientes.  El árbol vertical custom queda entonces sin la
    jerarquía y se ve plano frente a la vista de inventario (product.category).

    Override: devolver dominio vacío → cargar las 144 categorías con su árbol
    completo, espejando inventario.  Campos mínimos (id/name/parent_id/seq) →
    payload despreciable.  El selector nativo fue reemplazado por el árbol, así
    que limit_categories ya no cumple función de filtrado de UI acá.
    """

    _inherit = "pos.category"

    @api.model
    def _load_pos_data_domain(self, data, config):
        return []


class ProductAttributeValue(models.Model):
    """Solo los valores de los atributos configurados como faceta."""

    _name = "product.attribute.value"
    _inherit = ["product.attribute.value", "pos.load.mixin"]

    @api.model
    def _load_pos_data_domain(self, data, config):
        facet_attr_ids = (
            self.env["darakjian.pos.facet"].search([]).attribute_id.ids
        )
        if facet_attr_ids:
            return [("attribute_id", "in", facet_attr_ids)]
        # Sin facetas configuradas: dejar pasar el dominio nativo de O19 para
        # que el POS pueda renderizar variantes con sus atributos normalmente.
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
        """Restricción al arranque: solo variantes con pos_load_priority=True.

        Si no hay ninguna prioritaria (campo aún no seteado), cae al dominio
        nativo para no dejar el POS vacío.
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
