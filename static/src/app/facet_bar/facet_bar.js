/** @odoo-module **/
// The POS facet bar: for each attribute configured as a facet, it shows its values as
// toggleable chips. It reads the configuration (darakjian.pos.facet) and the values
// (product.attribute.value) loaded into the POS.

import { Component } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/hooks/pos_hook";

export class DarakjianFacetBar extends Component {
    static template = "yaguven_darakjian_pos_nav.FacetBar";
    static props = {};

    setup() {
        this.pos = usePos();
    }

    _attrId(rec) {
        // An m2o may arrive as a record (when the model is loaded) or as an id.
        return rec && rec.attribute_id && rec.attribute_id.id !== undefined
            ? rec.attribute_id.id
            : rec.attribute_id;
    }

    get facets() {
        // Defensive: if either model is missing from pos.models, return [] rather than
        // calling getAll() on undefined - that crashes the OWL lifecycle and takes the
        // whole POS down, even when no facets are configured.
        const facetModel = this.pos.models["darakjian.pos.facet"];
        const valueModel = this.pos.models["product.attribute.value"];
        if (!facetModel || !valueModel) {
            return [];
        }
        const values = valueModel.getAll();
        return facetModel.getAll()
            .slice()
            .sort((a, b) => (a.sequence - b.sequence) || (a.id - b.id))
            .map((f) => {
                const attrId = this._attrId(f);
                const vals = values
                    .filter((v) => this._attrId(v) === attrId)
                    .sort((a, b) => (a.sequence - b.sequence) || (a.id - b.id));
                return {
                    id: f.id,
                    attrId,
                    label: f.label || (f.attribute_id && f.attribute_id.name) || `#${attrId}`,
                    displayType: f.display_type,
                    values: vals,
                };
            })
            .filter((f) => f.values.length);
    }

    get activeCount() {
        return this.pos.darakjianActiveFacetCount;
    }

    isActive(attrId, valueId) {
        return this.pos.darakjianIsFacetActive(attrId, valueId);
    }

    toggle(attrId, valueId) {
        this.pos.darakjianToggleFacetValue(attrId, valueId);
    }

    clear() {
        this.pos.darakjianClearFacets();
    }
}
